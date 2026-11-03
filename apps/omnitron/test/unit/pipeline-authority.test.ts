import { describe, expect, it, vi } from 'vitest';
import { PipelineRpcService } from '../../src/services/pipeline.rpc-service.js';
import { runWithAuth } from '../../src/services/auth-context.js';

const actor = (role = 'admin') => ({
  userId: 'alice',
  roles: [role],
  permissions: [],
  metadata: { sessionId: 'session' },
});
function fixture() {
  const pipelines = {
    updatePipeline: vi.fn(async () => ({ id: 'pipeline' })),
    executePipeline: vi.fn(async () => ({ id: 'run' })),
    cancelRun: vi.fn(async () => {}),
    listRuns: vi.fn(async () => []),
  };
  const auth = { validateSession: vi.fn(async (): Promise<any> => ({ id: 'alice', role: 'admin' })) };
  const audit = { record: vi.fn(async () => {}) };
  return { pipelines, auth, audit, service: new PipelineRpcService(pipelines as never, auth as never, audit) };
}
const request = { id: 'pipeline', expectedRevision: 'a'.repeat(64) };
describe('automation authority at the execution boundary', () => {
  it.each(['viewer', 'operator'])('rejects %s even when called without transport middleware', async (role) => {
    const f = fixture();
    await expect(runWithAuth(actor(role), () => f.service.executePipeline(request))).rejects.toThrow();
    expect(f.pipelines.executePipeline).not.toHaveBeenCalled();
  });
  it.each([null, { id: 'alice', role: 'viewer' }, { id: 'other', role: 'admin' }])(
    'rejects revoked or changed session %j',
    async (user) => {
      const f = fixture();
      f.auth.validateSession.mockResolvedValue(user);
      await expect(runWithAuth(actor(), () => f.service.executePipeline(request))).rejects.toThrow();
      expect(f.pipelines.executePipeline).not.toHaveBeenCalled();
    }
  );
  it('requires an audit write before execution and uses server identity', async () => {
    const f = fixture();
    f.audit.record.mockRejectedValueOnce(Error('audit unavailable'));
    await expect(runWithAuth(actor(), () => f.service.executePipeline(request))).rejects.toThrow('audit unavailable');
    expect(f.pipelines.executePipeline).not.toHaveBeenCalled();
    await runWithAuth(actor(), () => f.service.executePipeline(request));
    expect(f.pipelines.executePipeline).toHaveBeenCalledWith('pipeline', undefined, 'alice', request.expectedRevision);
    expect(f.audit.record).toHaveBeenLastCalledWith(
      { action: 'pipeline.run.requested', resourceType: 'pipeline', resourceId: 'pipeline' },
      true
    );
  });
  it('rejects execution without a reviewed revision', async () => {
    const f = fixture();
    await expect(
      runWithAuth(actor(), () => f.service.executePipeline({ ...request, expectedRevision: '' }))
    ).rejects.toThrow('Review');
    expect(f.pipelines.executePipeline).not.toHaveBeenCalled();
  });
  it('requires a revision and an audit write before changing a definition', async () => {
    const f = fixture();
    const update = { ...request, definition: { name: 'inspect', steps: [{ name: 'one', run: 'echo ready' }] } };
    await expect(runWithAuth(actor(), () => f.service.updatePipeline({ ...update, expectedRevision: '' })))
      .rejects.toThrow('Review');
    expect(f.pipelines.updatePipeline).not.toHaveBeenCalled();
    f.audit.record.mockRejectedValueOnce(Error('audit unavailable'));
    await expect(runWithAuth(actor(), () => f.service.updatePipeline(update))).rejects.toThrow('audit unavailable');
    expect(f.pipelines.updatePipeline).not.toHaveBeenCalled();
    await runWithAuth(actor(), () => f.service.updatePipeline(update));
    expect(f.pipelines.updatePipeline).toHaveBeenCalledExactlyOnceWith(update.id, update.definition, update.expectedRevision);
  });
  it.each(['viewer', 'operator'])('denies definition updates by %s', async (role) => {
    const f = fixture();
    await expect(runWithAuth(actor(role), () => f.service.updatePipeline({
      ...request, definition: { name: 'inspect', steps: [{ name: 'one', run: 'echo ready' }] },
    }))).rejects.toThrow();
    expect(f.pipelines.updatePipeline).not.toHaveBeenCalled();
  });
  it('records a rejected stale edit as a request, never as an applied update', async () => {
    const f = fixture();
    f.pipelines.updatePipeline.mockRejectedValueOnce(Error('Pipeline changed after review'));
    await expect(runWithAuth(actor(), () => f.service.updatePipeline({
      ...request, definition: { name: 'inspect', steps: [{ name: 'one', run: 'echo ready' }] },
    }))).rejects.toThrow('changed after review');
    expect(f.audit.record).toHaveBeenCalledExactlyOnceWith(
      { action: 'pipeline.update.requested', resourceType: 'pipeline', resourceId: 'pipeline' }, true
    );
  });
});
