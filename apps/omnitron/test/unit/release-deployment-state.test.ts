import { expect, it } from 'vitest';
import { readReleaseDeploymentState, readSourcePublication, stackDeploymentHistory } from '../../src/shared/release-reading.js';
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
