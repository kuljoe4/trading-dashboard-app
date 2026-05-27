import { Logger, LogLevel } from '@nestjs/common';

export function updateLogLevels(debugMode: boolean) {
  const forceDebug = process.env.DEBUG === 'true';

  let levels: LogLevel[];
  // If either the environment variable or the session config enables debug
  if (forceDebug || debugMode) {
    levels = ['log', 'error', 'warn', 'debug', 'verbose'];
  } else {
    // Default levels: hide debug and verbose to keep logs clean
    levels = ['log', 'warn', 'error'];
  }

  (Logger as any).overrideLogLevels?.(levels);
}
