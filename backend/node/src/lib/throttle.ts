// SENTINEL: Centralized IP-based failure tracking to prevent brute-force
const FAILURES = new Map<string, { count: number; lastFailure: number }>();
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60000;

// PERIODIC CLEANUP: Evict stale records every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of FAILURES.entries()) {
    if (now - record.lastFailure > FAILURE_WINDOW_MS * 5) {
      FAILURES.delete(ip);
    }
  }
}, 600000);

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
  const record = FAILURES.get(ip) || { count: 0, lastFailure: 0 };
  record.count++;
  record.lastFailure = Date.now();
  FAILURES.set(ip, record);
  return record.count;
}

export function clearFailures(ip: string): void {
  FAILURES.delete(ip);
}

export function extractIp(headers: any, defaultIp: string): string {
  const forwarded = headers?.["x-forwarded-for"];
  if (forwarded) {
    // When behind a trusted proxy, the last IP in the chain is the most reliable.
    // The leftmost IP can be spoofed by the client.
    const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
    return ips[ips.length - 1].trim();
  }
  return defaultIp;
}
