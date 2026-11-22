import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const { service } = vi.hoisted(() => ({ service: { prepareRun: vi.fn(), resumeRun: vi.fn(), reconcileRun: vi.fn(), startRun: vi.fn(), executePipeline: vi.fn(), getRunStatus: vi.fn(), listPipelines: vi.fn(), getPipeline: vi.fn(), updatePipeline: vi.fn(), createPipeline: vi.fn() } }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), readFile: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/daemon/daemon-client.js')>(),
  createDaemonClient: () => ({ service: async () => service, disconnect: async () => {} }),
}));
import { pipelineCheckCommand, pipelineListCommand, pipelineStatusCommand, pipelineSaveCommand, pipelineRunCommand, pipelineStartCommand, pipelineReconcileCommand } from '../../src/commands/pipeline.js';
import { hasEmittedJson } from '../../src/commands/output.js';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ name: 'inspect', steps: [{ name: 'one', run: 'echo ready' }] }));
  process.exitCode = undefined;
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
  process.exitCode = undefined;
});

async function capture(run: () => Promise<void>) {
  const out: string[] = [],
    err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  await run();
  return { out: out.join(''), err: err.join(''), exitCode: process.exitCode };
}

describe('pipeline CLI uses the shared machine output protocol', () => {
  it('returns an offline graph receipt without source or a daemon operation', async () => {
    const output = await capture(() => pipelineCheckCommand('pipeline.json'));
    expect(output.err).toBe('');
    expect(JSON.parse(output.out)).toEqual({ ok: true, data: {
      scope: 'definition', sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      name: 'inspect', steps: [{ name: 'one', kind: 'shell', dependsOn: [] }],
    } });
    for (const call of Object.values(service)) expect(call).not.toHaveBeenCalled();
  });

  it('keeps file contents out of parse and validation errors', async () => {
    const privateValue = 'internal-test-value';
    for (const source of [`{"name": "${privateValue}" ${privateValue}}`, JSON.stringify({
      name: 'inspect', steps: [{ name: 'one', run: 'true', condition: `"${privateValue}"` }],
    })]) {
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from(source));
      const output = await capture(() => pipelineCheckCommand('pipeline.json'));
      expect(output.exitCode).toBe(1);
      expect(JSON.parse(output.err).ok).toBe(false);
      expect(output.err).not.toContain(privateValue);
    }
  });

  it('retains the exact request identity across CLI retries and never falls back to an older executor', async () => {
    const runId = 'ce9658f5-6225-48b5-a916-b7bb2a01ad70';
    service.listPipelines.mockResolvedValue([{ id: 'pipeline', name: 'inspect', revision: 'a'.repeat(64) }]);
    service.prepareRun.mockResolvedValue({ id: runId, review: { digest: 'b'.repeat(64) } });
    service.startRun.mockRejectedValueOnce(Error('Lost connection'));
    const lost = await capture(() => pipelineRunCommand('pipeline', { runId }));
    expect(JSON.parse(lost.err).error).toContain(runId);
    expect(service.startRun).toHaveBeenCalledWith({ runId, expectedDigest: 'b'.repeat(64), params: undefined });
    service.startRun.mockResolvedValue({ id: runId, status: 'success' });
    const recovered = await capture(() => pipelineStartCommand(runId, { expectedDigest: 'b'.repeat(64) }));
    expect(JSON.parse(recovered.out).data).toMatchObject({ id: runId, status: 'success' });
    service.prepareRun.mockRejectedValueOnce(Error('Method not available'));
    const old = await capture(() => pipelineRunCommand('pipeline', { runId }));
    expect(JSON.parse(old.err).error).toContain('Method not available');
    expect(service.executePipeline).not.toHaveBeenCalled();
  });
  it('submits the saved revision directly and leaves a stale revision for the controller to reject', async () => {
    const id = '990fed79-57f3-4af5-857c-340dd29c8937';
    const runId = 'ce9658f5-6225-48b5-a916-b7bb2a01ad70';
    const expectedRevision = 'a'.repeat(64);
    service.prepareRun.mockRejectedValue(Error('Pipeline changed after review'));
    const output = await capture(() => pipelineRunCommand(id, { runId, expectedRevision, prepare: true }));
    expect(JSON.parse(output.err).error).toContain('changed after review');
    expect(service.prepareRun).toHaveBeenCalledExactlyOnceWith({ id, runId, expectedRevision });
    expect(service.getPipeline).not.toHaveBeenCalled();
    expect(service.listPipelines).not.toHaveBeenCalled();
    expect(service.startRun).not.toHaveBeenCalled();
  });
  it.each([true, false])('recovers a lost preparation receipt with the same private parameters (prepare only = %s)', async prepare => {
    const id = '990fed79-57f3-4af5-857c-340dd29c8937';
    const expectedRevision = 'a'.repeat(64);
    const receipt = { id: 'ce9658f5-6225-48b5-a916-b7bb2a01ad70', status: 'awaiting-review', review: { digest: 'b'.repeat(64) } };
    const params = { branch: 'main' };
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(params));
    service.prepareRun.mockRejectedValueOnce(Object.assign(Error('Timed out'), { code: 408 })).mockResolvedValueOnce(receipt);
    service.startRun.mockResolvedValueOnce({ ...receipt, status: 'running' });
    const output = await capture(() => pipelineRunCommand(id, { runId: receipt.id, expectedRevision, paramsFile: 'params.json', prepare }));
    const request = { id, expectedRevision, runId: receipt.id, params };
    expect(service.prepareRun.mock.calls).toEqual([[request], [request]]);
    expect(service.startRun.mock.calls).toEqual(prepare ? [] : [[{ runId: receipt.id, expectedDigest: receipt.review.digest, params }]]);
    expect(JSON.parse(output.out).data.status).toBe(prepare ? 'awaiting-review' : 'running');
  });
  it('reports a second lost preparation under the original run ID', async () => {
    const id = '990fed79-57f3-4af5-857c-340dd29c8937';
    const runId = 'ce9658f5-6225-48b5-a916-b7bb2a01ad70';
    service.prepareRun.mockRejectedValue(Object.assign(Error('Socket closed'), { code: 'ECONNRESET' }));
    const output = await capture(() => pipelineRunCommand(id, { runId, expectedRevision: 'a'.repeat(64) }));
    expect(service.prepareRun).toHaveBeenCalledTimes(2);
    expect(service.startRun).not.toHaveBeenCalled();
    expect(output.exitCode).toBe(1);
    expect(JSON.parse(output.err).error).toContain(runId);
  });
  it.each([
    ['nightly', 'a'.repeat(64)],
    ['990fed79-57f3-4af5-857c-340dd29c8937', 'short'],
  ])('requires an exact identity and revision before preparing %s', async (id, expectedRevision) => {
    const output = await capture(() => pipelineRunCommand(id, { expectedRevision }));
    expect(JSON.parse(output.err).error).toContain('--expected-revision');
    expect(service.prepareRun).not.toHaveBeenCalled();
    expect(service.listPipelines).not.toHaveBeenCalled();
  });
  it('reads one definition for a UUID and still resolves a UUID-shaped name', async () => {
    const reference = '990fed79-57f3-4af5-857c-340dd29c8937';
    const namedId = 'abee554b-b149-4b05-aa4b-cf5e152bf324';
    const revision = 'a'.repeat(64);
    service.getPipeline.mockResolvedValueOnce({ id: reference, revision }).mockResolvedValueOnce(null);
    service.prepareRun.mockResolvedValue({ status: 'awaiting-review' });
    await capture(() => pipelineRunCommand(reference, { prepare: true }));
    expect(service.getPipeline).toHaveBeenCalledWith({ id: reference });
    expect(service.listPipelines).not.toHaveBeenCalled();
    expect(service.prepareRun).toHaveBeenLastCalledWith(expect.objectContaining({ id: reference, expectedRevision: revision }));
    service.listPipelines.mockResolvedValue([{ id: namedId, name: reference, revision }]);
    await capture(() => pipelineRunCommand(reference, { prepare: true }));
    expect(service.prepareRun).toHaveBeenLastCalledWith(expect.objectContaining({ id: namedId, expectedRevision: revision }));
  });
  it('passes the recovery digest and reads reconciliation without a second start', async () => {
    service.reconcileRun.mockResolvedValue({ id: 'run', status: 'failed', recovery: { digest: 'c'.repeat(64), blocked: [] } });
    service.resumeRun.mockResolvedValue({ id: 'run', status: 'running' });
    await capture(() => pipelineReconcileCommand('run'));
    await capture(() => pipelineStartCommand('run', { expectedDigest: 'c'.repeat(64) }, true));
    expect(service.reconcileRun).toHaveBeenCalledWith({ runId: 'run' });
    expect(service.resumeRun).toHaveBeenCalledWith({ runId: 'run', expectedDigest: 'c'.repeat(64), params: undefined });
    expect(service.startRun).not.toHaveBeenCalled();
  });
  it.each(['success', 'running', 'failed', 'cancelled', 'interrupted'])(
    'returns one record for a %s run',
    async (status) => {
      const run = { id: 'run-id', status, steps: [] };
      service.getRunStatus.mockResolvedValue(run);
      const output = await capture(() => pipelineStatusCommand(run.id));
      expect(JSON.parse(output.out)).toEqual({ ok: true, data: run });
      expect(output.err).toBe('');
      expect(hasEmittedJson()).toBe(true);
      expect(output.exitCode).toBe(['failed', 'cancelled', 'interrupted'].includes(status) ? 1 : undefined);
    }
  );
  it('reports missing runs as structured failures', async () => {
    service.getRunStatus.mockResolvedValue(null);
    const output = await capture(() => pipelineStatusCommand('missing'));
    expect(output.out).toBe('');
    expect(JSON.parse(output.err)).toMatchObject({ ok: false, error: expect.stringContaining('not found') });
    expect(output.exitCode).toBe(1);
  });
  it('preserves an empty list as data', async () => {
    service.listPipelines.mockResolvedValue([]);
    const output = await capture(pipelineListCommand);
    expect(JSON.parse(output.out)).toEqual({ ok: true, data: { pipelines: [] } });
    expect(output.err).toBe('');
  });
  it('requires a reviewed revision for updating and refuses an older daemon', async () => {
    const missing = await capture(() => pipelineSaveCommand('pipeline.json', { id: 'pipeline' }));
    expect(JSON.parse(missing.err).error).toContain('--expected-revision');
    expect(service.updatePipeline).not.toHaveBeenCalled();
    service.getPipeline.mockResolvedValue({ id: 'pipeline', revision: 'a'.repeat(64) });
    const old = await capture(() => pipelineSaveCommand('pipeline.json', { id: 'pipeline', expectedRevision: 'a'.repeat(64) }));
    expect(JSON.parse(old.err).error).toContain('Update the daemon');
    expect(service.updatePipeline).not.toHaveBeenCalled();
  });
  it('preserves the explicit revision even if another editor changed the current definition', async () => {
    service.getPipeline.mockResolvedValue({ id: 'pipeline', revision: 'b'.repeat(64), conditionalUpdates: true });
    service.updatePipeline.mockRejectedValue(Error('Pipeline changed after review'));
    const result = await capture(() => pipelineSaveCommand('pipeline.json', { id: 'pipeline', expectedRevision: 'a'.repeat(64) }));
    expect(service.updatePipeline).toHaveBeenCalledWith({
      id: 'pipeline', expectedRevision: 'a'.repeat(64), definition: { name: 'inspect', steps: [{ name: 'one', run: 'echo ready' }] },
    });
    expect(JSON.parse(result.err).error).toContain('changed after review');
    expect(result.exitCode).toBe(1);
  });
});
