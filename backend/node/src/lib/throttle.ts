import { isIP } from 'net';

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

import * as net from "net";

export function clearFailures(ip: string): void {
  FAILURES.delete(ip);
}

export function extractIp(headers: any, defaultIp: string): string {
  // SENTINEL: Prioritize edge-validated single-IP headers set by CDNs or fronting reverse proxies.
  // This provides defense-in-depth protection against X-Forwarded-For spoofing attacks.
  const cfIp = headers?.["cf-connecting-ip"];
  if (cfIp) {
    const singleCfIp = Array.isArray(cfIp) ? cfIp[0] : cfIp;
    if (typeof singleCfIp === "string" && singleCfIp.length <= 45 && net.isIP(singleCfIp)) {
      return singleCfIp;
    }
  }

  const realIp = headers?.["x-real-ip"];
  if (realIp) {
    const singleRealIp = Array.isArray(realIp) ? realIp[0] : realIp;
    if (typeof singleRealIp === "string" && singleRealIp.length <= 45 && net.isIP(singleRealIp)) {
      return singleRealIp;
    }
  }

  const forwarded = headers?.["x-forwarded-for"];
  if (forwarded) {
    // SENTINEL: Handle both string and array of strings for multiple X-Forwarded-For headers.
    const rawForwarded = Array.isArray(forwarded) ? (forwarded as string[]).join(",") : (forwarded as string);

    // SENTINEL: Add a sanity length limit to the header to prevent memory exhaustion DoS or ReDoS
    if (rawForwarded.length > 1024) {
      return defaultIp;
    }

    // When behind a trusted proxy, the last IP in the chain is the most reliable.
    // The leftmost IP can be spoofed by the client.
    const ips = rawForwarded
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && net.isIP(s));
    return ips.length > 0 ? ips[ips.length - 1] : defaultIp;
  }
  return defaultIp;
}
