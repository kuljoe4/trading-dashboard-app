import { BinanceSubscriptionManager } from './binanceSubscriptionManager';
import WebSocket from 'ws';
import { ENGINE_CONSTANTS } from '../models/constants';

jest.mock('ws');

/**
 * Regression guards for the live-market-data blackout fix (2026-07-17).
 *
 * Root cause: the classic `wss://fstream.binance.com/stream` endpoint is starved by
 * Binance from many IP ranges (handshake + SUBSCRIBE ACK succeed but ZERO frames arrive),
 * and the SUBSCRIBE method is NOT served on `/market/stream`. Live MUST use
 * `wss://fstream.binance.com/market/stream?streams=...` with streams embedded in the URL.
 * These tests lock that behavior in and prevent a reconnect-storm/ban-risk regression.
 */
describe('BinanceSubscriptionManager - live resilience (regression guard)', () => {
  let manager: BinanceSubscriptionManager | undefined;
  let mockWs: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      readyState: 1,
    };
    (WebSocket as any).mockImplementation(() => mockWs);
  });

  afterEach(async () => {
    await manager?.stop();
    manager = undefined;
  });

  it('live market endpoint MUST be /market/stream (classic /stream is starved by Binance)', () => {
    expect(ENGINE_CONSTANTS.BINANCE_WS_MARKET).toBe('wss://fstream.binance.com/market/stream');
  });

  it('does NOT send a SUBSCRIBE frame when the URL already carries ?streams= (live raw-stream mode)', async () => {
    manager = new BinanceSubscriptionManager(
      'wss://fstream.binance.com/market/stream?streams=btcusdt@kline_1m',
      { isTestnet: false, onMessage: jest.fn() }
    );
    const p = manager.connect();
    const openHandler = mockWs.on.mock.calls.find((c: any) => c[0] === 'open')[1];
    openHandler();
    await p;

    await manager.subscribe(['btcusdt@kline_1m', 'ethusdt@kline_1m']);

    // On /market/stream the subscription is delivered via the URL param, NOT a SUBSCRIBE frame.
    expect(mockWs.send).not.toHaveBeenCalled();
    expect(manager.getStatus().subscriptions).toEqual(
      expect.arrayContaining(['btcusdt@kline_1m', 'ethusdt@kline_1m'])
    );
  });

  it('applies capped exponential backoff (5s -> 60s) on reconnect to avoid ban-risk storms', () => {
    manager = new BinanceSubscriptionManager(
      'wss://fstream.binance.com/market/stream?streams=x',
      { isTestnet: false, onMessage: jest.fn() }
    );
    const connectSpy = jest
      .spyOn(manager as any, 'connect')
      .mockImplementation(() => Promise.resolve());

    // Capture the deferred reconnect delay without actually scheduling timers.
    const delays: number[] = [];
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((_fn: any, delay?: any) => {
        delays.push(delay as number);
        return 0 as any; // falsy handle so the internal guard never blocks re-scheduling
      });

    for (let i = 0; i < 6; i++) {
      (manager as any).scheduleReconnect();
    }

    expect(delays).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);

    // Reconnect must be deferred (inside the timer callback), never immediate.
    expect(connectSpy).not.toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
    connectSpy.mockRestore();
  });
});
