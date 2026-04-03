/**
 * Secure ID Generation Utilities for Distributed Systems
 *
 * This module provides cryptographically secure ID generation functions
 * suitable for distributed environments where ID collisions must be avoided.
 *
 * All functions use Node.js crypto module for proper entropy.
 *
 * @module utils/id
 * @since 0.5.0
 */

import { randomBytes } from 'node:crypto';

// =============================================================================
// UUIDv7 — RFC 9562 Compliant, Monotonic, High-Performance
// =============================================================================

/**
 * Pre-computed byte-to-hex lookup table.
 * Eliminates per-byte toString(16) + padStart overhead during formatting.
 */
const BYTE_TO_HEX: readonly string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * Random byte pool for amortized syscall cost.
 *
 * Each UUIDv7 needs 10 random bytes (2 for initial counter seed + 8 for rand_b).
 * Pool of 640 bytes serves ~64 UUIDs per single randomBytes() call,
 * reducing crypto syscall overhead by ~64x under burst load.
 */
const POOL_SIZE = 640;
let _pool = randomBytes(POOL_SIZE);
let _poolOffset = POOL_SIZE; // Start exhausted to force first fill

function pooledRandom(n: number): Buffer {
  if (_poolOffset + n > POOL_SIZE) {
    _pool = randomBytes(POOL_SIZE);
    _poolOffset = 0;
  }
  const start = _poolOffset;
  _poolOffset += n;
  return _pool.subarray(start, start + n);
}

/**
 * Monotonic counter state (per-process singleton).
 *
 * RFC 9562 §6.2 Method 1: fixed-length dedicated counter in rand_a (12 bits).
 * - Same millisecond: counter increments (up to 4096 UUIDs/ms = 4M/sec)
 * - Counter overflow: timestamp advances by 1ms (guaranteed monotonic)
 * - New millisecond: counter re-seeded with random value (prevents cross-process collisions)
 */
let _lastMs = 0;
let _seq = 0;

/**
 * Generate a UUIDv7 (RFC 9562) with per-process monotonic ordering guarantee.
 *
 * Layout (128 bits):
 * ```
 * 0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                         unix_ts_ms (48 bits)                  |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |          unix_ts_ms           | ver=7 |   seq_hi (12 bits)    |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |var=10|            rand_b (62 bits)                             |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                         rand_b (continued)                    |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * ```
 *
 * Performance characteristics:
 * - Monotonic within same millisecond via 12-bit counter (4096 IDs/ms capacity)
 * - Random byte pooling: amortizes crypto syscall over ~64 UUIDs
 * - Pre-computed hex lookup table: O(1) byte-to-hex conversion
 * - B-tree friendly: timestamp prefix ensures sequential index writes
 * - 62 bits of randomness per ID: collision-safe across processes
 *
 * @returns RFC 9562 compliant UUIDv7 string (e.g. "018ef4f2-5b6e-7abc-8def-1234567890ab")
 */
export function generateUuidV7(): string {
  const now = Date.now();

  if (now > _lastMs) {
    _lastMs = now;
    // Random initial counter prevents cross-process monotonicity collisions
    const seed = pooledRandom(2);
    _seq = ((seed[0]! << 8) | seed[1]!) & 0xfff;
  } else {
    _seq++;
    if (_seq > 0xfff) {
      // Counter overflow: advance timestamp to maintain monotonicity
      _lastMs++;
      const seed = pooledRandom(2);
      _seq = ((seed[0]! << 8) | seed[1]!) & 0xfff;
    }
  }

  // 48-bit timestamp — split into high 16 bits and low 32 bits
  // (bitwise ops truncate to 32 bits, so we use division for the high part)
  const ms = _lastMs;
  const msHi = Math.trunc(ms / 0x100000000);
  const msLo = ms >>> 0;

  // 62-bit random (rand_b) from pool
  const rand = pooledRandom(8);

  // Format directly via lookup table — avoids intermediate array allocation
  return (
    BYTE_TO_HEX[(msHi >>> 8) & 0xff]! +
    BYTE_TO_HEX[msHi & 0xff]! +
    BYTE_TO_HEX[(msLo >>> 24) & 0xff]! +
    BYTE_TO_HEX[(msLo >>> 16) & 0xff]! +
    '-' +
    BYTE_TO_HEX[(msLo >>> 8) & 0xff]! +
    BYTE_TO_HEX[msLo & 0xff]! +
    '-' +
    // Version 7 (0111) + seq high 8 bits
    BYTE_TO_HEX[0x70 | ((_seq >>> 8) & 0x0f)]! +
    BYTE_TO_HEX[_seq & 0xff]! +
    '-' +
    // Variant 10 + rand_b[0] high 6 bits
    BYTE_TO_HEX[0x80 | (rand[0]! & 0x3f)]! +
    BYTE_TO_HEX[rand[1]!]! +
    '-' +
    BYTE_TO_HEX[rand[2]!]! +
    BYTE_TO_HEX[rand[3]!]! +
    BYTE_TO_HEX[rand[4]!]! +
    BYTE_TO_HEX[rand[5]!]! +
    BYTE_TO_HEX[rand[6]!]! +
    BYTE_TO_HEX[rand[7]!]!
  );
}

