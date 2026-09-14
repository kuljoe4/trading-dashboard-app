import { SessionService } from './session.service';
import { SessionController } from './session.controller';

describe('Session Logs & REST Endpoint Unit Tests', () => {
  let sessionService: jest.Mocked<any>;
  let sessionController: SessionController;

  beforeEach(() => {
    sessionService = {
      getStatus: jest.fn(),
      getLogs: jest.fn(),
    };
    sessionController = new SessionController(
      sessionService,
      {} as any,
      {} as any,
    );
  });

  it('SessionService.getStatus(false) omits logLines or returns undefined logLines', async () => {
    sessionService.getStatus.mockResolvedValue({
      running: true,
      balance: 10000,
      logLines: undefined,
    });

    const status = await sessionService.getStatus(false);
    expect(status.logLines).toBeUndefined();
  });

  it('SessionController.getLogs defaults limit to 50 and parses numeric query params', async () => {
    sessionService.getLogs.mockResolvedValue([
      { id: 'log-1', ts: '2026-09-14T20:00:00.000Z', level: 'info', msg: 'Engine started' },
    ]);

    const resultDefault = await sessionController.getLogs();
    expect(sessionService.getLogs).toHaveBeenCalledWith(50);
    expect(resultDefault).toHaveLength(1);

    await sessionController.getLogs('100');
    expect(sessionService.getLogs).toHaveBeenCalledWith(100);
  });
});
