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
 * Includes circular reference protection and recursion depth limits.
 */
export function sanitize(obj: any, visited = new WeakSet<any>(), depth = 0): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (depth > 10) {
    return Array.isArray(obj) ? "[Array]" : "[Object]";
  }

  if (visited.has(obj)) {
    return "[Circular]";
  }

  // SENTINEL: Guard against special objects to prevent them from being
  // incorrectly serialized into empty objects by the property loop.
  if (obj instanceof Date || obj instanceof Buffer || obj instanceof RegExp) {
    return obj;
  }

  visited.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item, visited, depth + 1));
  }

  // SENTINEL: Handle Error objects by preserving identity and core metadata
  // while still allowing recursive sanitization of custom properties.
  const sanitized: any = obj instanceof Error ? {
    name: obj.name,
    message: obj.message,
    stack: obj.stack,
  } : {};

  // For Errors, we also want to capture any custom properties added to the object
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const lowerKey = key.toLowerCase();
      // SENTINEL: Broaden detection to catch camelCase, snake_case, and kebab-case
      // variations of sensitive fields, as well as additional security keywords.
      if (
        lowerKey === "value" ||
        lowerKey === "pass" ||
        lowerKey === "pwd" ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api-key") ||
        lowerKey.includes("access_key") ||
        lowerKey.includes("access-key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("jwt") ||
        lowerKey.includes("auth") ||
        lowerKey.includes("credential") ||
        lowerKey.includes("private") ||
        lowerKey.includes("seed") ||
        lowerKey.includes("mnemonic") ||
        lowerKey.includes("passphrase") ||
        lowerKey.includes("cookie") ||
        lowerKey.includes("session") ||
        lowerKey.includes("signature")
      ) {
        sanitized[key] = "[MASKED]";
      } else {
        sanitized[key] = sanitize(obj[key], visited, depth + 1);
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
