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

  constructor(
    private readonly wsUrl: string,
    private readonly options: {
      isTestnet: boolean;
      onMessage: (data: any) => void;
    }
  ) {}

  public async connect(): Promise<void> {
    if (this.ws || this.isConnecting || this.isStopped) return;
    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      this.logger.log(`[SubscriptionManager] Connecting to ${this.wsUrl}`);
      const ws = new WebSocket(this.wsUrl, {
        handshakeTimeout: 15000,
        perMessageDeflate: false,
        headers: {}
      });

      ws.on('open', () => {
        if (this.isStopped) {
            ws.terminate();
            return;
        }
        this.ws = ws;
        this.isConnecting = false;
        this.logger.log(`[SubscriptionManager] WebSocket connected to ${this.wsUrl}`);
        this.startQueueProcessor();
        this.startPingInterval();
        this.startStatsInterval();

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
        this.logger.error(`[SubscriptionManager] WebSocket error: ${err.message}`);
        if (this.isConnecting) {
          this.isConnecting = false;
          reject(err);
        }
      });

      ws.on('close', () => {
        this.logger.warn('[SubscriptionManager] WebSocket closed.');
        this.ws = null;
        this.isConnecting = false;
        this.stopQueueProcessor();
        this.stopPingInterval();
        this.cleanupPendingRequests('WebSocket closed');

        // Auto-reconnect logic (only if NOT stopped)
        if (!this.isStopped && this.isConnecting === false) {
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
