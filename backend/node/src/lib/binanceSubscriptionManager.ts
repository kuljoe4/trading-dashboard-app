import { Logger } from '@nestjs/common';
import WebSocket from 'ws';

export interface SubscriptionRequest {
  id: number;
  method: 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'LIST_SUBSCRIPTIONS' | 'SET_PROPERTY';
  params: string[];
  resolve: (v: any) => void;
  reject: (e: any) => void;
  ts: number;
}

export class BinanceSubscriptionManager {
  private readonly logger = new Logger(BinanceSubscriptionManager.name);
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingRequests: Map<number, SubscriptionRequest> = new Map();
  private ackTimeouts: Map<number, NodeJS.Timeout> = new Map();
  private activeSubscriptions: Set<string> = new Set();
  private isConnecting = false;
  private isStopped = false;
  private messageQueue: any[] = [];
  private lastMessageSentTs = 0;
  private messageInterval = 100; // 10 messages per second (100ms interval)
  private processQueueInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private ackTimeoutMs = 5000;
  private lastMsgTs = 0;
  private msgCount = 0;
  private stallWatchdogInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private static readonly RECONNECT_BASE_MS = 5000;
  private static readonly RECONNECT_MAX_MS = 60000;

  constructor(
    private readonly wsUrl: string,
    private readonly options: {
      isTestnet: boolean;
      onMessage: (data: any) => void;
      isBanned?: () => boolean;
      onBan?: (msg: string) => void;
    }
  ) {}