/**
 * Extract the Unix timestamp (ms) from a UUIDv7 string.
 * Useful for debugging, sorting validation, and time-based queries.
 *
 * @param uuid - A UUIDv7 string (with or without dashes)
 * @returns Unix timestamp in milliseconds, or NaN if invalid
 */
export function extractUuidV7Timestamp(uuid: string): number {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) return NaN;
  // First 12 hex chars = 48-bit timestamp
  const hi = parseInt(hex.slice(0, 8), 16);
  const lo = parseInt(hex.slice(8, 12), 16);
  return hi * 0x10000 + lo;
}

/**
 * Generate a cryptographically secure resolution ID.
 * Format: res_<32-char UUID without dashes>
 *
 * @returns A unique resolution ID safe for distributed systems
 * @example
 * ```typescript
 * const id = generateResolutionId();
 * // => "res_550e8400e29b41d4a716446655440000"
 * ```
 */
export function generateResolutionId(): string {
  return 'res_' + generateUuidV7().replace(/-/g, '');
}

/**
 * Generate a 32-character hex trace ID (OpenTelemetry compatible).
 * Uses 16 bytes of cryptographically secure random data.
 *
 * @returns A 32-character hexadecimal trace ID
 * @example
 * ```typescript
 * const traceId = generateTraceId();
 * // => "a1b2c3d4e5f6789012345678abcdef00"
 * ```
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a 16-character hex span ID (OpenTelemetry compatible).
 * Uses 8 bytes of cryptographically secure random data.
 *
 * @returns A 16-character hexadecimal span ID
 * @example
 * ```typescript
 * const spanId = generateSpanId();
 * // => "a1b2c3d4e5f67890"
 * ```
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Generate a unique lock value for Redis distributed locks.
 * Uses 16 bytes (128 bits) of entropy for collision resistance.
 *
 * @returns A 32-character hexadecimal lock value
 * @example
 * ```typescript
 * const lockValue = generateLockValue();
 * // => "a1b2c3d4e5f6789012345678abcdef00"
 * ```
 */
export function generateLockValue(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a unique connection ID.
 * Format: conn_<16-char hex>
 *
 * @returns A unique connection identifier
 * @example
 * ```typescript
 * const connId = generateConnectionId();
 * // => "conn_a1b2c3d4e5f67890"
 * ```
 */
export function generateConnectionId(): string {
  return 'conn_' + randomBytes(8).toString('hex');
}

/**
 * Generate a cryptographically secure UUID v4.
 * Wrapper around crypto.randomUUID for consistency.
 *
 * @returns A RFC 4122 compliant UUID v4
 * @example
 * ```typescript
 * const uuid = generateUuid();
 * // => "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function generateUuid(): string {
  return generateUuidV7();
}

/**
 * Generate a prefixed secure ID for various use cases.
 * Format: <prefix>_<16-char hex>
 *
 * @param prefix - The prefix to use (e.g., 'task', 'job', 'exec')
 * @returns A unique prefixed identifier
 * @example
 * ```typescript
 * const taskId = generatePrefixedId('task');
 * // => "task_a1b2c3d4e5f67890"
 *
 * const jobId = generatePrefixedId('job');
 * // => "job_b2c3d4e5f6789012"
 * ```
 */
export function generatePrefixedId(prefix: string): string {
  return prefix + '_' + randomBytes(8).toString('hex');
}

/**
 * Generate a short secure ID (12 characters).
 * Uses 6 bytes of entropy encoded as hex.
 * Suitable for human-readable IDs where collision is less critical.
 *
 * @returns A 12-character hexadecimal ID
 * @example
 * ```typescript
 * const shortId = generateShortId();
 * // => "a1b2c3d4e5f6"
 * ```
 */
export function generateShortId(): string {
  return randomBytes(6).toString('hex');
}
