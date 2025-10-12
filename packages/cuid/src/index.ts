import { sha3_512 as sha3 } from '@noble/hashes/sha3';

// Pre-computed constants
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const ALPHABET_LENGTH = 26;
const BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const INITIAL_COUNT_MAX = 476782367;
const DEFAULT_LENGTH = 16;
const BIG_LENGTH = 32;

// Pre-allocate TextEncoder instance
const textEncoder = new TextEncoder();

// Cache for frequently used values
let cachedFingerprint: string | null = null;
let cachedCounter: number = Math.floor(Math.random() * INITIAL_COUNT_MAX);

// Optimized entropy creation using pre-allocated string builder
const createEntropy = (length: number): string => {
  let result = '';
  const random = Math.random;

  // Unroll loop for common lengths
  if (length === 4) {
    result =
      BASE36_CHARS.charAt(Math.floor(random() * 36)) +
      BASE36_CHARS.charAt(Math.floor(random() * 36)) +
      BASE36_CHARS.charAt(Math.floor(random() * 36)) +
      BASE36_CHARS.charAt(Math.floor(random() * 36));
  } else {
    // Use string concatenation optimization for longer lengths
    const parts: string[] = new Array(length);
    for (let i = 0; i < length; i++) {
      parts[i] = BASE36_CHARS.charAt(Math.floor(random() * 36));
    }
    result = parts.join('');
  }

  return result;
};

// Pre-cached BigInt shifts for better performance
const BIGINT_SHIFT_8 = 8n;
const BIGINT_SHIFT_16 = 16n;
const BIGINT_SHIFT_24 = 24n;
const BIGINT_SHIFT_32 = 32n;
const BIGINT_SHIFT_40 = 40n;
const BIGINT_SHIFT_48 = 48n;
const BIGINT_SHIFT_56 = 56n;
const BIGINT_SHIFT_64 = 64n;

// Cache for small BigInt values (0-255)
const BIGINT_CACHE: bigint[] = new Array(256);
for (let i = 0; i < 256; i++) {
  BIGINT_CACHE[i] = BigInt(i);
}

// Optimized buffer to BigInt conversion
const bufToBigInt = (buf: Uint8Array): bigint => {
  const len = buf.length;
  if (len === 0) return 0n;

  let value = 0n;
  let i = 0;

  // Process 8-byte chunks efficiently
  const fullChunks = (len >> 3) << 3; // Round down to nearest multiple of 8

  while (i < fullChunks) {
    // Build 8-byte chunk as a single BigInt operation
    // We know these indices are valid because i < fullChunks ensures we have at least 8 bytes
    const b0 = BIGINT_CACHE[buf[i] as number]!;
    const b1 = BIGINT_CACHE[buf[i + 1] as number]!;
    const b2 = BIGINT_CACHE[buf[i + 2] as number]!;
    const b3 = BIGINT_CACHE[buf[i + 3] as number]!;
    const b4 = BIGINT_CACHE[buf[i + 4] as number]!;
    const b5 = BIGINT_CACHE[buf[i + 5] as number]!;
    const b6 = BIGINT_CACHE[buf[i + 6] as number]!;
    const b7 = BIGINT_CACHE[buf[i + 7] as number]!;

    const chunk =
      (b0 << BIGINT_SHIFT_56) |
      (b1 << BIGINT_SHIFT_48) |
      (b2 << BIGINT_SHIFT_40) |
      (b3 << BIGINT_SHIFT_32) |
      (b4 << BIGINT_SHIFT_24) |
      (b5 << BIGINT_SHIFT_16) |
      (b6 << BIGINT_SHIFT_8) |
      b7;

    // Shift accumulated value and add chunk
    value = (value << BIGINT_SHIFT_64) | chunk;
    i += 8;
  }

  // Process remaining bytes (less than 8)
  while (i < len) {
    const byte = BIGINT_CACHE[buf[i] as number]!;
    value = (value << BIGINT_SHIFT_8) | byte;
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

// Inline counter increment for better performance
const getNextCount = (): number => ++cachedCounter;

// Main optimized CUID generator
export const cuid = (): string => {
  // Use direct array indexing for random letter
  const firstLetter = ALPHABET.charAt(Math.floor(Math.random() * ALPHABET_LENGTH));

  // Pre-compute timestamp in base36
  const time = Date.now().toString(36);

  // Get counter value and convert to base36
  const count = getNextCount().toString(36);

  // Generate salt
  const salt = createEntropy(DEFAULT_LENGTH);

  // Get or create fingerprint
  const fingerprint = cachedFingerprint || createFingerprint();

  // Use array join for optimal string concatenation
  const hashInput = [time, salt, count, fingerprint].join('');

  // Generate final hash and build result
  const hashed = hash(hashInput);

  // Use substring for better performance than slice
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
export const createOptimizedCuid = (options?: {
  length?: number;
  fingerprint?: string;
  initialCount?: number;
}): (() => string) => {
  const length = options?.length || DEFAULT_LENGTH;
  const fingerprint = options?.fingerprint || createFingerprint();
  let counter = options?.initialCount || Math.floor(Math.random() * INITIAL_COUNT_MAX);

  return (): string => {
    const firstLetter = ALPHABET.charAt(Math.floor(Math.random() * ALPHABET_LENGTH));
    const time = Date.now().toString(36);
    const count = (++counter).toString(36);
    const salt = createEntropy(length);
    const hashInput = [time, salt, count, fingerprint].join('');
    const hashed = hash(hashInput);

    return firstLetter + hashed.substring(1, length);
  };
};
