/** Shared admission limits; safe to import without loading the interpreter. */
export const PLAYGROUND_LIMITS = Object.freeze({ codeBytes: 65_536, resultBytes: 65_536, memoryBytes: 16 * 1024 * 1024, stackBytes: 512 * 1024, timeoutMs: 1850, maxTimeoutMs: 5000, jobs: 10_000 });
