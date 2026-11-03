import { isIP } from 'node:net';
import type { RateLimitConfig } from './types.js';

export interface RateLimitResult {
  allowed: boolean;
  message?: string;
  remaining: number;
  /** Unix milliseconds. */
  resetAt: number;
  /** Seconds until another attempt. */
  retryAfter?: number;
  limit: number;
}

export function rateLimitDetails({ retryAfter, limit, remaining, resetAt }: RateLimitResult) {
  return { retryAfter, limit, remaining, resetAt };
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

/** Canonicalise forwarded IP literals so textual aliases cannot create new buckets. */
function addressKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return undefined;
  const [address, zone] = value.split('%');
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16);
    const low = parseInt(mapped[2]!, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return zone ? canonical + '%' + zone : canonical;
}

/**
 * One process-local admission budget shared by any number of Netron listeners.
 * Each client and the whole group have a fixed window starting at their first
 * admitted request. Both reservations happen synchronously before dispatch.
 * Expired keys are removed in insertion order, without a timer per listener.
 */
export class TransportRequestLimiter {
  private readonly config: RateLimitConfig;
  private readonly windows = new Map<string, WindowEntry>();
  private globalWindow?: WindowEntry;
  private readonly whitelist: Set<string>;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly globalMaxRequests: number;
  readonly enabled: boolean;
  readonly message: string;

  constructor(config: RateLimitConfig = {}) {
    this.config = { ...config };
    this.enabled = config.enabled ?? false;
    this.windowMs = config.windowMs ?? 60_000;
    this.maxRequests = config.maxRequests ?? 100;
    this.globalMaxRequests = config.globalMaxRequests ?? 10_000;
    this.message = config.message || 'Too many requests, please try again later';
    if (!Number.isSafeInteger(this.windowMs) || this.windowMs <= 0 ||
        ![this.maxRequests, this.globalMaxRequests].every(v => Number.isSafeInteger(v) && v >= 0)) {
      throw new RangeError('Request limits must be non-negative safe integers and windowMs must be a positive safe integer');
    }
    this.whitelist = new Set((config.whitelist ?? []).map(key => addressKey(key) ?? key));
  }

  clientKey(request: Request, remoteAddress?: string): string {
    if (!this.enabled) return '';
    if (this.config.keyGenerator) return this.config.keyGenerator(request);
    if (this.config.trustProxy) {
      const first = request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim();
      const forwarded = addressKey(first) ?? addressKey(request.headers.get('x-real-ip')?.trim());
      if (forwarded) return forwarded;
    }
    return addressKey(remoteAddress) ?? 'unknown';
  }

  check(request: Request, remoteAddress?: string): RateLimitResult {
    return this.consume(this.clientKey(request, remoteAddress));
  }

  consume(key: string, cost = 1): RateLimitResult {
    if (!Number.isSafeInteger(cost) || cost < 1) throw new RangeError('Request cost must be a positive safe integer');
    const now = Date.now();
    const resetAt = now + this.windowMs;
    if (!this.enabled || this.whitelist.has(key)) {
      return { allowed: true, remaining: this.maxRequests, resetAt, limit: this.maxRequests };
    }

    this.cleanup(now);
    const global = this.globalWindow ?? { count: 0, resetAt };
    const client = this.windows.get(key) ?? { count: 0, resetAt };
    // Reject an exhausted client without spending anyone else's allowance.
    for (const [window, limit] of [[client, this.maxRequests], [global, this.globalMaxRequests]] as const) {
      if (cost > limit - window.count) {
        return { allowed: false, message: this.message, remaining: 0, resetAt: window.resetAt, limit, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
      }
    }
    client.count += cost;
    global.count += cost;
    this.windows.set(key, client);
    this.globalWindow = global;
    return { allowed: true, remaining: this.maxRequests - client.count, resetAt: client.resetAt, limit: this.maxRequests };
  }

  /** Compatibility with callers that explicitly refund an admitted HTTP request. */
  decrement(request: Request, remoteAddress?: string): void {
    const key = this.clientKey(request, remoteAddress);
    this.cleanup();
    const window = this.windows.get(key);
    if (!window || !this.globalWindow || this.whitelist.has(key)) return;
    if (--window.count === 0) this.windows.delete(key);
    this.globalWindow.count = Math.max(0, this.globalWindow.count - 1);
  }

  shouldSkip(_request: Request, success: boolean): boolean {
    return this.enabled && (success ? this.config.skipSuccessfulRequests === true : this.config.skipFailedRequests === true);
  }

  cleanup(now = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt > now) break;
      this.windows.delete(key);
    }
    if (this.globalWindow && this.globalWindow.resetAt <= now) this.globalWindow = undefined;
  }

  destroy(): void {
    this.windows.clear();
    this.globalWindow = undefined;
  }

  getStats() {
    this.cleanup();
    return {
      enabled: this.enabled, activeClients: this.windows.size, globalCount: this.globalWindow?.count ?? 0,
      globalResetAt: this.globalWindow?.resetAt ?? null,
      config: { windowMs: this.windowMs, maxRequests: this.maxRequests, globalMaxRequests: this.globalMaxRequests },
    };
  }
}
