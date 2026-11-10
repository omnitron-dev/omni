import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { ReleaseManifest } from '../../src/release/manifest.js';

const runner = vi.hoisted(() => vi.fn());
const messages = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../src/release/build-run.js', () => ({ runReleaseBuild: runner }));
vi.mock('@xec-sh/kit', () => ({ log: messages, table: vi.fn() }));
const { releaseBuildCommand } = await import('../../src/commands/release.js');
const { ReleaseService } = await import('../../src/services/release.service.js');

function outcome(gates: ReleaseManifest['gates'], artifactFailures?: ReleaseManifest['artifactFailures']) {
  return {
    id: 'sample-202611041900-aaaaaaaa-bbbbbbbb', durationMs: 100,
    manifestPath: '/isolated/release/manifest.json',
    manifest: {
      gates, artifacts: [{ app: 'api', version: '1.0.0', sha256: 'a'.repeat(64), bytes: 100 }],
      project: { onRemote: true }, omni: { onRemote: true }, artifactFailures,
    },
  };
}

beforeEach(() => { vi.clearAllMocks(); process.exitCode = 0; });
afterEach(() => { process.exitCode = 0; });

describe('release build completion agrees in CLI and Console', () => {
  it.each([
    { name: 'passed checks', gates: [{ name: 'test', status: 'passed' as const }], code: 0, state: 'done', reason: null },
    { name: 'failed checks', gates: [{ name: 'test', status: 'failed' as const }], code: 1, state: 'failed', reason: 'test' },
    { name: 'skipped checks', gates: [{ name: 'test', status: 'not-run' as const }], code: 2, state: 'failed', reason: 'test' },
    { name: 'timed out checks', gates: [{ name: 'test', status: 'timed-out' as const }], code: 2, state: 'failed', reason: 'timed-out' },
    { name: 'killed checks', gates: [{ name: 'test', status: 'killed' as const }], code: 2, state: 'failed', reason: 'killed' },
    { name: 'no recorded checks', gates: [], code: 2, state: 'failed', reason: 'No release checks' },
    { name: 'missing artifact', gates: [{ name: 'test', status: 'passed' as const }],
      failures: [{ app: 'worker', error: 'compiler failed' }], code: 1, state: 'failed', reason: 'worker' },
  ])('$name', async ({ gates, failures, code, state, reason }) => {
    const result = outcome(gates, failures);
    runner.mockResolvedValue(result);
    await releaseBuildCommand('sample');
    expect(process.exitCode).toBe(code);
    expect(messages.success).toHaveBeenCalledTimes(code === 0 ? 1 : 0);
    expect(messages.info).toHaveBeenCalledWith(expect.stringContaining(result.manifestPath));

    const logger = { info: vi.fn(), error: vi.fn() } as unknown as ILogger;
    const service = new ReleaseService(logger);
    const record = service.start({ project: 'sample' }, 'operator');
    await vi.waitFor(() => expect(record.state).toBe(state));
    expect(record.releaseId).toBe(result.id);
    expect(record.gates).toEqual(gates);
    expect(record.percent).toBe(100);
    expect(record.finishedAt).not.toBeNull();
    if (reason) expect(record.error).toContain(reason);
    else expect(record.error).toBeNull();
  });
});

it('runs independent projects concurrently and isolates queued cancellation and failures', async () => {
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as ILogger;
  const service = new ReleaseService(logger, 2);
  const finish = new Map<string, (value: ReturnType<typeof outcome>) => void>();
  runner.mockImplementation((name: string) => new Promise(resolve => finish.set(name, resolve)));
  const alpha = service.start({ project: 'alpha' }, 'first');
  const beta = service.start({ project: 'beta' }, 'second');
  const cancelled = service.start({ project: 'gamma' }, 'third');
  const next = service.start({ project: 'delta' }, 'fourth');
  expect([...finish.keys()]).toEqual(['alpha', 'beta']);
  expect(cancelled.state).toBe('queued');
  expect(next.state).toBe('queued');
  expect(() => service.start({ project: 'alpha' }, 'another')).toThrow(alpha.buildId);
  expect(() => service.start({ project: 'delta' }, 'another')).toThrow(next.buildId);
  expect(service.stop(cancelled.buildId).state).toBe('stopped');
  finish.get('beta')!(outcome([{ name: 'tests', status: 'failed' }]));
  await vi.waitFor(() => expect(next.state).toBe('running'));
  expect(alpha.state).toBe('running');
  expect(beta.state).toBe('failed');
  expect([...finish.keys()]).toEqual(['alpha', 'beta', 'delta']);
  finish.get('alpha')!(outcome([]));
  finish.get('delta')!(outcome([]));
  await vi.waitFor(() => expect(service.activeBuildCount).toBe(0));
});

