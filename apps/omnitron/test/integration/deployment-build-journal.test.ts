import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { ExecutionService, SSHTarget } from '../../src/execution/execution.service.js';
import { PipelineService } from '../../src/services/pipeline.service.js';
import { deploymentBuildDefinition } from '../../src/services/deployment-build-pipeline.js';
import { createPipelineTestDatabase } from '../fixtures/pipeline-database.js';

it('reads the durable build by workspace before it runs and joins only its own issuer receipt', async () => {
  const db = createPipelineTestDatabase();
  const source = { project: 'sample', stack: 'remote', projectCommit: 'a'.repeat(40), omniCommit: 'b'.repeat(40), nodeId: 'issuer' };
  const releaseId = 'sample-202611010101-aaaaaaaa-bbbbbbbb', manifestSha256 = 'c'.repeat(64);
  const output = { protocol: 1, ...source, releaseId, manifestSha256 };
  const execute = vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: output }), stderr: 'verified build phase\n', duration: 1 }));
  const executor = { execute } as unknown as ExecutionService;
  const nodes = { getNode: () => ({ id: 'issuer', host: 'issuer.invalid', sshUser: 'builder', sshPort: 22, isLocal: false, createdAt: '2026-01-01' }) as never,
    nodeToSshTarget: async (): Promise<SSHTarget> => ({ host: 'issuer.invalid', username: 'builder', port: 22, expectedHostFingerprint: pin }) };
  let pin = 'SHA256:' + 'A'.repeat(43);
  function open() {
    const service = new PipelineService(db, createNullLogger(), executor);
    service.configure(nodes, undefined, { assertLifecycle() {}, projects: { projectConfigurations: () => [],
      resolvePipelineRelease: async () => { throw Error('No application execution'); } } });
    return service;
  }
  const service = open();
  const def = deploymentBuildDefinition(source);
  try {
    const graph = await service.createPipeline(def);
    const prepare = () => service.prepareRun({ id: graph.id, expectedRevision: graph.revision, runId: randomUUID() }, 'admin');
    const prepared = await prepare();
    expect((await service.listWorkspace({ project: source.project, stack: source.stack, activityOnly: true })).runs)
      .toMatchObject([{ id: prepared.id, status: 'awaiting-review', activity: { kind: 'build', ...source } }]);
    expect((await service.listWorkspace({ project: 'other', stack: source.stack, activityOnly: true })).runs).toHaveLength(0);
    expect((await service.listWorkspace({ project: source.project, stack: 'other', activityOnly: true })).runs).toHaveLength(0);
    await service.startRun({ runId: prepared.id, expectedDigest: prepared.review!.digest }, 'admin');
    await vi.waitFor(async () => expect((await service.getRunStatus(prepared.id))?.status).toBe('success'));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ command: 'omnitron', shell: false, adapter: 'ssh' }));
    const observer = open();
    expect(await observer.getRunStatus(prepared.id)).toMatchObject({ steps: [{ status: 'success', stderr: 'verified build phase\n',
      releaseBuild: { releaseId, manifestSha256 } }] });
    expect((await observer.listWorkspace({ project: source.project, stack: source.stack, activityOnly: true })).runs)
      .toMatchObject([{ id: prepared.id, activity: { kind: 'build', releaseId, manifestSha256 } }]);
    await observer.dispose();
    const changedSource = await prepare();
    output.omniCommit = 'd'.repeat(40);
    await service.startRun({ runId: changedSource.id, expectedDigest: changedSource.review!.digest }, 'admin');
    await vi.waitFor(async () => expect((await service.getRunStatus(changedSource.id))?.status).toBe('failed'));
    expect((await service.getRunStatus(changedSource.id))?.activity).not.toHaveProperty('releaseId');
    const changedIssuer = await prepare();
    pin = 'SHA256:' + 'B'.repeat(43);
    await expect(service.startRun({ runId: changedIssuer.id, expectedDigest: changedIssuer.review!.digest }, 'admin')).rejects.toThrow('issuer changed');
    expect(execute).toHaveBeenCalledTimes(2);
    const arbitrary = await service.createPipeline({ ...def, name: 'other-command', steps: [{ name: 'build-release', kind: 'shell', run: 'echo done' }] });
    const unrelated = await service.prepareRun({ id: arbitrary.id, expectedRevision: arbitrary.revision, runId: randomUUID() }, 'admin');
    expect(unrelated.activity).toBeUndefined();
  } finally { await service.dispose(); await db.destroy(); }
});
