import { fileURLToPath } from 'node:url';
import { PassThrough, type Readable } from 'node:stream';
import { ExecutionEngine } from '@xec-sh/core';
import type { RegistryPackage } from './layout.js';

export interface RegistryTransportOptions {
  /** The exact clean checkout also used by the ordinary frozen install. */
  checkout: string;
  env: NodeJS.ProcessEnv;
  scratch: string;
  signal?: AbortSignal;
}

export type RegistryFailure = 'configuration' | 'authentication' | 'metadata' | 'http' | 'network' | 'worker' | 'timeout' | 'cancelled';
const failures: readonly RegistryFailure[] = ['configuration', 'authentication', 'metadata', 'http', 'network', 'worker', 'timeout', 'cancelled'];

/** Deliberately excludes URLs, configuration, helper output and raw causes. */
export class RegistryTransportError extends Error {
  readonly code = 'REGISTRY_ARCHIVE_UNAVAILABLE';
  constructor(readonly category: RegistryFailure, readonly status?: number) {
    super(`Framework registry download failed: ${category}${status === undefined ? '' : ` (HTTP ${status})`}`);
  }
}

function reportedFailure(stderr: string): RegistryTransportError | undefined {
  try {
    const value = JSON.parse(stderr) as { category?: unknown; status?: unknown };
    if (!failures.includes(value.category as RegistryFailure)) return undefined;
    const status = typeof value.status === 'number' && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599
      ? value.status : undefined;
    return new RegistryTransportError(value.category as RegistryFailure, status);
  } catch { return undefined; }
}

/** pnpm's configuration reader and token helpers run in the build environment,
 * never by changing the daemon's cwd/env. Xec owns cancellation and the process
 * tree. Only archive bytes leave stdout; the caller remains the SHA-512 and
 * archive-layout authority. No package or pnpmfile hooks are executed. */
export async function withRegistryArchive<T>(
  pkg: RegistryPackage, options: RegistryTransportOptions,
  consume: (stream: Readable, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (options.signal?.aborted) throw new RegistryTransportError('cancelled');
  const stopped = new AbortController();
  const timeout = AbortSignal.timeout(60_000);
  const signal = AbortSignal.any([stopped.signal, timeout, ...(options.signal ? [options.signal] : [])]);
  const output = new PassThrough();
  const engine = new ExecutionEngine({ adapters: { local: { killSignal: 'SIGKILL' } } });
  const inspection = consume(output, signal);
  // An invalid archive stops the producer as well as its stream.
  void inspection.catch(() => { if (!output.writableEnded) stopped.abort(); });
  const execution = engine.execute({
    command: process.execPath,
    args: [fileURLToPath(new URL('./registry-download.js', import.meta.url))],
    cwd: options.checkout,
    env: Object.fromEntries(Object.entries(options.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    // Xec's timeout races process completion. Its signal path waits for close;
    // disable the default timer so our bounded signal is the sole deadline.
    adapter: 'local', shell: false, signal, timeout: 0, maxBuffer: 2048, nothrow: true,
    stdin: JSON.stringify(pkg), stdout: output, stderr: 'pipe',
  }).finally(() => { if (!output.writableEnded) output.end(); });
  try {
    const [inspected, executed] = await Promise.allSettled([inspection, execution]);
    if (options.signal?.aborted) throw new RegistryTransportError('cancelled');
    if (timeout.aborted) throw new RegistryTransportError('timeout');
    if (executed.status === 'fulfilled' && executed.value.exitCode !== 0) {
      const reported = reportedFailure(executed.value.stderr);
      if (reported) throw reported;
      // Preserve an archive validation failure that deliberately stopped Xec.
      if (inspected.status === 'rejected' && stopped.signal.aborted) throw inspected.reason;
      throw new RegistryTransportError('worker');
    }
    if (executed.status === 'rejected') {
      if (inspected.status === 'rejected' && stopped.signal.aborted) throw inspected.reason;
      throw new RegistryTransportError('worker');
    }
    if (inspected.status === 'rejected') throw inspected.reason;
    return inspected.value;
  } finally {
    stopped.abort();
    output.destroy();
    await engine.dispose();
  }
}
