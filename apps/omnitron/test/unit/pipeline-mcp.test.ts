import { expect, it, vi } from 'vitest';
import { createManagementTools } from '../../src/mcp/tool-groups/management.tools.js';

it('routes administrative agent requests through the same reviewed admission and preserves their IDs', async () => {
  const service = {
    prepareRun: vi.fn(async (request: { runId: string }) => ({ id: request.runId, review: { digest: 'b'.repeat(64) } })),
    startRun: vi.fn(async (request: { runId: string }) => ({ id: request.runId, status: 'success' })),
    executePipeline: vi.fn(),
    resumeRun: vi.fn(async () => ({ id: 'run', status: 'running' })),
    reconcileRun: vi.fn(async () => ({ id: 'run', status: 'failed' })),
  };
  const client = { service: vi.fn(async () => service) };
  const tools = createManagementTools(client as never);
  const request = { runId: 'ce9658f5-6225-48b5-a916-b7bb2a01ad70', id: 'pipeline', expectedRevision: 'a'.repeat(64), params: { revision: 'sealed' } };
  const run = tools.find(tool => tool.name === 'pipeline.run')!;
  expect(run.inputSchema['required']).toContain('runId');
  await expect(run.handler({ ...request, runId: '' })).rejects.toThrow('UUID');
  expect(service.prepareRun).not.toHaveBeenCalled();
  await run.handler(request);
  expect(service.prepareRun).toHaveBeenCalledExactlyOnceWith(request);
  expect(service.startRun).toHaveBeenCalledExactlyOnceWith({ runId: request.runId, expectedDigest: 'b'.repeat(64), params: request.params });
  await tools.find(tool => tool.name === 'pipeline.prepare')!.handler(request);
  expect(service.startRun).toHaveBeenCalledTimes(1);
  await tools.find(tool => tool.name === 'pipeline.start')!.handler({ runId: request.runId, expectedDigest: 'b'.repeat(64), params: request.params });
  expect(service.startRun).toHaveBeenCalledTimes(2);
  await tools.find(tool => tool.name === 'pipeline.reconcile')!.handler({ runId: request.runId });
  await tools.find(tool => tool.name === 'pipeline.resume')!.handler({ runId: request.runId, expectedDigest: 'c'.repeat(64), params: request.params });
  expect(service.reconcileRun).toHaveBeenCalledWith({ runId: request.runId });
  expect(service.resumeRun).toHaveBeenCalledWith({ runId: request.runId, expectedDigest: 'c'.repeat(64), params: request.params });
  expect(service.executePipeline).not.toHaveBeenCalled();
});
