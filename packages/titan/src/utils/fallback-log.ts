/**
 * Structured JSON Fallback Logger
 *
 * Used in contexts where the Titan ILogger is not available (early bootstrap,
 * DI resolution failure, error handler fallbacks). Writes pino-compatible JSON
 * to stderr so that the omnitron log pipeline can parse every line uniformly.
 *
 * This is NOT a replacement for the real logger — it exists solely to guarantee
 * that no plain-text log lines escape into structured log streams.
 */

// Pino numeric log levels
const LEVEL = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;
type FallbackLevel = keyof typeof LEVEL;

/**
 * Write a single structured JSON log entry to stderr.
 *
 * @param level  - Severity (trace..fatal)
 * @param msg    - Human-readable message
 * @param data   - Optional structured context (serialized into the JSON line)
 */
export function fallbackLog(level: FallbackLevel, msg: string, data?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    level: LEVEL[level],
    time: new Date().toISOString(),
    pid: process.pid,
    msg,
  };
  if (data) {
    // Merge data fields, serialising errors if present
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof Error) {
        entry[k] = { message: v.message, stack: v.stack, type: v.name };
      } else {
        entry[k] = v;
      }
    }
  }

  try {
    process.stderr.write(JSON.stringify(entry) + '\n');
  } catch {
    // Last-resort: if JSON.stringify fails (circular ref), write minimal entry
    process.stderr.write(JSON.stringify({ level: LEVEL[level], time: new Date().toISOString(), pid: process.pid, msg }) + '\n');
  }
}
