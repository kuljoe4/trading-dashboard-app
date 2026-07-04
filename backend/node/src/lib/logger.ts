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

/**
 * SENTINEL: Recursively sanitizes objects by masking sensitive fields
 * such as 'value' (from ValidationError) and API keys/secrets.
 */
export function sanitize(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  const sanitized: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "value" ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("api_secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("token")
      ) {
        sanitized[key] = "[MASKED]";
      } else {
        sanitized[key] = sanitize(obj[key]);
      }
    }
  }
  return sanitized;
}

/**
 * SENTINEL: Recursively formats ValidationError objects from class-validator
 * for safe reporting in API responses.
 */
export function formatValidationErrors(errs: any[]): any[] {
  return errs.map((err) => ({
    property: err.property,
    constraints: err.constraints,
    children: err.children?.length ? formatValidationErrors(err.children) : undefined,
  }));
}
