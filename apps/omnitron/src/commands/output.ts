/**
 * CLI output helper — selects between TUI and JSON output modes.
 *
 * Activated by:
 *   - `omnitron --json <command>` (parsed by commander preAction hook)
 *   - `OMNITRON_OUTPUT=json` environment variable
 *
 * In JSON mode every command emits a single JSON object/array on stdout
 * suitable for `jq` / shell pipelines, with no spinners, ANSI codes, or
 * conversational prose. Errors land on stderr as `{"ok": false, "error": ...}`.
 *
 * In TUI mode commands keep their human-friendly output unchanged.
 */

import { log } from '@xec-sh/kit';

export function isJsonMode(): boolean {
  return process.env['OMNITRON_OUTPUT'] === 'json';
}

/**
 * Emit a successful JSON result and return true if JSON mode is active.
 * Caller can use the boolean to skip subsequent TUI rendering:
 *
 *   if (emitJson({ apps })) return;
 *   // …pretty-print path here…
 */
export function emitJson(payload: unknown): boolean {
  if (!isJsonMode()) return false;
  process.stdout.write(JSON.stringify({ ok: true, data: payload }) + '\n');
  return true;
}

/**
 * Emit an error in JSON mode (and return true), otherwise delegate to the
 * normal TUI logger. Always returns the same boolean so callers can early-exit
 * regardless of mode.
 */
export function emitError(message: string, details?: Record<string, unknown>): boolean {
  if (isJsonMode()) {
    const payload = { ok: false, error: message, ...(details ?? {}) };
    process.stderr.write(JSON.stringify(payload) + '\n');
    return true;
  }
  log.error(message);
  return false;
}

/**
 * In JSON mode, suppress this status message; otherwise print it via the TUI logger.
 */
export function emitStep(message: string): void {
  if (isJsonMode()) return;
  log.step(message);
}

export function emitSuccess(message: string): void {
  if (isJsonMode()) return;
  log.success(message);
}

export function emitInfo(message: string): void {
  if (isJsonMode()) return;
  log.info(message);
}
