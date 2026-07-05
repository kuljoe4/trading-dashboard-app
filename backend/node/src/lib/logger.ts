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
 * Protects against accidental leakage of credentials in logs.
 */
export function sanitize(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // SENTINEL: Guard against special objects to prevent them from being
  // incorrectly serialized into empty objects by the property loop.
  if (obj instanceof Date || obj instanceof Buffer || obj instanceof RegExp) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  const sanitized: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const lowerKey = key.toLowerCase();
      // SENTINEL: Broaden detection to catch camelCase, snake_case, and kebab-case
      // variations of sensitive fields, as well as additional security keywords.
      if (
        lowerKey === "value" ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api-key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("auth") ||
        lowerKey.includes("credential") ||
        lowerKey.includes("private") ||
        lowerKey.includes("seed")
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
