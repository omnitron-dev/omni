import { expect, it } from 'vitest';
import { readReleaseDeploymentState, readSourcePublication, stackDeploymentHistory, readStackRelease } from '../../src/shared/release-reading.js';
import type { IStackInfo } from '../../src/shared/dto/project.js';
import type { ReleaseDeploymentDto } from '../../src/shared/dto/services.js';

const deployment: ReleaseDeploymentDto = { project: 'sample', stack: 'test', at: '2026-09-30T00:00:00Z',
  release: 'sample-old', releaseUnnamed: false, source: 'operator', actorId: null, projectCommit: null, omniCommit: null };
const stack = (name: string, status: 'running' | 'stopped', runtimeScope?: IStackInfo['runtimeScope']): IStackInfo => ({
  name, type: name === 'dev' ? 'local' : 'remote', status, runtimeScope,
  apps: [{ name: 'main', status: status === 'running' ? 'online' : 'stopped' }],
  nodes: name === 'dev' ? [] : [{ host: 'node.example', port: 9700, label: 'Test node', connected: true }],
} as IStackInfo);

it('keeps stopped local execution and running remote execution separate from recorded releases', async () => {
  const report = await readReleaseDeploymentState('sample', {
    stacks: async () => [stack('dev', 'stopped'), stack('test', 'running')],
    deployments: async () => ({ known: true, deployments: [deployment] }),
  });
  expect(report.stacks[0]).toMatchObject({ status: 'stopped', apps: { online: 0, total: 1 }, runningRelease: 'not-running', history: { known: true, last: null } });
  expect(report.stacks[1]).toMatchObject({ status: 'running', apps: { online: 1, total: 1 }, runningRelease: 'unreported', history: { known: true, last: deployment } });
  expect(report.stacks[1]).not.toHaveProperty('release', 'sample-old');
});

it('resolves imported configuration history through the retained runtime scope', () => {
  const info = stack('production', 'running', { project: 'sample-legacy', stack: 'default' });
  const old = { ...deployment, project: 'sample-legacy', stack: 'default' };
  const newer = { ...deployment, stack: 'production', at: '2026-10-01T00:00:00Z', release: 'sample-new' };
  expect(stackDeploymentHistory('sample', info, { known: true, deployments: [old, newer] })).toEqual({ known: true, last: newer });
  expect(stackDeploymentHistory('another', stack('production', 'running'), { known: true, deployments: [old, newer] })).toEqual({ known: true, last: null });
  expect(stackDeploymentHistory('sample', info, { known: true, deployments: [old, { ...newer, at: old.at }] })).toMatchObject({ known: false });
});

it('preserves inventory when history fails, and never treats a failed inventory read as no configured stacks', async () => {
  const missingHistory = await readReleaseDeploymentState('sample', { stacks: async () => [stack('test', 'running')], deployments: async () => { throw new Error('offline'); } });
  expect(missingHistory.inventory.known).toBe(true);
  expect(missingHistory.stacks[0]!.history.known).toBe(false);
  const missingInventory = await readReleaseDeploymentState('sample', { stacks: async () => { throw new Error('offline'); }, deployments: async () => ({ known: true, deployments: [deployment] }) });
  expect(missingInventory.inventory.known).toBe(false);
  expect(missingInventory.history.known).toBe(true);
});

it('describes Git publication as build-time evidence, never a localhost deployment', () => {
  const reading = readSourcePublication({ project: false, omni: true }, 'sample');
  expect(reading.label).toBe('Git: no remote branch');
  expect(reading.detail).toContain('At build time');
  expect(readSourcePublication({ project: null, omni: true }, 'sample').state).toBe('unknown');
});

it('scopes history to logical and retained namespaces and preserves unknown process state', async () => {
  const uncertain = stack('dev', 'stopped');
  uncertain.apps[0]!.status = 'unknown';
  const report = await readReleaseDeploymentState('sample', {
    stacks: async () => [uncertain, stack('prod', 'running', { project: 'sample-legacy', stack: 'default' })],
    deployments: async () => ({ known: true, deployments: [deployment,
      { ...deployment, project: 'unrelated' }, { ...deployment, project: 'sample-legacy', stack: 'default' }] }),
  });
  expect(report.history.known && report.history.deployments.map(row => row.project)).toEqual(['sample', 'sample-legacy']);
  expect(report.stacks[0]).toMatchObject({ runningRelease: 'unreported', apps: { unknown: 1 } });
});

