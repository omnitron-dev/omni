import { afterEach, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
import { stackResumeCommand } from '../../src/commands/stack.js';

const api = vi.hoisted(() => ({ resumeInstalledStack: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({ service: async () => api, disconnect: api.disconnect }),
  LONG_REQUEST_TIMEOUT: 600_000,
  isRequestTimeout: () => false,
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); resetEnvCache(); });

it.each(['running', 'partial', 'unconfirmed'] as const)('preserves the %s recovery outcome and every node in JSON', async outcome => {
  const previous = process.exitCode;
  try {
    process.exitCode = 0;
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    const result = { project: 'sample', stack: 'test', stopOperationId: 'prior', operationId: 'resume', outcome,
      nodes: [{ node: 'first', outcome: outcome === 'running' ? 'running' : 'unconfirmed' }] };
    api.resumeInstalledStack.mockResolvedValue(result);
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
    await stackResumeCommand('sample', 'test');
    expect(api.resumeInstalledStack).toHaveBeenCalledExactlyOnceWith({ project: 'sample', stack: 'test' });
    expect(JSON.parse(output)).toEqual({ ok: true, data: result });
    expect(process.exitCode).toBe(outcome === 'running' ? 0 : 1);
    expect(api.disconnect).toHaveBeenCalledOnce();
  } finally { process.exitCode = previous; }
});

it('reports a disconnected in-flight invocation as unknown and does not retry it', async () => {
  const previous = process.exitCode;
  try {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    api.resumeInstalledStack.mockRejectedValueOnce(Object.assign(new Error('peer disconnected'), { name: 'TransportLostError', code: 503 }));
    let output = '';
    vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
    await stackResumeCommand('sample', 'test');
    expect(JSON.parse(output)).toMatchObject({ ok: false, outcome: 'unknown', reason: 'connection-lost' });
    expect(api.resumeInstalledStack).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  } finally { process.exitCode = previous; }
});
