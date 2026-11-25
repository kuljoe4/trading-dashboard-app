import { SharedMarketData } from './shared-market-data';
import { BinanceSubscriptionManager } from '../lib/binanceSubscriptionManager';

describe('SharedMarketData', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shares overlapping topics and keeps the socket and prices when Paper stops', async () => {
    const managers: BinanceSubscriptionManager[] = [];
    jest.spyOn(BinanceSubscriptionManager.prototype, 'connect').mockImplementation(async function (this: BinanceSubscriptionManager) {
      managers.push(this);
    });
    const stop = jest.spyOn(BinanceSubscriptionManager.prototype, 'stop').mockResolvedValue(undefined);
    const shared = new SharedMarketData();
    const live = {};
    const paper = {};
    const liveMessage = jest.fn();
    const paperMessage = jest.fn();
    const onBan = jest.fn();
    const btc = 'btcusdt@kline_5m';
    const eth = 'ethusdt@kline_5m';
    shared.attach(live);
    shared.attach(paper);
    shared.tickerCache.updateTicker('BTCUSDT', 50000);

    await shared.klines.subscribe(live, { topics: new Set([btc]), onMessage: liveMessage, onBan });
    await shared.klines.subscribe(paper, { topics: new Set([btc]), onMessage: paperMessage, onBan });
    expect(managers).toHaveLength(1);

    await shared.klines.subscribe(paper, { topics: new Set([btc, eth]), onMessage: paperMessage, onBan });
    expect(managers).toHaveLength(2);
    expect(stop).not.toHaveBeenCalled();
    const liveSocket = managers[0] as any;
    const paperSocket = managers[1] as any;
    expect(paperSocket.wsUrl).toContain(`?streams=${eth}`);

    const btcFrame = { stream: btc };
    liveSocket.options.onMessage(btcFrame);
    expect(liveMessage).toHaveBeenCalledWith(btcFrame, true);
    expect(paperMessage).toHaveBeenCalledWith(btcFrame, false);

    const ethFrame = { stream: eth };
    paperSocket.options.onMessage(ethFrame);
    expect(liveMessage).not.toHaveBeenCalledWith(ethFrame, expect.anything());
    expect(paperMessage).toHaveBeenCalledWith(ethFrame, true);

    await shared.klines.unsubscribe(paper);
    shared.releaseCandles(paper);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.instances[0]).toBe(paperSocket);
    expect(shared.tickerCache.getPrice('BTCUSDT')).toBe(50000);

    await shared.klines.unsubscribe(live);
    shared.releaseCandles(live);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(shared.tickerCache.getCacheSize()).toBe(0);
  });
});
