import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { acquireScript, guardScript, parseAcquire, parseRelease, releaseScript, renewScript } from '../../src/services/node-deploy-lease.js';

const make = (name: string) => {
  const dir = `/tmp/fence-${name}`;
  const timing = { dir, leaseSec: 2, renewEveryMs: 500 };
  const record = (token: string) => ({ token, holder: token, stack: 'audit', startedAt: '2026-10-25T00:00:00Z' });
  return {
    dir, acquireA: acquireScript(timing, record('A')), acquireB: acquireScript(timing, record('B')),
    releaseA: releaseScript(timing, 'A'), renewA: renewScript(timing, 'A'),
    long: guardScript(timing, 'A', `touch '${dir}/started'; sleep 1; printf A > '${dir}/result'`, 5000),
    stale: guardScript(timing, 'A', `printf stale > '${dir}/result'`),
    current: guardScript(timing, 'B', `printf B > '${dir}/result'`),
    failure: guardScript(timing, 'A', 'exit 23'),
    timeout: guardScript(timing, 'A', `sleep 30; touch '${dir}/late'`, 1000),
    background: guardScript(timing, 'A', 'sleep 3 >/dev/null 2>&1 &'),
  };
};

describe('remote execution fencing', () => {
  it('treats active and unresolved execution as refusals, never a lease grant', () => {
    expect(() => parseAcquire('node', 'LAPSED 121\t{}\nEXECUTION-BUSY')).toThrow('still executing');
    expect(() => parseAcquire('node', 'EXECUTION-UNRESOLVED')).toThrow('inspected recovery');
    expect(parseRelease('node', 'EXECUTION-BUSY')).toEqual({ kind: 'busy' });
    expect(parseRelease('node', 'EXECUTION-UNRESOLVED')).toEqual({ kind: 'busy' });
  });
  it('refuses unbounded or malformed native deadlines', () => {
    const timing = { dir: '/tmp/fence', leaseSec: 2, renewEveryMs: 500 };
    for (const timeout of [0, -1, Infinity, 0.5, 86_400_001]) expect(() => guardScript(timing, 'A', 'true', timeout)).toThrow('timeout');
  });
  it.skipIf(!process.env.OMNITRON_LEASE_DOCKER_TEST_IMAGE)('proves real Linux exclusion, stale writer refusal, timeout and SIGKILL behavior', () => {
    const fixture = fileURLToPath(new URL('../fixtures/node-deploy-execution-fence.mjs', import.meta.url));
    const scenarios = Object.fromEntries(['raw', 'race', 'failure', 'killedLock', 'killedWorker', 'killedTimeout', 'background'].map(name => [name, make(name)]));
    const output = execFileSync('docker', ['run', '--rm', '-i', '--network', 'none', '-v', `${path.resolve(fixture)}:/test.mjs:ro`, process.env.OMNITRON_LEASE_DOCKER_TEST_IMAGE!, 'node', '/test.mjs'], { input: JSON.stringify(scenarios), encoding: 'utf8', timeout: 30_000 });
    expect(output).toContain('baseline: stale in-flight writer overwrote new writer');
    expect(output).toContain('fenced: execution excludes replacement/release');
    expect(output).toContain('SIGKILL of kernel lock holder cannot admit takeover');
    expect(output).toContain('SIGKILL of worker retains unresolved intent');
    expect(output).toContain('SIGKILL of timeout retains intent while orphaned command continues');
    expect(output).toContain('background process does not retain kernel execution lock');
  }, 35_000);
});
