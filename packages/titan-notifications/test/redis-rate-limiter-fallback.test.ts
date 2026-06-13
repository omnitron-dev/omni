/**
 * NT-6: when Redis is unavailable the RedisRateLimiter falls back to an in-memory
 * store. That fallback used to track ONLY the per-minute tier, so the burst,
 * hour, and day caps were silently unenforced during a Redis outage — an
 * attacker could send up to 86400/day while staying under 60/min. The fallback
 * now mirrors the Redis path and enforces every configured tier.
 *
 * These tests construct the limiter with NO redis client (forcing the in-memory
 * path) and pick limits where a NON-minute tier is the binding constraint.
 */

import { describe, it, expect } from 'vitest';
import { RedisRateLimiter } from '../src/redis-rate-limiter.js';

describe('RedisRateLimiter in-memory fallback enforces all tiers (NT-6)', () => {
  it('enforces the hour limit (not just per-minute) when Redis is down', async () => {
    const rl = new RedisRateLimiter(undefined, {
      defaultLimits: { perMinute: 1000, perHour: 3, perDay: 1000, burstLimit: 1000, burstWindowMs: 1000 },
      enableBurstDetection: true,
    });

    for (let i = 0; i < 3; i++) {
      expect((await rl.checkLimit('user1', 'email')).allowed).toBe(true);
      await rl.recordSent('user1', 'email');
    }
    // 4th attempt: hour count (3) >= perHour (3) → blocked, though minute (3) is
    // nowhere near its 1000 cap. Pre-NT-6 this returned allowed:true.
    expect((await rl.checkLimit('user1', 'email')).allowed).toBe(false);
  });

  it('enforces the day limit when Redis is down', async () => {
    const rl = new RedisRateLimiter(undefined, {
      defaultLimits: { perMinute: 1000, perHour: 1000, perDay: 2, burstLimit: 1000, burstWindowMs: 1000 },
    });

    await rl.recordSent('u', 'sms');
    await rl.recordSent('u', 'sms');
    expect((await rl.checkLimit('u', 'sms')).allowed).toBe(false); // day cap = 2
  });

  it('enforces burst in the fallback', async () => {
    const rl = new RedisRateLimiter(undefined, {
      // wide time tiers, tiny burst within a 1-minute window so it can't roll mid-test
      defaultLimits: { perMinute: 1000, perHour: 1000, perDay: 1000, burstLimit: 2, burstWindowMs: 60000 },
      enableBurstDetection: true,
    });

    await rl.recordSent('u', 'push');
    await rl.recordSent('u', 'push');
    expect((await rl.checkLimit('u', 'push')).allowed).toBe(false); // burst cap = 2
  });

  it('still allows traffic under every tier', async () => {
    const rl = new RedisRateLimiter(undefined, {
      defaultLimits: { perMinute: 10, perHour: 100, perDay: 1000, burstLimit: 10, burstWindowMs: 1000 },
    });
    await rl.recordSent('u', 'email');
    expect((await rl.checkLimit('u', 'email')).allowed).toBe(true);
  });
});
