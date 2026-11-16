import { describe, expect, it } from 'vitest';
import { recoveryReview } from '../../src/services/pipeline-recovery.js';
import { observePipelineDeployment } from '../../src/services/pipeline-deployment.js';
import { validatePipeline } from '../../src/services/pipeline-definition.js';
import type { PipelineDeploymentEvidence } from '../../src/shared/dto/pipelines.js';
import type { IStackInfo } from '../../src/shared/dto/project.js';

const evidence: PipelineDeploymentEvidence = { state: 'unconfirmed', scope: { project: 'alpha', stack: 'test', registeredAt: '2026-01-01T00:00:00Z' },
  target: { project: 'alpha', stack: 'test', releaseId: 'release-a', manifestSha256: 'a'.repeat(64), review: 'b'.repeat(64) },
  expected: ['node-a', 'node-b'].map(node => ({ node, app: 'api', releaseId: 'release-a', manifestSha256: 'a'.repeat(64), artifactSha256: 'c'.repeat(64) })) };
function observed(): IStackInfo {
  return { placements: evidence.expected.map(item => ({ nodeKey: item.node, appsObserved: true,
    apps: [{ name: item.app, expected: true, process: { status: 'online', release: { ...item, state: 'confirmed', basis: 'verified-launch', launchId: 'launch-' + item.node, treeSha256: 'd'.repeat(64) } } }] })) } as unknown as IStackInfo;
}
describe('pipeline recovery boundary', () => {
  it('retains completed work and refuses to replay an uncertain shell or release', () => {
    const review = recoveryReview({ id: 'id', status: 'interrupted', steps: [
      { name: 'completed', status: 'success', duration: 1 },
      { name: 'waiting', status: 'interrupted', duration: 0 },
      { name: 'unknown', status: 'interrupted', duration: 0, attempts: 1 },
      { name: 'conditional', status: 'skipped', duration: 0, exitCode: 0 },
    ] });
    expect(review.completed).toEqual(['completed', 'conditional']);
    expect(review.pending).toEqual(['waiting']);
    expect(review.blocked).toEqual(['unknown']);
  });
  it('requires a fresh launch receipt from every expected replica', () => {
    const info = observed();
    expect(observePipelineDeployment(evidence, info).confirmed).toBe(true);
    info.placements![1]!.appsObserved = false;
    expect(observePipelineDeployment(evidence, info).confirmed).toBe(false);
  });
  it('rejects changed identity, missing replicas and declarations that silently remove a target', () => {
    for (const change of [
      (info: IStackInfo) => { info.placements!.pop(); },
      (info: IStackInfo) => { info.placements![0]!.apps[0]!.expected = false; },
      (info: IStackInfo) => { info.placements![0]!.apps[0]!.process!.release = { state: 'unreported', reason: 'Legacy owner' }; },
      (info: IStackInfo) => { info.placements![0]!.apps[0]!.process!.release = { ...observed().placements![0]!.apps[0]!.process!.release!, artifactSha256: 'f'.repeat(64) } as never; },
    ]) { const info = observed(); change(info); expect(observePipelineDeployment(evidence, info).confirmed).toBe(false); }
  });
  it('rejects overriding the native deployment executor or its retry policy', () => {
    const step = { name: 'deploy', kind: 'deploy' as const, target: evidence.target };
    expect(() => validatePipeline({ name: 'delivery', steps: [step] })).not.toThrow();
    for (const override of [{ retries: 1 }, { run: 'echo bypass' }, { timeout: 1 }, { nodeId: 'other' }])
      expect(() => validatePipeline({ name: 'delivery', steps: [{ ...step, ...override } as never] })).toThrow();
  });
});
