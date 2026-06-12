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

export function extractIp(headers: any, defaultIp: string): string {
  const forwarded = headers?.["x-forwarded-for"];
  if (forwarded) {
    // SENTINEL: Handle both string and array of strings for multiple X-Forwarded-For headers.
    // When behind a trusted proxy, the last IP in the chain is the most reliable.
    // The leftmost IP can be spoofed by the client.
    const rawForwarded = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const ips = rawForwarded.split(',');
    const extracted = ips[ips.length - 1].trim();
    return extracted || defaultIp;
  }
  return defaultIp;
}
