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
import { isJsonOutput } from '../shared/env-config.js';

export function isJsonMode(): boolean {
  return isJsonOutput();
}

/**
 * Whether this process has written anything machine-readable yet.
 *
 * `--json` is a global flag, but honouring it is per-command, and most
 * commands do not: they render a table with box-drawing characters and ANSI
 * colour, and say nothing about having ignored the flag. A script asking for
 * JSON gets a picture of a table, with no way to tell that from data.
 *
 * `installJsonModeGuard` uses this to turn that silence into a parseable
 * answer.
 */
let emittedJson = false;

export function hasEmittedJson(): boolean {
  return emittedJson;
}

/**
 * Announce, in JSON, that this command has no JSON output — and fail.
 *
 * Called on exit when `--json` was asked for and nothing answered it.
 * Refusing loudly is the only honest option: succeeding would hand the
 * caller a table, and staying silent would hand it nothing while claiming
 * success.
 */
export function installJsonModeGuard(commandPath: string): void {
  process.on('exit', () => {
    if (!isJsonMode() || emittedJson) return;
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error: `\`${commandPath}\` does not support --json; its output is human-readable only.`,
        command: commandPath,
        hint: 'Commands that do support it emit a single {"ok":…} object on stdout.',
      }) + '\n'
    );
    if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 2;
  });
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
  emittedJson = true;
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
    emittedJson = true;
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
