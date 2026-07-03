// SENTINEL: Centralized IP-based failure tracking to prevent brute-force
const FAILURES = new Map<string, { count: number; lastFailure: number }>();
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60000;
const MAX_TRACKED_IPS = 5000;

// PERIODIC CLEANUP: Evict stale records every 10 minutes to prevent memory leaks
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of FAILURES.entries()) {
      if (now - record.lastFailure > FAILURE_WINDOW_MS * 5) {
        FAILURES.delete(ip);
      }
    }
  }, 600000);
}

export function isThrottled(ip: string): boolean {
  const record = FAILURES.get(ip);
  if (record && record.count >= MAX_FAILURES) {
    if (Date.now() - record.lastFailure < FAILURE_WINDOW_MS) {
      return true;
    }
    FAILURES.delete(ip);
  }
  return false;
}

export function recordFailure(ip: string): number {
  // SENTINEL: Implement FIFO eviction if map exceeds MAX_TRACKED_IPS to prevent memory exhaustion DoS
  if (!FAILURES.has(ip) && FAILURES.size >= MAX_TRACKED_IPS) {
    const oldestIp = FAILURES.keys().next().value;
    if (oldestIp) FAILURES.delete(oldestIp);
  }

  const record = FAILURES.get(ip) || { count: 0, lastFailure: 0 };
  record.count++;
  record.lastFailure = Date.now();
  FAILURES.set(ip, record);
  return record.count;
}

export function clearFailures(ip: string): void {
  FAILURES.delete(ip);
}

/**
 * Validates if a string is a valid IPv4 or IPv6 address.
 * Prevents log injection and XSS via spoofed headers.
 */
function isValidIp(ip: string): boolean {
  // IPv4 Regex
  const ipv4Regex = /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  // IPv6 Regex (Simple version)
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

export function extractIp(headers: any, defaultIp: string): string {
  const forwarded = headers?.["x-forwarded-for"];
  if (forwarded) {
    // SENTINEL: Handle both string and array of strings for multiple X-Forwarded-For headers.
    // When behind a trusted proxy, the last IP in the chain is the most reliable.
    // The leftmost IP can be spoofed by the client.
    const rawForwarded = Array.isArray(forwarded) ? (forwarded as string[]).join(",") : (forwarded as string);
    const ips = rawForwarded
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    const candidate = ips.length > 0 ? ips[ips.length - 1] : defaultIp;

    // SENTINEL: Validate candidate IP format to prevent injection attacks
    return isValidIp(candidate) ? candidate : defaultIp;
  }
  return defaultIp;
}