const receipt = (releaseId = 'sample-current') => ({ state: 'confirmed' as const, releaseId,
  manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64), observedAt: '2026-11-02T00:00:00Z',
  launchId: 'launch-1', basis: 'verified-launch' as const });
const placement = (nodeKey: string, evidence: unknown = receipt()) => ({
  nodeKey, appsObserved: true,
  apps: [{ name: 'main', expected: true, process: { name: 'sample/deployed/main', status: 'online', pid: 123, release: evidence } }],
});

it('reads verified current launch provenance independently from an older deployment audit', async () => {
  const current = stack('test', 'running');
  current.placements = [placement('node-a:9700')] as IStackInfo['placements'];
  const report = await readReleaseDeploymentState('sample', { stacks: async () => [current], deployments: async () => ({ known: true, deployments: [deployment] }) });
  expect(report.stacks[0]).toMatchObject({ runningRelease: 'confirmed', releaseEvidence: { verified: 1, total: 1,
    releases: [{ releaseId: 'sample-current', manifestSha256: 'a'.repeat(64) }] }, history: { known: true, last: deployment } });
});

it('retains mixed release replicas instead of trusting one aggregate application row', () => {
  const current = stack('test', 'running');
  current.placements = [placement('node-a:9700'), placement('node-b:9700', receipt('sample-next'))] as IStackInfo['placements'];
  expect(readStackRelease(current)).toMatchObject({ runningRelease: 'mixed', releaseEvidence: { verified: 2, total: 2 } });
});

it('does not let a known replica cover an unavailable node or missing launch receipt', () => {
  const current = stack('test', 'running');
  current.placements = [placement('node-a:9700'), { nodeKey: 'node-b:9700', appsObserved: false,
    apps: [{ name: 'main', expected: true, process: null }] }] as IStackInfo['placements'];
  expect(readStackRelease(current)).toMatchObject({ runningRelease: 'unreported', releaseEvidence: { verified: 1, total: 2,
    observations: [{ state: 'confirmed' }, { state: 'unavailable', node: 'node-b:9700' }] } });
  current.placements = [placement('node-a:9700'), placement('node-b:9700', undefined)] as IStackInfo['placements'];
  current.placements![1]!.apps[0]!.process!.release = undefined;
  expect(readStackRelease(current).runningRelease).toBe('unreported');
});

it('rejects conflicting manifests under one release name and preserves modified evidence', () => {
  const current = stack('test', 'running');
  current.placements = [placement('node-a:9700'), placement('node-b:9700', { ...receipt(), manifestSha256: 'c'.repeat(64) })] as IStackInfo['placements'];
  expect(readStackRelease(current).runningRelease).toBe('modified');
  current.placements = [placement('node-a:9700', { state: 'modified', releaseId: 'sample-current', reason: 'Artifact digest changed' })] as IStackInfo['placements'];
  expect(readStackRelease(current)).toMatchObject({ runningRelease: 'modified', releaseEvidence: {
    observations: [{ reason: 'Artifact digest changed', state: 'modified' }] } });
});

it('requires a live PID and complete launch proof, without calling a stopped receipt current', () => {
  const current = stack('dev', 'running');
  current.apps[0] = { ...current.apps[0]!, pid: 123, release: receipt() };
  expect(readStackRelease(current).runningRelease).toBe('confirmed');
  current.apps[0].pid = null;
  expect(readStackRelease(current).runningRelease).toBe('unreported');
  current.apps[0].pid = 123;
  current.apps[0].release = { ...receipt(), observedAt: 'invalid' };
  expect(readStackRelease(current).runningRelease).toBe('unreported');
  current.status = 'stopped'; current.apps[0].status = 'stopped';
  expect(readStackRelease(current)).toMatchObject({ runningRelease: 'not-running', releaseEvidence: { total: 0, releases: [] } });
});
