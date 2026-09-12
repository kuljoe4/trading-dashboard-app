import { Test, TestingModule } from '@nestjs/testing';
import { MonitoringService } from './monitoring.service';

describe('Rest Telemetry Audit & Fast-Fail (MonitoringService)', () => {
  let service: MonitoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MonitoringService],
    }).compile();

    service = module.get<MonitoringService>(MonitoringService);
  });

  it('should initialize with empty API request metrics and breakdown', () => {
    const metrics = service.getMetrics();
    expect(metrics.application.api_requests_total).toBe(0);
    expect(metrics.application.api_requests_breakdown).toEqual({});
    expect(metrics.application.rest_telemetry_logs).toEqual([]);
  });

  it('should accurately record REST call telemetry by endpoint label', () => {
    service.recordRestCall('klineCandlestickData', 45, 1, 'ok');
    service.recordRestCall('klineCandlestickData', 50, 1, 'ok');
    service.recordRestCall('newOrder', 120, 1, 'ok');
    service.recordRestCall('positionInformationV3', 80, 5, 'error', 'HTTP 502 Bad Gateway');

    const metrics = service.getMetrics();
    expect(metrics.application.api_requests_total).toBe(3); // only 'ok' calls increment api_requests_total
    expect(metrics.application.api_requests_breakdown).toEqual({
      klineCandlestickData: 2,
      newOrder: 1,
      positionInformationV3: 0,
    });
    expect(metrics.application.rest_telemetry_logs.length).toBe(4);

    const errorLog = metrics.application.rest_telemetry_logs.find(l => l.status === 'error');
    expect(errorLog).toBeDefined();
    expect(errorLog?.label).toBe('positionInformationV3');
    expect(errorLog?.errorMsg).toBe('HTTP 502 Bad Gateway');
  });

  it('should enforce ring buffer capacity limits on rest_telemetry_logs', () => {
    for (let i = 0; i < 60; i++) {
      service.recordRestCall(`endpoint_${i % 5}`, 10 + i, 1, 'ok');
    }

    const metrics = service.getMetrics();
    // getMetrics() returns slice(-20) for payload efficiency
    expect(metrics.application.rest_telemetry_logs.length).toBe(20);
    const lastLog = metrics.application.rest_telemetry_logs[metrics.application.rest_telemetry_logs.length - 1];
    expect(lastLog.label).toBe('endpoint_4');
    expect(lastLog.duration).toBe(69);
  });

  it('should clear all API metrics cleanly on clearAppMetrics', () => {
    service.recordRestCall('queryOrder', 30, 1, 'ok');
    expect(service.getMetrics().application.api_requests_total).toBe(1);

    service.clearAppMetrics();

    const metrics = service.getMetrics();
    expect(metrics.application.api_requests_total).toBe(0);
    expect(metrics.application.api_requests_breakdown).toEqual({});
    expect(metrics.application.rest_telemetry_logs).toEqual([]);
  });
});