  public async connect(): Promise<void> {
    if (this.ws || this.isConnecting || this.isStopped) return;

    if (this.options.isBanned?.()) {
      this.logger.warn(`[SubscriptionManager] Connection deferred: IP is currently banned.`);
      this.scheduleReconnect();
      throw new Error('Connection deferred: IP is currently banned.');
    }

    this.isConnecting = true;
    this.lastMsgTs = 0;
    this.msgCount = 0;

    return new Promise((resolve, reject) => {
      this.logger.log(`[SubscriptionManager] Connecting to ${this.wsUrl}`);
      const ws = new WebSocket(this.wsUrl, {
        handshakeTimeout: 15000,
        perMessageDeflate: false,
        // Live Futures market-data WS (fstream.binance.com) requires browser-like
        // headers from some network vantage points; without them Binance accepts
        // the connection + SUBSCRIBE ACK but delivers ZERO data frames. Testnet
        // (fstream.binancefuture.com) does not need them. Regression fix for the
        // header removal in 3304f59 that broke live-mode streaming.
        headers: this.options.isTestnet ? {} : {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://www.binance.com'
        }
      });

      ws.on('open', () => {
        if (this.isStopped) {
            ws.terminate();
            return;
        }
        this.ws = ws;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.logger.log(`[SubscriptionManager] WebSocket connected to ${this.wsUrl}`);
        this.startQueueProcessor();
        this.startPingInterval();
        this.startStatsInterval();
        this.startStallWatchdog();

        // Re-subscribe to existing subscriptions if this is a reconnect
        if (this.activeSubscriptions.size > 0) {
          const streams = Array.from(this.activeSubscriptions);
          this.activeSubscriptions.clear();
          this.subscribe(streams).catch(err => {
            this.logger.error(`Failed to restore subscriptions: ${err.message}`);
          });
        }

        resolve();
      });

      ws.on('message', (data: any) => {
        this.handleMessage(data);
      });

      ws.on('error', (err: any) => {
        const msg = err.message || '';
        this.logger.error(`[SubscriptionManager] WebSocket error: ${msg}`);

        if (msg.includes('429') || msg.includes('418')) {
          this.logger.fatal(`[CRITICAL] WebSocket handshake failed with rate-limit/ban status (${msg}).`);
          this.options.onBan?.(msg);
        }

        if (this.isConnecting) {
          this.isConnecting = false;
          reject(err);
        } else if (!this.isStopped) {
          // If a 'close' event does not follow, proactively schedule a reconnect.
          if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (!this.ws && !this.isConnecting && !this.isStopped) {
              this.connect().catch(() => {});
            }
          }, 5000);
          this.reconnectTimeout.unref?.();
        }
      });

      ws.on('close', () => {
        this.logger.warn('[SubscriptionManager] WebSocket closed.');
        this.ws = null;
        this.isConnecting = false;
        this.stopQueueProcessor();
        this.stopPingInterval();
        this.cleanupPendingRequests('WebSocket closed');

        // Auto-reconnect with capped exponential backoff (SRE: avoid reconnect storms / IP-ban patterns)
        if (!this.isStopped && this.isConnecting === false) {
            this.scheduleReconnect();
        }
      });

      ws.on('pong', () => {
        // this.logger.debug('[SubscriptionManager] PONG received');
      });
    });
  }

  public async stop(): Promise<void> {
    this.isStopped = true;
    this.stopQueueProcessor();
    this.stopPingInterval();
    this.stopStatsInterval();
    this.stopStallWatchdog();
    if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
    }
    if (this.ws) {
        this.ws.terminate();
        this.ws = null;
    }
    this.cleanupPendingRequests('Stopped');
  }

  public async subscribe(streams: string[]): Promise<void> {
    // Filter out already subscribed streams
    const newStreams = streams.filter(s => !this.activeSubscriptions.has(s));
    if (newStreams.length === 0) return;

    // If the URL already contains the stream subscriptions directly (raw stream fallback),
    // we do not need to send post-connection SUBSCRIBE frames.
    if (this.wsUrl.includes('?streams=')) {
      newStreams.forEach(s => this.activeSubscriptions.add(s));
      return;
    }

    // Chunking: Max 200 streams per SUBSCRIBE frame
    const CHUNK_SIZE = 200;
    const chunks = [];
    for (let i = 0; i < newStreams.length; i += CHUNK_SIZE) {
      chunks.push(newStreams.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      await this.sendRequest('SUBSCRIBE', chunk);
      chunk.forEach(s => this.activeSubscriptions.add(s));
    }
  }

  public async unsubscribe(streams: string[]): Promise<void> {
    const toUnsubscribe = streams.filter(s => this.activeSubscriptions.has(s));
    if (toUnsubscribe.length === 0) return;

    // If the URL already contains the stream subscriptions directly (raw stream fallback),
    // we do not need to send post-connection UNSUBSCRIBE frames.
    if (this.wsUrl.includes('?streams=')) {
      toUnsubscribe.forEach(s => this.activeSubscriptions.delete(s));
      return;
    }

    const CHUNK_SIZE = 200;
    const chunks = [];
    for (let i = 0; i < toUnsubscribe.length; i += CHUNK_SIZE) {
      chunks.push(toUnsubscribe.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      await this.sendRequest('UNSUBSCRIBE', chunk);
      chunk.forEach(s => this.activeSubscriptions.delete(s));
    }
  }

  private async sendRequest(method: SubscriptionRequest['method'], params: string[]): Promise<any> {
    if (this.isStopped) return Promise.reject(new Error('Stopped'));

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: SubscriptionRequest = {
        id,
        method,
        params,
        resolve,
        reject,
        ts: Date.now()
      };

      this.pendingRequests.set(id, request);
      this.messageQueue.push({ id, method, params });
    });
  }

  private startQueueProcessor() {
    if (this.processQueueInterval) return;
    this.processQueueInterval = setInterval(() => {
      this.processQueue();
    }, 10);
    this.processQueueInterval.unref?.();
  }

  private stopQueueProcessor() {
    if (this.processQueueInterval) {
      clearInterval(this.processQueueInterval);
      this.processQueueInterval = null;
    }
  }

  private startPingInterval() {
    if (this.pingInterval) return;
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 20000);
    this.pingInterval.unref?.();
  }

  private stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private startStatsInterval() {
      if (this.statsInterval) return;
      this.statsInterval = setInterval(() => {
          const now = Date.now();
          const silence = this.lastMsgTs > 0 ? Math.round((now - this.lastMsgTs) / 1000) : 'N/A';
          this.logger.debug(`[SubscriptionManager] Stats: Received ${this.msgCount} frames. Last msg: ${silence}s ago. Subs: ${this.activeSubscriptions.size}`);
          this.msgCount = 0;
      }, 30000);
      this.statsInterval.unref?.();
  }

  private stopStatsInterval() {
      if (this.statsInterval) {
          clearInterval(this.statsInterval);
          this.statsInterval = null;
      }
  }

  /**
   * SRE: Self-healing data stall watchdog. The Binance public WS can sometimes
   * accept a connection + SUBSCRIBE ACK yet deliver zero frames (silent stall).
   * If we are OPEN, have active subscriptions, and have gone >7m without any
   * frame, terminate and reconnect to force a fresh stream.
   */
  private startStallWatchdog() {
    if (this.stallWatchdogInterval) return;
    this.stallWatchdogInterval = setInterval(() => {
      if (this.isStopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (this.activeSubscriptions.size > 0 && this.lastMsgTs > 0 && (now - this.lastMsgTs) > 420000) {
        this.logger.warn(`[SubscriptionManager] Stall detected (${Math.round((now - this.lastMsgTs) / 1000)}s silent with ${this.activeSubscriptions.size} active subs). Force-reconnecting...`);
        this.lastMsgTs = 0; // Prevent immediate re-trigger
        this.ws.terminate();
        this.ws = null;
        this.isConnecting = false;
        this.scheduleReconnect();
      }
    }, 30000);
    this.stallWatchdogInterval.unref?.();
  }

  private stopStallWatchdog() {
    if (this.stallWatchdogInterval) {
      clearInterval(this.stallWatchdogInterval);
      this.stallWatchdogInterval = null;
    }
  }

  /**
   * SRE: Capped exponential backoff for reconnection. Prevents the self-amplifying
   * reconnect storm (every ~2min) that reads as abusive to exchanges and risks IP bans.
   * Delay grows 5s -> 10s -> 20s -> 40s -> capped 60s; resets on successful connect.
   */
  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    const delay = Math.min(
      BinanceSubscriptionManager.RECONNECT_MAX_MS,
      BinanceSubscriptionManager.RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
    );
    this.reconnectAttempts++;
    this.logger.warn(`[SubscriptionManager] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts}).`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.ws && !this.isConnecting && !this.isStopped) {
        this.connect().catch(() => {});
      }
    }, delay);
    this.reconnectTimeout.unref?.();
  }

  private processQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.messageQueue.length === 0) return;

    const now = Date.now();
    if (now - this.lastMessageSentTs < this.messageInterval) return;

    const msg = this.messageQueue.shift();
    this.logger.log(`[SubscriptionManager] Sending request ${msg.id}: ${msg.method} for ${msg.params.length} streams...`);
    this.ws.send(JSON.stringify(msg));
    this.lastMessageSentTs = now;

    // Set timeout for ACKs
    const timeout = setTimeout(() => {
      this.ackTimeouts.delete(msg.id);
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        pending.reject(new Error(`ACK Timeout for request ${msg.id} (${msg.method})`));
      }
    }, this.ackTimeoutMs);
    timeout.unref?.();
    this.ackTimeouts.set(msg.id, timeout);
  }

  private _hasReceivedAnyMessage = false;

  private handleMessage(data: any) {
    try {
      this.lastMsgTs = Date.now();
      this.msgCount++;

      // Support for already-parsed payloads or Buffers
      let msg: any;
      if (typeof data === 'object' && !Buffer.isBuffer(data)) {
          msg = data;
      } else {
          // BOLT OPTIMIZATION: Use JSON.parse(data) directly on the Buffer in Node.js 20+.
          // This leverages the internal C++ parser optimization for binary data, bypassing the expensive V8 string allocation phase.
          msg = JSON.parse(data);
      }

      if (!this._hasReceivedAnyMessage) {
          this._hasReceivedAnyMessage = true;
          this.logger.log(`[SubscriptionManager] Received first frame from ${this.wsUrl}: ${JSON.stringify(msg).substring(0, 100)}`);
      }

      // Handle ACK responses
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        this.logger.debug(`[SubscriptionManager] Received response for request ${msg.id}: ${msg.error ? 'ERROR' : 'SUCCESS'}`);
        const timeout = this.ackTimeouts.get(msg.id);
        if (timeout) {
          clearTimeout(timeout);
          this.ackTimeouts.delete(msg.id);
        }

        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            const errMsg = `Binance Error ${msg.error.code}: ${msg.error.msg}`;
            this.logger.error(`[SubscriptionManager] Request ${msg.id} failed: ${errMsg}`);
            pending.reject(new Error(errMsg));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      // Handle data messages
      this.options.onMessage(msg);

    } catch (err) {
      this.logger.error(`Error handling message: ${err instanceof Error ? err.message : String(err)}`);
      this.logger.debug(`Raw message that caused error: ${data.toString()}`);
    }
  }

  private cleanupPendingRequests(reason: string) {
    for (const timeout of this.ackTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.ackTimeouts.clear();

    const requests = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();

    if (requests.length > 0) {
        this.logger.debug(`[SubscriptionManager] Cleaning up ${requests.length} pending requests. Reason: ${reason}`);
        for (const req of requests) {
            try {
                req.reject(new Error(reason));
            } catch (e) {
                // Ignore re-rejection or other errors
            }
        }
    }
  }

  public getStatus() {
    return {
      connected: !!this.ws && this.ws.readyState === WebSocket.OPEN,
      subscriptions: Array.from(this.activeSubscriptions),
      pendingRequests: this.pendingRequests.size,
      queueDepth: this.messageQueue.length
    };
  }
}
