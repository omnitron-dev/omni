import { ReleaseCommandError, type ReleaseCommand } from '@xec-sh/ops/release';

// Opt-in side channel. Stdout remains the command result and older operators can ignore the option.
export const UPDATE_PROGRESS_ENV = 'OMNITRON_UPDATE_PROGRESS';
const eventName = 'runtime.update.progress';
const maxProgressLine = 16 * 1024;

export function writeRuntimeProgress(message: string): void {
  process.stderr.write(JSON.stringify({ event: eventName, message }) + '\n');
}

function progressMessage(line: string): string | undefined {
  if (!line.startsWith('{"event":"' + eventName + '",')) return undefined;
  try {
    const frame = JSON.parse(line) as { message?: unknown };
    return typeof frame.message === 'string' ? frame.message : undefined;
  } catch { return undefined; }
}

/** Consume native observation events without polling the host or mixing them into its final receipt. */
export function withRuntimeUpdateProgress(run: ReleaseCommand, report: (message: string) => void): ReleaseCommand {
  return async (cwd, executable, args, options = {}) => {
    let partial: string | null = '';
    try {
      return await run(cwd, executable, args, {
        ...options, env: { ...options.env, [UPDATE_PROGRESS_ENV]: '1' },
        onEvent: async event => {
          await options.onEvent?.(event);
          if (event.type !== 'command-output' || event.stream !== 'stderr') return;
          for (const piece of event.text.split(/(?<=\n)/)) {
            if (partial !== null) partial = partial.length + piece.length <= maxProgressLine ? partial + piece : null;
            if (!piece.endsWith('\n')) continue;
            const message = partial === null ? undefined : progressMessage(partial);
            if (message !== undefined) report(message);
            partial = '';
          }
        },
      });
    } catch (error) {
      if (!(error instanceof ReleaseCommandError)) throw error;
      const stderr = error.stderr.split('\n').filter(line => progressMessage(line) === undefined).join('\n');
      if (stderr === error.stderr) throw error;
      throw new ReleaseCommandError(executable, error.status, error.stdout, stderr);
    }
  };
}
