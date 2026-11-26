import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { executionFenceScenarios } from '../fixtures/node-deploy-scenarios.js';
import * as protocol from '../../src/services/node-deploy-lease.js';
import { guardScript, NodeLease, parseAcquire, parseRelease } from '../../src/services/node-deploy-lease.js';

describe('remote execution fencing', () => {
  it('treats active and unresolved execution as refusals, never a lease grant', () => {
    expect(() => parseAcquire('node', 'LAPSED 121\t{}\nEXECUTION-BUSY')).toThrow('still executing');
    expect(() => parseAcquire('node', 'EXECUTION-UNRESOLVED')).toThrow('inspected recovery');
    expect(() => parseAcquire('node', 'UNSAFE-LOCKS')).toThrow('exclusive write access');
    expect(parseRelease('node', 'EXECUTION-BUSY')).toEqual({ kind: 'busy' });
    expect(parseRelease('node', 'EXECUTION-UNRESOLVED')).toEqual({ kind: 'busy' });
  });
  it('refuses unbounded or malformed native deadlines', () => {
    const timing = { dir: '/tmp/fence', leaseSec: 2, renewEveryMs: 500 };
    for (const timeout of [0, -1, Infinity, 0.5, 86_400_001]) expect(() => guardScript(timing, 'A', 'true', timeout)).toThrow('timeout');
  });
  it('verifies the exact completed command before acquisition and keeps uncertain or foreign intent fenced', async () => {
    const timing = { dir: '/tmp/fence', leaseSec: 2, renewEveryMs: 500 };
    const original = new NodeLease('target', async () => '', 'stage', timing);
    const guard = original.guard('install known candidate', 5000, 'd'.repeat(64));
    const proof = JSON.parse(guard.match(/\{"schema":2,[^}]+\}/)![0]);
    const answer = (intent: object) => 'LAPSED 5\t' + JSON.stringify(original.record) + '\nKERNEL-COMPLETED\t' + JSON.stringify(intent);
    const run = vi.fn<(s: string) => Promise<string>>().mockResolvedValueOnce(answer(proof)).mockResolvedValueOnce('ACQUIRED');
    const verify = vi.fn(async () => {});
    const contender = new NodeLease('target', run, 'stage', timing);
    expect((await contender.acquire(verify)).kind).toBe('acquired');
    expect(verify).toHaveBeenCalledExactlyOnceWith(proof.scope);
    expect(run.mock.calls[1]![0]).toContain(JSON.stringify(proof));
    run.mockReset().mockResolvedValue(answer(proof));
    await expect(contender.acquire(async () => { throw Error('selection changed'); })).rejects.toThrow('selection changed');
    expect(run).toHaveBeenCalledTimes(1);
    for (const other of [{ ...proof, schema: 1 }, { ...proof, token: 'different' }, { ...proof, kind: 'activate' }]) {
      run.mockReset().mockResolvedValue(answer(other));
      await expect(contender.acquire(verify)).rejects.toThrow('missing command identity');
      expect(run).toHaveBeenCalledTimes(1);
    }
    run.mockReset().mockResolvedValue('EXECUTION-BUSY\n' + answer(proof));
    await expect(contender.acquire(verify)).rejects.toThrow('still executing');
    run.mockReset().mockResolvedValue('KERNEL-COMPLETED\t{');
    await expect(contender.acquire(verify)).rejects.toThrow('identity is unreadable');
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it.skipIf(process.platform !== 'linux' && !process.env['OMNITRON_LEASE_DOCKER_TEST_IMAGE'])('proves real Linux exclusion, stale writer refusal, timeout and SIGKILL behavior', () => {
    const fixture = fileURLToPath(new URL('../fixtures/node-deploy-execution-fence.mjs', import.meta.url));
    const native = process.platform === 'linux';
    const root = native ? mkdtempSync(path.join(tmpdir(), 'omnitron-lease-')) : '/tmp/fences';
    const command = native ? process.execPath : 'docker';
    const args = native ? [fixture] : ['run', '--rm', '--pull', 'never', '-i', '--network', 'none', '--tmpfs', '/tmp:size=16m',
      '-v', `${fixture}:/test.mjs:ro`, process.env['OMNITRON_LEASE_DOCKER_TEST_IMAGE']!, 'node', '/test.mjs'];
    let output: string;
    try {
      output = execFileSync(command, args, { input: JSON.stringify(executionFenceScenarios(root, protocol)), encoding: 'utf8', timeout: 90_000 });
    } finally { if (native) rmSync(root, { recursive: true, force: true }); }
    expect(output).toContain('baseline: stale in-flight writer overwrote new writer');
    expect(output).toContain('fenced: execution excludes replacement/release');
    expect(output).toContain('SIGKILL of kernel lock holder cannot admit takeover');
    expect(output).toContain('SIGKILL of worker retains unresolved intent');
    expect(output).toContain('SIGKILL of timeout retains intent while orphaned command continues');
    expect(output).toContain('background process does not retain kernel execution lock');
    expect(output).toContain('completed receiver recovered without a second installation');
  }, 95_000);
});
