import { ExecutionEngine } from '@xec-sh/core';
import type { LocalMigrationTarget } from './migration-target.js';

/** One execution only: a disconnected DB may have committed already. Readiness can retry before this call.
 * Xec's internal timeout returns before process close; the owned abort deadline instead waits for the
 * killed local process/stdio. Explicit empty loader variables override Xec 0.11's inherited environment. */
export async function executeLocalMigration(target: LocalMigrationTarget, env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 600_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const engine = new ExecutionEngine({ defaultTimeout: 0, adapters: { local: { killSignal: 'SIGKILL' } } });
  try {
    const result = await engine.execute({ command: process.execPath,
      args: [...(target.sealed ? [] : ['--import', 'tsx/esm']), target.script],
      cwd: target.cwd, shell: false, adapter: 'local', timeout: 0, signal, nothrow: true,
      maxBuffer: 16 * 1024 * 1024,
      env: Object.fromEntries(Object.entries({ ...process.env, ...env,
        ...(target.sealed ? { NODE_OPTIONS: target.nodeOptions, NODE_PATH: '' } : {})
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    });
    if (signal.aborted) throw Error('Migration was interrupted');
    if (result.exitCode !== 0) throw Object.assign(Error('Migration process failed; stack startup refused'), {
      stderr: result.stderr, exitCode: result.exitCode,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (signal.aborted) throw Error('Migration interrupted or timed out; outcome may be unknown. Inspect the migration ledger before retrying.', { cause: error });
    throw error;
  } finally { await engine.dispose(); }
}