it('recovers job history without replaying builds or persisting environment values', async () => {
  const rows = new Map<string, unknown>();
  const store = {
    kvKeys: async (prefix?: string) => [...rows.keys()].filter(key => key.startsWith(prefix ?? '')),
    kvGetSync: <T>(key: string) => structuredClone(rows.get(key)) as T | null,
    kvSetSync: <T>(key: string, value: T) => { rows.set(key, structuredClone(value)); },
    kvDeleteSync: (key: string) => { rows.delete(key); },
  };
  const logger = { info: vi.fn(), error: vi.fn() } as unknown as ILogger;
  const service = new ReleaseService(logger, 1, store);
  runner.mockImplementation(() => new Promise(() => {}));
  const first = service.start({ project: 'first', env: { TEST_KEY: 'private-test-value' } }, 'alice');
  const second = service.start({ project: 'second' }, 'bob');
  expect(service.stop(second.buildId).state).toBe('stopped');
  expect(JSON.stringify([...rows.values()])).not.toContain('private-test-value');
  const after = new ReleaseService(logger, 1, store);
  const calls = runner.mock.calls.length;
  await after.restore();
  expect(after.build(first.buildId)?.state).toBe('interrupted');
  expect(after.build(second.buildId)?.state).toBe('stopped');
  expect(after.activeBuildCount).toBe(0);
  expect(runner).toHaveBeenCalledTimes(calls);
});

it('records a verified store index only after a successful build and confirmed publication', async () => {
  const logger = { info: vi.fn(), error: vi.fn() } as unknown as ILogger;
  const done = Promise.withResolvers<{ location: string; indexSha256: string }>();
  const publisher = vi.fn(async () => done.promise);
  const service = new ReleaseService(logger, 1, undefined, publisher);
  const auth = vi.fn(async () => {});
  const checked = outcome([{ name: 'test', status: 'passed' }]);
  runner.mockResolvedValueOnce(checked);
  const record = service.start({ project: 'sample', publish: true }, 'operator', auth);
  await vi.waitFor(() => expect(publisher).toHaveBeenCalledOnce());
  expect(auth).toHaveBeenCalledOnce();
  expect(record.state).toBe('running');
  expect(record.publication).toBeUndefined();
  const receipt = { location: 's3://releases', indexSha256: 'e'.repeat(64) };
  done.resolve(receipt);
  await vi.waitFor(() => expect(record.state).toBe('done'));
  expect(record.publication).toEqual(receipt);
  runner.mockResolvedValueOnce(outcome([{ name: 'test', status: 'failed' }]));
  const failed = service.start({ project: 'sample', publish: true }, 'operator', auth);
  await vi.waitFor(() => expect(failed.state).toBe('failed'));
  expect(publisher).toHaveBeenCalledTimes(1);
  expect(() => service.start({ project: 'sample', skipGates: true, publish: true }, 'operator')).toThrow('full gate run');
});

it('revalidates a queued actor before executing project code and before publishing', async () => {
  const logger = { info: vi.fn(), error: vi.fn() } as unknown as ILogger;
  const publisher = vi.fn();
  const service = new ReleaseService(logger, 1, undefined, publisher);
  const first = Promise.withResolvers<ReturnType<typeof outcome>>();
  runner.mockReturnValueOnce(first.promise);
  const revoked = vi.fn(async () => { throw Error('Role revoked'); });
  const running = service.start({ project: 'first', publish: true }, 'operator', revoked);
  const waiting = service.start({ project: 'second', publish: true }, 'operator', revoked);
  first.resolve(outcome([{ name: 'test', status: 'passed' }]));
  await vi.waitFor(() => expect(service.activeBuildCount).toBe(0));
  expect([running.state, waiting.state]).toEqual(['failed', 'failed']);
  expect(waiting.error).toBe('Role revoked');
  expect(runner).toHaveBeenCalledTimes(1);
  expect(publisher).not.toHaveBeenCalled();
});
