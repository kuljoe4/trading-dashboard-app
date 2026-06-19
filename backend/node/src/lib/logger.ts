import { ConsoleLogger, LogLevel } from '@nestjs/common';

export class DynamicLogger extends ConsoleLogger {
  private static instance: DynamicLogger;

  constructor() {
    super();
    DynamicLogger.instance = this;
  }

  static getInstance(): DynamicLogger {
    if (!DynamicLogger.instance) {
      DynamicLogger.instance = new DynamicLogger();
    }
    return DynamicLogger.instance;
  }

  setLogLevels(levels: LogLevel[]) {
    super.setLogLevels(levels);
  }
}

export function updateLogLevels(debugMode: boolean) {
  const forceDebug = process.env.DEBUG === 'true';

  let levels: LogLevel[];
  // If either the environment variable or the session config enables debug
  if (forceDebug || debugMode) {
    // Note: 'verbose' is excluded here to reduce noise unless explicitly requested via separate logic
    levels = ['log', 'error', 'warn', 'debug'];
  } else {
    // Default levels: hide debug and verbose to keep logs clean
    levels = ['log', 'warn', 'error'];
  }

  DynamicLogger.getInstance().setLogLevels(levels);
}
