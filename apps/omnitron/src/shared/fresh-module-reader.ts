/** One bounded, fresh module graph for definition and ecosystem readers.
 * Extracted from the bootstrap reader lifecycle: wait for the answer, exit and
 * IPC close before returning; no long-lived process/module cache is retained. */
import path from 'node:path';
import fs from 'node:fs';
import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serialize } from 'node:v8';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';

export const FRESH_MODULE_ANSWER = 'omnitron:module-reader:answer';
export const FRESH_MODULE_MARK = 'OMNITRON_MODULE_READER_CHILD';
const STDERR_TAIL_CHARS = 4_000;
const MODULE_READ_OUTPUT_BYTES = 1024 * 1024;
const MODULE_READ_RESULT_BYTES = 16 * 1024 * 1024;
export type FreshModuleAnswer =
  | { type: typeof FRESH_MODULE_ANSWER; ok: true; value: unknown }
  | { type: typeof FRESH_MODULE_ANSWER; ok: false; message: string; name?: string | undefined; stack?: string | undefined };
export interface FreshModuleReadOptions {
  entryPath: string;
  args: string[];
  timeoutMs: number;
  label: string;
  typescript?: boolean;
}
/** Locate the checked-in child beside source or compiled caller; never a cwd guess. */
export function moduleReaderEntry(callerUrl: string, name: string): string {
  const file = fileURLToPath(callerUrl);
  return path.join(path.dirname(file), name + path.extname(file));
}

/** Install before importing user code, so an abandoned parent cannot leave a reader. */
export function initializeModuleReader(): void {
  if (!process.send || !process.env[FRESH_MODULE_MARK]) throw Error('Module reader requires its parent IPC channel');
  process.once('disconnect', () => process.exit(3));
}

export function answerModuleRead(result: { ok: true; value: unknown } | { ok: false; error: unknown }): void {
  let message: FreshModuleAnswer;
  if (result.ok) {
    try {
      if (serialize(result.value).byteLength > MODULE_READ_RESULT_BYTES) throw Error('Module configuration exceeds its 16 MiB result budget');
      message = { type: FRESH_MODULE_ANSWER, ok: true, value: result.value };
    } catch (error) { answerModuleRead({ ok: false, error }); return; }
  } else {
    const error = result.error instanceof Error ? result.error : Error(String(result.error));
    message = { type: FRESH_MODULE_ANSWER, ok: false, message: redactDiagnosticText(error.message),
      name: error.name, stack: error.stack ? redactDiagnosticText(error.stack) : undefined };
  }
  if (!process.send) process.exit(2);
  process.send(message, undefined, {}, error => process.exit(error ? 2 : message.ok ? 0 : 1));
}

/** Flags `childExecArgv` drops that carry a value, inline or as the next argument. */
const DROPPED_WITH_VALUE = new Set([
  '-e', '--eval', '-p', '--print', '-pe', '--input-type', '--inspect-port', '--debug-port', '--watch-path',
]);

/**
 * This process's Node flags as the reading process should get them.
 *
 * Everything that shapes how modules resolve and load is kept, so the child
 * reads the definition exactly as this process would have — `--import
 * tsx/esm` first of all, which the daemon is started with (spawn-daemon.ts)
 * and `canLoadTypeScript` looks for. What goes is what would make the child a
 * different program than its entry: `-e`/`-p` and their code, which it would
 * run instead (node's own `fork` drops them for the same reason, but only
 * from an unmodified `process.execArgv`); `--input-type`, which node refuses
 * beside a file entry; an inspector flag, whose port is this process's and
 * whose `-brk` would wait for a debugger until the deadline; and watch mode,
 * which restarts where the child must exit.
 */
function childExecArgv(parentArgv: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < parentArgv.length; i++) {
    const arg = parentArgv[i]!;
    const flag = arg.split('=', 1)[0]!;
    if (DROPPED_WITH_VALUE.has(flag)) {
      // `--flag value` takes the next argument with it; `--flag=value` does not.
      if (arg === flag) i++;
      continue;
    }
    if (flag.startsWith('--inspect') || flag.startsWith('--debug') || flag.startsWith('--watch')) continue;
    if (flag === '--import') {
      const specifier = arg === flag ? parentArgv[i + 1] : arg.slice(flag.length + 1);
      if (specifier === 'tsx' || specifier === 'tsx/esm') {
        // The daemon starts in its installed package, then may chdir to the
        // project or service home. A bare preload resolves from the child's
        // cwd before its entry runs. Pin our loader to this runtime without
        // changing the working directory seen by the application definition.
        const loader = pathToFileURL(createRequire(import.meta.url).resolve(specifier)).href;
        if (arg === flag) { kept.push(flag, loader); i++; }
        else kept.push(`${flag}=${loader}`);
        continue;
      }
    }
    kept.push(arg);
  }
  return kept;
}

