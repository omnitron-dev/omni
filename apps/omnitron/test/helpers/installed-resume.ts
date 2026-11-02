import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { LeaseStore } from '@omnitron-dev/titan-database/coordination';
import { ClusterRecipient } from '../../src/cluster/stop-authority.js';
import { InstalledStackResume } from '../../src/project/installed-stack-resume.js';
import type { NodeStackStopPlan, NodeStackStopReceipt } from '../../src/project/node-stack-stop.js';
import type { InstalledStackExecutionPlan } from '../../src/shared/dto/stack-execution.js';

export function installedAllocation(leases: Pick<LeaseStore, 'read'>, nodeId = 'edge') {
  const audience = { clusterId: 'west', nodeId };
  const runtime = { project: 'sample', stack: 'deployed' };
  const request = {
    project: 'sample',
    stack: 'prod',
    apps: ['api', 'jobs'],
    audience,
    operationId: randomUUID(),
    stopOperationId: randomUUID(),
    stopObservedAt: new Date().toISOString(),
  };
  const installed = {
    releaseId: 'v1',
    entrySha256: '1'.repeat(64),
    treeSha256: '4'.repeat(64),
    artifactSha256: '2'.repeat(64),
    manifestSha256: '3'.repeat(64),
  };
  const execution: InstalledStackExecutionPlan = {
    ...runtime,
    revision: 1,
    phase: 'stopped',
    apps: request.apps.map((app) => ({ name: 'sample/deployed/' + app, generation: randomUUID(), installed })),
  };
  const stopId = request.stopOperationId;
  const plan: NodeStackStopPlan = {
    ...request,
    applications: true,
    definition: 'binding',
    operationId: stopId,
    protocol: 1,
    execution: { ...structuredClone(execution), phase: 'running', revision: 0 },
    containers: [],
    expiresAt: Date.now(),
  };
  const receipt: NodeStackStopReceipt = {
    project: request.project,
    stack: request.stack,
    protocol: 1,
    operationId: stopId,
    outcome: 'stopped',
    observedAt: request.stopObservedAt,
    authority: { ...audience, epoch: '1' },
    removedContainers: [],
    applications: {
      ...runtime,
      revision: 1,
      operationId: stopId,
      stopped: execution.apps.map((app) => app.name),
      observedAt: request.stopObservedAt,
    },
  };
  const data = new Map<string, unknown>();
  const state = {
    kvGetSync: <T>(key: string) => structuredClone(data.get(key) ?? null) as T | null,
    kvUpdateSync: <T>(key: string, update: (previous: T | null) => T) => {
      const result = update(structuredClone(data.get(key) ?? null) as T | null);
      data.set(key, structuredClone(result));
      return result;
    },
  };
  const owner = {
    inspectInstalledStack: vi.fn(async () => structuredClone(execution)),
    openInstalledStack: vi.fn(async () => {}),
    resumeInstalledApp: vi.fn(async (_: { name: string }) => {}),
    getHandle: vi.fn(() => ({ status: 'online' }) as never),
  };
  const restartBackend = () =>
    new InstalledStackResume(
      new ClusterRecipient(audience, leases, state),
      { completedStop: () => ({ plan, receipt }) },
      state,
      owner,
      async () => ({ runtime, fingerprint: 'binding', order: ['api', 'jobs'] })
    );
  return { node: restartBackend(), restartBackend, request, owner, receipt, execution };
}
