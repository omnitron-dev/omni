import { expect, it } from 'vitest';
import type { BuildRecord, PipelineRunSummary } from '../../src/shared/dto/services.js';
import { deploymentActivityChoices } from '../../webapp/src/utils/deployment-activity.js';

it('joins matching manifest bytes, preserves issuer job IDs and leaves an earlier same-named build separate', () => {
  const nodeId = 'target', release = 'candidate', current = 'd'.repeat(64), earlier = 'e'.repeat(64);
  const at = '2026-01-01T03:00:00Z';
  const job: BuildRecord = { buildId: 'old-build', request: { project: 'sample', forStack: 'prod' }, releaseId: release,
    manifestSha256: earlier, history: [], startedAt: at, durationMs: 0, finishedAt: at, requestedBy: null, phase: 'done', percent: 100, state: 'done', error: null, gates: [] };
  const run: PipelineRunSummary = { id: 'producer', pipelineId: 'native', startedAt: at, completedAt: at, status: 'success', triggeredBy: 'operator',
    activity: { kind: 'build', project: 'sample', stack: 'prod', nodeId: 'issuer', projectCommit: 'a'.repeat(40), omniCommit: 'b'.repeat(40),
      releaseId: release, manifestSha256: current } };
  const rehearsal: PipelineRunSummary = { ...run, id: 'rehearsal', activity: { kind: 'rehearsal', project: 'sample', stack: 'prod', nodeId,
    releaseId: release, manifestSha256: current, recoveryReleaseId: 'return', recoveryManifestSha256: 'f'.repeat(64) } };
  const results = deploymentActivityChoices([job], [{ ...run, id: 'other-build' }, run, rehearsal], [{
    project: 'sample', stack: 'prod', attemptId: 'prepare', nodeId, state: 'refused', release, manifestSha256: current, startedAt: at,
  }], { phase: 'starting', release, rollbackRelease: 'return', nodeId, review: 'review', recoveryRunId: rehearsal.id }, 'run/producer');
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({ key: release + '/' + current, producer: { id: 'producer' }, rehearsal: { id: 'rehearsal' },
    preparation: { attemptId: 'prepare' }, operation: { review: 'review' } });
  expect(results[0]).not.toHaveProperty('build');
  expect(results[1]).toMatchObject({ build: job });
  expect(results[1]).not.toHaveProperty('operation');
  const unbound = deploymentActivityChoices([job], [run], [], { phase: 'stopping', review: 'separate', release, rollbackRelease: 'return', nodeId });
  expect(unbound).toHaveLength(3);
  expect(unbound[0]).not.toHaveProperty('producer');
});
