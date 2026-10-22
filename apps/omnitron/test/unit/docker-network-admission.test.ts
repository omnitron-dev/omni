import { afterEach, describe, expect, it, vi } from 'vitest';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { ensureNetwork } from '../../src/infrastructure/container-runtime.js';

function commandBoundary(run: (args: string[]) => Error | undefined) {
  const calls: string[][] = [];
  vi.spyOn(childProcess, 'execFile').mockImplementation(((file: string, args: string[], _options: unknown, cb: (error: Error | null, stdout: string, stderr: string) => void) => {
    expect(file).toBe('docker');
    calls.push(args);
    const error = run(args);
    cb(error ?? null, error ? '' : '[]', error?.message ?? '');
  }) as never);
  syncBuiltinESMExports();
  return calls;
}
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });

describe('Docker network admission', () => {
  it.each(['host', 'none', 'bridge', 'existing-private'])('reuses %s without creating or changing its driver', async (name) => {
    const calls = commandBoundary(() => undefined);
    await ensureNetwork(name);
    expect(calls).toEqual([['network', 'inspect', name]]);
  });
  it('creates a named bridge only after authoritative absence', async () => {
    const calls = commandBoundary((args) => args[1] === 'inspect' ? new Error('Error response from daemon: network missing not found') : undefined);
    await ensureNetwork('missing');
    expect(calls).toEqual([['network', 'inspect', 'missing'], ['network', 'create', 'missing', '--driver', 'bridge']]);
  });
  it('propagates Docker unavailability instead of treating it as absence', async () => {
    const calls = commandBoundary(() => new Error('Cannot connect to the Docker daemon'));
    await expect(ensureNetwork('private')).rejects.toThrow(/Cannot connect/);
    expect(calls).toHaveLength(1);
  });
  it('rechecks a concurrently created network', async () => {
    let inspected = false;
    const calls = commandBoundary((args) => {
      if (args[1] === 'create') return new Error('network private already exists');
      if (!inspected) { inspected = true; return new Error('No such network: private'); }
    });
    await ensureNetwork('private');
    expect(calls.map((args) => args[1])).toEqual(['inspect', 'create', 'inspect']);
  });
  it('does not turn a container network namespace into a named bridge', async () => {
    const calls = commandBoundary(() => new Error('must not execute'));
    await ensureNetwork('container:worker');
    expect(calls).toHaveLength(0);
  });
});
