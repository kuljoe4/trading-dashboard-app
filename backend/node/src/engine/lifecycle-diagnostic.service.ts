import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LifecycleDiagnosticService {
  private static instanceCount = 0;
  private readonly logger = new Logger(LifecycleDiagnosticService.name);

  constructor() {
    LifecycleDiagnosticService.instanceCount++;
    this.logger.warn(`[DIAGNOSTIC] SessionLifecycleService instance created. Total active instances: ${LifecycleDiagnosticService.instanceCount}`);
  }

  static getInstanceCount(): number {
    return this.instanceCount;
  }
}
