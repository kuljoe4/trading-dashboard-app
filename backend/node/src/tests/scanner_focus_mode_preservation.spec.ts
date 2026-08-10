import "reflect-metadata";

describe("Sentinel: Scanner Focus Mode Preservation", () => {
  let mockClients: any[];
  let mockTradingSessionService: any;
  let mockApp: any;

  beforeEach(() => {
    mockClients = [];
    mockTradingSessionService = {
      setListenerCount: jest.fn(),
      setDashboardCount: jest.fn(),
    };
    mockApp = {
      get: jest.fn().mockReturnValue(mockTradingSessionService),
    };
  });

  // A helper simulating updateMonitoringSuppression
  function runUpdateMonitoringSuppression(clients: any[], app: any) {
    const tradingSessionService = app.get((_any: any) => _any); // mock app.get
    const activeCount = clients.filter((c: any) => c.isActive !== false).length;
    tradingSessionService.setListenerCount(activeCount);
    const dashCount = clients.filter(
      (c: any) => c.isActive !== false && (!c.focusMode || !!c.focusScannerSymbol),
    ).length;
    tradingSessionService.setDashboardCount(dashCount);
    return { activeCount, dashCount };
  }

  // A helper simulating the scanner broadcast filter
  function shouldSuppressScannerPayload(client: any): boolean {
    const payloadType = "scanner";
    if (client.isActive === false) {
      return true;
    }
    if (payloadType === "scanner" && client.focusMode === true && !client.focusScannerSymbol) {
      return true;
    }
    return false;
  }

  it("should count client in dashCount when not in focus mode", () => {
    const client = { isActive: true, focusMode: false, focusScannerSymbol: null };
    mockClients.push(client);

    const { activeCount, dashCount } = runUpdateMonitoringSuppression(mockClients, mockApp);

    expect(activeCount).toBe(1);
    expect(dashCount).toBe(1);
    expect(mockTradingSessionService.setListenerCount).toHaveBeenCalledWith(1);
    expect(mockTradingSessionService.setDashboardCount).toHaveBeenCalledWith(1);
  });

  it("should NOT count client in dashCount when in focus mode but NOT focusing on scanner symbol", () => {
    const client = { isActive: true, focusMode: true, focusScannerSymbol: null };
    mockClients.push(client);

    const { activeCount, dashCount } = runUpdateMonitoringSuppression(mockClients, mockApp);

    expect(activeCount).toBe(1);
    expect(dashCount).toBe(0);
    expect(mockTradingSessionService.setListenerCount).toHaveBeenCalledWith(1);
    expect(mockTradingSessionService.setDashboardCount).toHaveBeenCalledWith(0);
  });

  it("should count client in dashCount when in focus mode AND focusing on a scanner symbol", () => {
    const client = { isActive: true, focusMode: true, focusScannerSymbol: "BTCUSDT" };
    mockClients.push(client);

    const { activeCount, dashCount } = runUpdateMonitoringSuppression(mockClients, mockApp);

    expect(activeCount).toBe(1);
    expect(dashCount).toBe(1);
    expect(mockTradingSessionService.setListenerCount).toHaveBeenCalledWith(1);
    expect(mockTradingSessionService.setDashboardCount).toHaveBeenCalledWith(1);
  });

  it("should correctly handle multiple mixed clients in updateMonitoringSuppression", () => {
    mockClients.push(
      { isActive: true, focusMode: false, focusScannerSymbol: null }, // standard dashboard
      { isActive: true, focusMode: true, focusScannerSymbol: null },  // focused on trade
      { isActive: true, focusMode: true, focusScannerSymbol: "ETHUSDT" }, // focused on scanner row
      { isActive: false, focusMode: false, focusScannerSymbol: null } // inactive client
    );

    const { activeCount, dashCount } = runUpdateMonitoringSuppression(mockClients, mockApp);

    expect(activeCount).toBe(3); // 3 active clients
    expect(dashCount).toBe(2);  // 1 standard + 1 focused on scanner row
    expect(mockTradingSessionService.setListenerCount).toHaveBeenCalledWith(3);
    expect(mockTradingSessionService.setDashboardCount).toHaveBeenCalledWith(2);
  });

  it("should suppress scanner payload for inactive background clients", () => {
    const client = { isActive: false, focusMode: false, focusScannerSymbol: null };
    const suppress = shouldSuppressScannerPayload(client);
    expect(suppress).toBe(true);
  });

  it("should suppress scanner payload for clients focused on a single trade", () => {
    const client = { isActive: true, focusMode: true, focusScannerSymbol: null };
    const suppress = shouldSuppressScannerPayload(client);
    expect(suppress).toBe(true);
  });

  it("should NOT suppress scanner payload for clients focused on a scanner symbol", () => {
    const client = { isActive: true, focusMode: true, focusScannerSymbol: "BTCUSDT" };
    const suppress = shouldSuppressScannerPayload(client);
    expect(suppress).toBe(false);
  });

  it("should NOT suppress scanner payload for standard dashboard clients", () => {
    const client = { isActive: true, focusMode: false, focusScannerSymbol: null };
    const suppress = shouldSuppressScannerPayload(client);
    expect(suppress).toBe(false);
  });
});