function isAnswer(message: unknown): message is FreshModuleAnswer {
  if (!message || typeof message !== 'object') return false;
  const m = message as Record<string, unknown>;
  if (m['type'] !== FRESH_MODULE_ANSWER) return false;
  return m['ok'] === true ? 'value' in m : m['ok'] === false && typeof m['message'] === 'string';
}

/**
 * Read one definition in a process started for it, and wait until that
 * process is gone. Resolves with what it answered; rejects with its error's
 * message when it answered with one, and otherwise with how it ended and the
 * last of its stderr.
 */
export function readInFreshProcess(options: FreshModuleReadOptions): Promise<unknown> {
  const { entryPath, args, timeoutMs, label } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) return Promise.reject(Error('Invalid module read deadline'));
  if (process.env[FRESH_MODULE_MARK]) {
    return Promise.reject(
      new Error(`a process reading a module does not start another (${label})`),
    );
  }
  const execArgv = childExecArgv(process.execArgv ?? []);
  if ((path.extname(entryPath) === '.ts' || options.typescript) && typeof (globalThis as any).Bun === 'undefined' && !execArgv.some(arg => arg.includes('tsx')))
    execArgv.push('--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href);
  if (!fs.existsSync(entryPath)) {
    return Promise.reject(new Error(`the module reader ${entryPath} is missing — is this build complete?`));
  }

  return new Promise<unknown>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(entryPath, args, {
        execArgv,
        env: { ...process.env, [FRESH_MODULE_MARK]: '1' },
        // Configuration output is bounded and private. Only a redacted error tail
        // may leave this reader; stdout must not corrupt CLI JSON or leak secrets.
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'advanced',
      });
    } catch (err) {
      reject(new Error(`could not start a process to read ${label}: ${(err as Error).message}`, { cause: err }));
      return;
    }

    let answer: FreshModuleAnswer | undefined;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let channelClosed = false;
    let timedOut = false;
    let concluding = false;
    let settled = false;
    let stderrTail = '';
    let outputBytes = 0;
    let outputExceeded = false;
    const observeOutput = (chunk: string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MODULE_READ_OUTPUT_BYTES) { outputExceeded = true; child.kill('SIGKILL'); }
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', observeOutput);
    const timers: NodeJS.Timeout[] = [];

    const stdoutClosed = new Promise<void>(done => {
      if (!child.stdout) done(); else child.stdout.once('close', done);
    });
    const stderrClosed = new Promise<void>((done) => {
      if (!child.stderr) {
        done();
        return;
      }
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
        observeOutput(chunk);
      });
      child.stderr.once('close', () => done());
    });

    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      child.stdout?.destroy(); child.stderr?.destroy();
      outcome();
    };

    // The answer, if one was sent, has been delivered once the process has
    // exited AND its channel has closed — `exit` alone can come first.
    const conclude = async (): Promise<void> => {
      if (concluding || settled || !exit || !channelClosed) return;
      concluding = true;
      await Promise.race([Promise.all([stdoutClosed, stderrClosed]), new Promise<void>(done => timers.push(setTimeout(done, 500)))]);
      if (answer?.ok && !outputExceeded && !timedOut && exit.code === 0) {
        const value = answer.value;
        settle(() => resolve(value));
        return;
      }
      if (answer && !answer.ok && !outputExceeded && !timedOut) {
        const failure = answer;
        settle(() => reject(errorFromAnswer(failure)));
        return;
      }
      // No answer: what the process said on its way out is the explanation,
      // and a moment lets the pipe deliver its last lines — never longer, as
      // something the definition started may hold the pipe open.
      const ended = exit;
      const how = outputExceeded ? `exceeded its ${MODULE_READ_OUTPUT_BYTES} byte output budget` : timedOut
        ? `did not answer within ${timeoutMs / 1000} s and was killed`
        : ended.signal
          ? `was ended by ${ended.signal} before answering`
          : `exited with code ${ended.code} before answering`;
      const said = redactDiagnosticText(stderrTail.trim());
      settle(() => reject(new Error(`the process reading ${label} ${how}${said ? `:\n${said}` : ''}`)));
    };

    child.on('message', (message: unknown) => {
      if (!answer && isAnswer(message)) answer = message;
    });
    child.once('disconnect', () => {
      channelClosed = true;
      void conclude();
    });
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      // The channel closes right behind the process. Should it not, what
      // arrived by then is all there is.
      timers.push(setTimeout(() => {
        channelClosed = true;
        void conclude();
      }, 1_000));
      void conclude();
    });
    child.on('error', (err) => {
      // Only a process that never started has no exit to wait for.
      if (child.pid === undefined) {
        settle(() => reject(new Error(`could not start a process to read ${label}: ${err.message}`, { cause: err })));
      }
    });

    timers.push(setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs));
  });
}

function errorFromAnswer(answer: Extract<FreshModuleAnswer, { ok: false }>): Error {
  const message = redactDiagnosticText(answer.message);
  const cause = answer.stack ? Object.assign(Error(message), {
    name: answer.name ?? 'Error', stack: redactDiagnosticText(answer.stack),
  }) : undefined;
  return new Error(message, cause ? { cause } : undefined);
}
