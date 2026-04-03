import { sha3_512 as sha3 } from '@noble/hashes/sha3';

// Pre-computed constants - using const for V8 optimization
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const ALPHABET_LENGTH = 26;
const BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const INITIAL_COUNT_MAX = 476782367;
const DEFAULT_LENGTH = 16;
const BIG_LENGTH = 32;

// Pre-allocate TextEncoder instance (singleton)
const textEncoder = new TextEncoder();

// Cache for frequently used values
let cachedFingerprint: string | null = null;
let cachedCounter: number = Math.floor(Math.random() * INITIAL_COUNT_MAX);

// Pre-computed character lookup for faster entropy generation
// Using charCodeAt for base36 chars is faster than charAt + floor
const b36 = (n: number): string => BASE36_CHARS[n]!;

// Highly optimized entropy creation using direct string concatenation
// Avoiding array allocation and join() which create GC pressure
const createEntropy = (length: number): string => {
  // Direct concatenation is faster than array.join() for small strings
  // V8 optimizes string concatenation with + operator very well
  let result = '';

  // Unroll for common lengths to avoid loop overhead
  switch (length) {
    case 4:
      return (
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0)
      );
    case 8:
      return (
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0)
      );
    case 16:
      return (
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0)
      );
    case 24:
      return (
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0)
      );
    case 32:
      return (
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0) +
        b36((Math.random() * 36) | 0)
      );
    default:
      // Fallback for non-standard lengths - use direct concatenation
      for (let i = 0; i < length; i++) {
        result += b36((Math.random() * 36) | 0);
      }
      return result;
  }
};

// Fully unrolled buffer to BigInt conversion for SHA3-512 (64 bytes = 8 chunks)
// This eliminates loop overhead and allows V8 to optimize more aggressively
const bufToBigInt = (buf: Uint8Array): bigint => {
  const len = buf.length;
  if (len === 0) return 0n;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // SHA3-512 always outputs exactly 64 bytes
  // Fully unroll for maximum performance
  if (len === 64) {
    // Read all 8 chunks directly without loop
    const c0 = view.getBigUint64(0, false);
    const c1 = view.getBigUint64(8, false);
    const c2 = view.getBigUint64(16, false);
    const c3 = view.getBigUint64(24, false);
    const c4 = view.getBigUint64(32, false);
    const c5 = view.getBigUint64(40, false);
    const c6 = view.getBigUint64(48, false);
    const c7 = view.getBigUint64(56, false);

    // Combine chunks: each shift is 64 bits
    return (c0 << 448n) | (c1 << 384n) | (c2 << 320n) | (c3 << 256n) | (c4 << 192n) | (c5 << 128n) | (c6 << 64n) | c7;
  }

  // Fallback for non-64-byte buffers (shouldn't happen for SHA3-512)
  let value = 0n;
  let i = 0;
  const fullChunks = (len >> 3) << 3;

  while (i < fullChunks) {
    value = (value << 64n) | view.getBigUint64(i, false);
    i += 8;
  }

  while (i < len) {
    value = (value << 8n) | BigInt(buf[i]!);
    i++;
  }

  return value;
};

// Optimized hash function with pre-allocated encoder
const hash = (input: string): string => {
  const encoded = textEncoder.encode(input);
  const hashed = sha3(encoded);
  return bufToBigInt(hashed).toString(36).slice(1);
};

// Optimized fingerprint creation with caching
const createFingerprint = (): string => {
  if (cachedFingerprint) return cachedFingerprint;

  const globalObj =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : typeof global !== 'undefined'
          ? global
          : {};

  const globals = Object.keys(globalObj);
  const sourceString = globals.length ? globals.join('') + createEntropy(BIG_LENGTH) : createEntropy(BIG_LENGTH);

  cachedFingerprint = hash(sourceString).substring(0, BIG_LENGTH);
  return cachedFingerprint;
};

// Main optimized CUID generator
// Inlined as much as possible to reduce function call overhead
export const cuid = (): string => {
  // Direct indexing with bitwise OR for faster floor operation
  const firstLetter = ALPHABET[(Math.random() * ALPHABET_LENGTH) | 0]!;

  // Pre-compute timestamp in base36
  const time = Date.now().toString(36);

  // Get counter value and convert to base36
  const count = (++cachedCounter).toString(36);

  // Generate salt
  const salt = createEntropy(DEFAULT_LENGTH);

  // Get fingerprint (always cached after module init)
  const fp = cachedFingerprint!;

  // Template literal is faster than array.join() for 4 items
  // V8 can optimize template literals better at compile time
  const hashInput = `${time}${salt}${count}${fp}`;

  // Inline hash computation to reduce function call overhead
  const hashed = bufToBigInt(sha3(textEncoder.encode(hashInput))).toString(36);

  // Return first letter + hash (skip first char to reduce bias)
  return firstLetter + hashed.substring(1, DEFAULT_LENGTH);
};

// Optimized validation function
export const isCuid = (id: string): boolean => {
  // Early return for invalid types
  if (typeof id !== 'string') return false;

  const len = id.length;

  // Quick length check
  if (len < 2 || len > BIG_LENGTH) return false;

  // Optimized regex check using charCodeAt for first character
  const firstChar = id.charCodeAt(0);
  if (firstChar < 97 || firstChar > 122) return false; // Not a-z

  // Check remaining characters
  for (let i = 1; i < len; i++) {
    const code = id.charCodeAt(i);
    // Check if character is 0-9 or a-z
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 122))) {
      return false;
    }
  }

  return true;
};

// Initialize fingerprint on module load for better performance
createFingerprint();

// Export a factory function for custom configurations
// Creates a closure with pre-computed values for maximum performance
export const createOptimizedCuid = (options?: {
  length?: number;
  fingerprint?: string;
  initialCount?: number;
}): (() => string) => {
  // Pre-compute all options at factory time
  const length = options?.length || DEFAULT_LENGTH;
  const fp = options?.fingerprint || createFingerprint();
  let counter = options?.initialCount ?? (Math.random() * INITIAL_COUNT_MAX) | 0;

  // Return optimized closure
  return (): string => {
    const firstLetter = ALPHABET[(Math.random() * ALPHABET_LENGTH) | 0]!;
    const time = Date.now().toString(36);
    const count = (++counter).toString(36);
    const salt = createEntropy(length);

    // Template literal for fast concatenation
    const hashInput = `${time}${salt}${count}${fp}`;

    // Inline hash computation
    const hashed = bufToBigInt(sha3(textEncoder.encode(hashInput))).toString(36);

    return firstLetter + hashed.substring(1, length);
  };
};
