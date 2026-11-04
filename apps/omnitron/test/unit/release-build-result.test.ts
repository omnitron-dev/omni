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
