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
});
