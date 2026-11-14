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

import { log, spinner, type SpinnerResult } from '@xec-sh/kit';
import { isJsonOutput } from '../shared/env-config.js';

export function isJsonMode(): boolean {
  return isJsonOutput();
}

/** Kit owns terminal and redirected rendering; machine output has no progress stream. */
export function createProgress(): SpinnerResult {
  return spinner({ enabled: !isJsonMode() });
}

/** Whether the admitted action has emitted its shared machine result. */
let emittedJson = false;

export function hasEmittedJson(): boolean {
  return emittedJson;
}

/**
 * A declared machine-output action must produce a result even when its handler
 * accidentally returns silently. Admission happens before the action in
 * prepareCommandOutput; this fallback must never claim no operation occurred.
 */
let removeJsonGuard: (() => void) | undefined;
let completeJsonGuard: (() => void) | undefined;
export function installJsonModeGuard(commandPath: string): () => void {
  removeJsonGuard?.();
  emittedJson = false;
  const onExit = () => {
    if (!isJsonMode() || emittedJson) return;
    emitError(`\`${commandPath}\` completed without its declared JSON result.`, {
      code: 'JSON_OUTPUT_CONTRACT_VIOLATION',
      command: commandPath,
      outcome: 'unknown',
      hint: 'The operation may have completed. Inspect its state before retrying.',
    });
    if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
  };
  process.on('exit', onExit);
  const remove = () => {
    process.removeListener('exit', onExit);
    if (removeJsonGuard === remove) {
      removeJsonGuard = undefined;
      completeJsonGuard = undefined;
    }
  };
  removeJsonGuard = remove;
  completeJsonGuard = () => {
    onExit();
    remove();
  };
  return remove;
}

/** Validate the result before exitAfterOutput drains stdout/stderr. */
export function finishJsonModeGuard(): void {
  completeJsonGuard?.();
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
export function emitError(error: unknown, details?: Record<string, unknown>): boolean {
  const value = error !== null && typeof error === 'object' ? error as Record<string, unknown> : undefined;
  const message = typeof error === 'string' ? error : typeof value?.['message'] === 'string' ? value['message'] : String(error);
  if (isJsonMode()) {
    emittedJson = true;
    // The same fields survive native Errors and Netron's serialized errors.
    // Do not expose the stack, cause graph or other attached process state.
    const code = value?.['code'];
    const errorDetails = value?.['details'];
    const payload: Record<string, unknown> = { ok: false, error: message,
      ...((typeof code === 'string' || typeof code === 'number' && Number.isFinite(code)) && { code }),
      ...(errorDetails !== undefined && { details: errorDetails }), ...(details ?? {}) };
    let encoded: string;
    try { encoded = JSON.stringify(payload); }
    catch {
      const retainedCode = payload['code'];
      encoded = JSON.stringify({ ok: false, error: message, detailsError: 'not-json-serializable',
        ...((typeof retainedCode === 'string' || typeof retainedCode === 'number' && Number.isFinite(retainedCode)) && { code: retainedCode }) });
    }
    process.stderr.write(encoded + '\n');
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
