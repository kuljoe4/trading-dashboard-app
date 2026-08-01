import { BinanceSubscriptionManager } from './binanceSubscriptionManager';
import WebSocket from 'ws';
import { EventEmitter2 } from '@nestjs/event-emitter';

jest.mock('ws');

describe('BinanceSubscriptionManager', () => {
  let manager: BinanceSubscriptionManager;
  let mockOnMessage: jest.Mock;
  let mockWs: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnMessage = jest.fn();

    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      readyState: 1 // WebSocket.OPEN
    };
    (WebSocket as any).mockImplementation(() => mockWs);

    manager = new BinanceSubscriptionManager(
      'ws://localhost:8080',
      { isTestnet: true, onMessage: mockOnMessage }
    );
  });

  afterEach(async () => {
    await manager.stop();
  });

  it('should chunk subscriptions and respect rate limits', async () => {
    // Manually trigger 'open'
    const connectPromise = manager.connect();
    const openHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'open')[1];
    openHandler();
    await connectPromise;

    const streams = Array.from({ length: 250 }, (_, i) => `stream${i}`);

    // Subscribe starts a promise that won't resolve until ACKs are received
    const subPromise = manager.subscribe(streams);
    // Ensure we catch rejections to prevent unhandled promise rejections if the test fails
    subPromise.catch(() => {});

    // Should have sent one chunk immediately (if queue processor started)
    // Wait for queue processor
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(mockWs.send).toHaveBeenCalledTimes(1);
    const firstCall = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(firstCall.method).toBe('SUBSCRIBE');
    expect(firstCall.params.length).toBe(200);

    // Mock ACK for first chunk
    const messageHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'message')[1];
    messageHandler(Buffer.from(JSON.stringify({ id: firstCall.id, result: null })));

    // Wait for second chunk (respecting 100ms interval)
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(mockWs.send).toHaveBeenCalledTimes(2);
    const secondCall = JSON.parse(mockWs.send.mock.calls[1][0]);
    expect(secondCall.params.length).toBe(50);

    // Mock ACK for second chunk
    messageHandler(Buffer.from(JSON.stringify({ id: secondCall.id, result: null })));

    await subPromise;
    expect(manager.getStatus().subscriptions.length).toBe(250);
  });

  it('should handle ACK timeouts', async () => {
    // Use fake timers BEFORE connect
    jest.useFakeTimers();

    const connectPromise = manager.connect();
    const openHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'open')[1];
    openHandler();
    // Resolve the connect promise
    jest.runAllTicks();
    await connectPromise;

    const subPromise = manager.subscribe(['test_stream']);

    // Advance to process the queue
    jest.advanceTimersByTime(150);
    expect(mockWs.send).toHaveBeenCalled();

    // Advance to trigger ACK timeout
    jest.advanceTimersByTime(5100);

    await expect(subPromise).rejects.toThrow('ACK Timeout');

    jest.useRealTimers();
  });

  it('should defer connection and throw error if isBanned returns true', async () => {
    const isBannedMock = jest.fn().mockReturnValue(true);
    const bannedManager = new BinanceSubscriptionManager(
      'ws://localhost:8080',
      { isTestnet: true, onMessage: mockOnMessage, isBanned: isBannedMock }
    );

    await expect(bannedManager.connect()).rejects.toThrow('Connection deferred: IP is currently banned.');
    expect(isBannedMock).toHaveBeenCalled();
    await bannedManager.stop();
  });

  it('should call onBan callback if error message indicates 418 or 429 status', async () => {
    const onBanMock = jest.fn();
    const errorManager = new BinanceSubscriptionManager(
      'ws://localhost:8080',
      { isTestnet: true, onMessage: mockOnMessage, onBan: onBanMock }
    );

    const connectPromise = errorManager.connect();
    const errorHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler(new Error('Unexpected server response: 418'));

    await expect(connectPromise).rejects.toThrow('Unexpected server response: 418');
    expect(onBanMock).toHaveBeenCalledWith('Unexpected server response: 418');
    await errorManager.stop();
  });

  it('should safely ignore close and error events from old, superseded connections', async () => {
    // Connect first socket
    const connectPromise = manager.connect();
    const firstWs = mockWs;
    const openHandler = firstWs.on.mock.calls.find((call: any) => call[0] === 'open')[1];
    openHandler();
    await connectPromise;

    expect(manager.getStatus().connected).toBe(true);

    // Mock close on firstWs, but manager.ws has been manually updated or superseded
    // Let's call close on firstWs when manager has firstWs. But we'll test both cases:
    const closeHandler = firstWs.on.mock.calls.find((call: any) => call[0] === 'close')[1];
    const errorHandler = firstWs.on.mock.calls.find((call: any) => call[0] === 'error')[1];

    // Simulating a superseded socket where manager's current active socket is a new one (or null)
    (manager as any).ws = { readyState: 1, terminate: jest.fn() }; // simulate a new active socket

    // Close event from the old socket should not clear manager's state
    closeHandler(1000, Buffer.from('intentional close of old'));
    expect(manager.getStatus().connected).toBe(true);

    // Error event from the old socket should be ignored as well
    errorHandler(new Error('old socket error'));
    expect(manager.getStatus().connected).toBe(true);
  });
});
