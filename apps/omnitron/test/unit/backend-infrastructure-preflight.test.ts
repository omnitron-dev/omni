import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { BackendHandoffState } from '../../src/daemon/backend-handoff-types.js';
import type { ContainerState, ResolvedContainer } from '../../src/infrastructure/types.js';

const runtime = vi.hoisted(() => ({ inspect: vi.fn(), create: vi.fn(), start: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(),
  getContainerState: runtime.inspect, createContainer: runtime.create, startContainer: runtime.start, removeContainer: runtime.remove,
}));
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { backendInfrastructureInput, readBackendInfrastructureInput, validateBackendInfrastructureInput } from '../../src/daemon/backend-infrastructure-preflight.js';

beforeEach(() => vi.clearAllMocks());

function fixture(name: string) {
  const desired: ResolvedContainer = { name, image: 'postgres:17', ports: [], volumes: [], environment: {},
    labels: { 'omnitron.managed': 'true', 'omnitron.project': 'tenant', 'omnitron.stack': 'prod', 'omnitron.service': name },
    restart: 'unless-stopped', shmSize: '256m', critical: false };
  const observed: ContainerState = { name, image: desired.image, status: 'running', containerId: '1'.repeat(64),
    labels: desired.labels, specHash: 'd94b439555467d30', resources: { memoryBytes: 0, memoryReservationBytes: 0,
      nanoCpus: 0, shmBytes: 268435456, cpuQuota: 0, cpuPeriod: 0 } };
  const service = new InfrastructureService(createNullLogger(), { services: {} }, {}, undefined, undefined, false);
  service.addAppContainers([desired]);
  const snapshot = service.captureRecoveryState();
  snapshot.state.services[name] = observed;
  service.dispose();
  return { snapshot, observed };
}

it('checks global and project infrastructure with the actual adoption validator and no mutations', async () => {
  const global = fixture('global-postgres'), project = fixture('project-postgres');
  const state: Omit<BackendHandoffState, 'ticket'> = { protocol: 1, watchConfig: { ...DEFAULT_ECOSYSTEM, apps: [] }, executionInventory: 'a'.repeat(64),
    infrastructure: global.snapshot, projects: { projects: [], stacks: [], infrastructure: [
      { key: 'tenant/prod', allocation: { servicePorts: {}, postgresPort: 5432, redisPort: 6379,
        minioPort: 9000, minioConsolePort: 9001, redisDbStart: 0, redisDbEnd: 4, containerPrefix: 'tenant-prod' }, infrastructure: project.snapshot },
    ], resumeBackoff: [], reconciling: false } };
  runtime.inspect.mockImplementation(async (name: string) => structuredClone(name === 'global-postgres' ? global.observed : project.observed));
  const input = backendInfrastructureInput(state), before = structuredClone(state);
  const checked = await validateBackendInfrastructureInput(Buffer.from(input));
  expect(checked).toEqual({ protocol: 1, digest: createHash('sha256').update(input).digest('hex') });
  expect(runtime.inspect.mock.calls).toEqual([
    ['global-postgres', { orThrow: true, fullId: true }], ['project-postgres', { orThrow: true, fullId: true }],
  ]);
  expect(state).toEqual(before);
  project.observed.resources!.shmBytes = 67108864;
  await expect(validateBackendInfrastructureInput(Buffer.from(input))).rejects.toThrow('Enforced container resource limits differ during handoff: project-postgres');
  expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.start).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
});

it('rejects malformed or oversized input before inspecting Docker', async () => {
  for (const input of ['null', '{}', '{"protocol":2,"infrastructure":[]}', '{"protocol":1,"infrastructure":[],"extra":true}', 'not-json']) {
    await expect(validateBackendInfrastructureInput(Buffer.from(input))).rejects.toThrow('Invalid backend infrastructure');
  }
  async function* excessive() { yield Buffer.alloc(16 * 1024 * 1024); yield Buffer.from('x'); }
  await expect(readBackendInfrastructureInput(excessive())).rejects.toThrow('16 MiB');
  expect(runtime.inspect).not.toHaveBeenCalled();
});
