import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const { service } = vi.hoisted(() => ({ service: { prepareRun: vi.fn(), resumeRun: vi.fn(), reconcileRun: vi.fn(), startRun: vi.fn(), executePipeline: vi.fn(), getRunStatus: vi.fn(), listPipelines: vi.fn(), getPipeline: vi.fn(), updatePipeline: vi.fn(), createPipeline: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ readFile: async () => JSON.stringify({ name: 'inspect', steps: [{ name: 'one', run: 'echo ready' }] }) }));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({ service: async () => service, disconnect: async () => {} }),
}));
import { pipelineListCommand, pipelineStatusCommand, pipelineSaveCommand, pipelineRunCommand, pipelineStartCommand, pipelineReconcileCommand } from '../../src/commands/pipeline.js';
import { hasEmittedJson } from '../../src/commands/output.js';

beforeEach(() => {
  vi.resetAllMocks();
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
