import { beforeEach, expect, it, vi } from 'vitest';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';

const f = vi.hoisted(() => ({
  probe: vi.fn(), inspect: vi.fn(), mismatch: vi.fn(), bridge: vi.fn(), attach: vi.fn(),
  restart: vi.fn(), health: vi.fn(), native: vi.fn(), query: vi.fn(), end: vi.fn(),
}));
vi.mock('../../src/database/connection.js', () => ({ createOmnitronPool: () => ({ query: f.query, end: f.end }) }));
vi.mock('../../src/infrastructure/existing-containers.js', () => ({
  existingContainerProbes: { inspect: f.inspect, image: vi.fn() }, existingContainerMismatch: f.mismatch, localBridgeId: f.bridge,
}));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(), getContainerState: f.probe,
  changeNetworkAttachment: f.attach, restartContainer: f.restart, waitForHealthy: f.health, execInContainer: f.native,
}));
import { inspectControlPlaneDatabase, moveControlPlaneDatabase } from '../../src/daemon/control-plane-database.js';

const id = 'a'.repeat(64), sourceId = 'b'.repeat(64), targetId = 'c'.repeat(64);
const from = 'project_default', to = 'omnitron_default';
const desired: ResolvedContainer = {
  name: 'fixture-pg', image: 'fixture:1', restart: 'no', network: to,
  environment: { POSTGRES_USER: 'fixture', POSTGRES_DB: 'fixture' },
  labels: { 'omnitron.managed': 'true', 'omnitron.service': 'omnitron-pg', 'omnitron.internal': 'true' },
  ports: [{ host: 6543, container: 5432 }], volumes: [],
};

beforeEach(() => vi.resetAllMocks());

it.each([false, true])('restores the original bridges and host SQL after failed activation (target already attached: %s)', async dual => {
  const networks: Record<string, { NetworkID: string }> = { [from]: { NetworkID: sourceId } };
  if (dual) networks[to] = { NetworkID: targetId };
  const before = structuredClone(networks);
  let startedAt = '2026-01-01T00:00:00.000Z', published = true, restarts = 0;
  f.probe.mockResolvedValue({ ...desired, containerId: id, status: 'running', health: 'healthy' });
  f.inspect.mockImplementation(async () => [{ Id: id, Name: '/' + desired.name, State: { Running: true, StartedAt: startedAt },
    HostConfig: { NetworkMode: from }, NetworkSettings: { Networks: structuredClone(networks) } }]);
  f.mismatch.mockImplementation((spec: ResolvedContainer, native: { NetworkSettings: { Networks: typeof networks } }) =>
    Object.keys(native.NetworkSettings.Networks).length === 1 && native.NetworkSettings.Networks[spec.network!] ? null : 'network attachment differs');
  f.bridge.mockImplementation(async (bridge: string) => bridge === to ? targetId : sourceId);
  f.native.mockResolvedValue('42');
  f.query.mockImplementation(async () => {
    if (!published) throw Object.assign(Error('Private endpoint offline'), { code: 'ECONNREFUSED' });
    return { rows: [{ id: '42' }] };
  });
  f.attach.mockImplementation(async (op: string, networkId: string) => {
    const name = networkId === targetId ? to : from;
    if (op === 'connect') networks[name] = { NetworkID: networkId };
    else delete networks[name];
  });
  f.restart.mockImplementation(async () => {
    startedAt = new Date(Date.parse(startedAt) + 1000).toISOString();
    // Model an endpoint that only rebinds on process restart and requires the original bridge.
    published = Boolean(networks[from]);
    restarts++;
  });
  f.health.mockResolvedValue(true);
  const plan = await inspectControlPlaneDatabase(desired);
  if (plan.action !== 'move-network') throw Error('Missing bridge plan');
  await expect(moveControlPlaneDatabase(desired, plan.move)).rejects.toThrow('Published control-plane PostgreSQL');
  expect(networks).toEqual(before);
  expect(published).toBe(true);
  expect(restarts).toBe(2);
  expect(f.restart.mock.calls).toEqual([[id], [id]]);
});
