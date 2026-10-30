import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ config: null as any, selection: null as any, activation: null as any, snapshot: null as any,
  control: vi.fn(), opened: vi.fn(), job: vi.fn() }));
vi.mock('../../src/daemon/managed-runtime.js', async original => ({
  ...await original<typeof import('../../src/daemon/managed-runtime.js')>(),
  readManagedRuntime: async () => fake.config, managedJobPid: fake.job,
}));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: { open: fake.opened } }));
vi.mock('../../src/daemon/execution-client.js', () => ({ ExecutionClient: class {
  async connect() { return fake.snapshot; } async close() {}
} }));
vi.mock('../../src/daemon/private-control-client.js', async original => ({
  ...await original<typeof import('../../src/daemon/private-control-client.js')>(), privateControlClient: fake.control,
}));
import { applySupervisorTransition } from '../../src/daemon/supervisor-transition.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';

const roots: string[] = [];
beforeEach(() => {
  vi.resetAllMocks(); fake.activation = null;
  fake.opened.mockResolvedValue({ exclusive: async (fn: () => unknown) => fn(), close: vi.fn(), artifact: vi.fn(),
    selection: () => fake.selection, activation: () => fake.activation });
});
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { force: true, recursive: true }); });
async function fixture(phase = 'prepared') {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-guardian-plan-')); roots.push(home);
  const id = randomUUID(), file = path.join(home, 'runtime', `supervisor-transition-${id}.json`);
  const before = { protocol: 1, instanceHome: home, scope: 'user', directory: path.join(home, 'e'), cwd: home,
    environment: { OMNITRON_HOME: home }, owner: { label: 'dev.omnitron.test.owner', unit: 'omnitron-test-owner.service', artifact: 'a'.repeat(64) },
    backend: { label: 'dev.omnitron.test.backend', unit: 'omnitron-test-backend.service', artifact: 'b'.repeat(64) } };
  const after = { ...before, backend: { ...before.backend, artifact: 'c'.repeat(64) } };
  const plan = { protocol: 1, id, phase, createdAt: new Date().toISOString(), before, after,
    unit: { file: path.join(home, 'backend.unit'), before: 'original unit', after: 'replacement unit' },
    backend: { runtime: 'b'.repeat(64), pid: 1001, control: path.join(home, 'e/c.sock'), socket: path.join(home, 'daemon.sock') },
    guardianPid: 1002, owner: { id: 'owner', pid: 1003, inventory: 'd'.repeat(64) } };
  fake.config = phase === 'started' ? after : before; fake.selection = { current: plan.backend.runtime };
  fake.snapshot = { status: { owner: { id: plan.owner.id, pid: plan.owner.pid } }, inventoryDigest: plan.owner.inventory };
  await fs.writeFile(plan.unit.file, phase === 'started' ? plan.unit.after : plan.unit.before, { mode: 0o600 });
  await writePrivateRecord(file, plan);
  return { file, plan };
}

it('refuses an edited native unit before preparing or retiring a backend', async () => {
  const { file, plan } = await fixture();
  await fs.writeFile(plan.unit.file, 'unrelated unit');
  await expect(applySupervisorTransition(file)).rejects.toThrow('unit changed');
  expect(fake.control).not.toHaveBeenCalled(); expect(fake.job).not.toHaveBeenCalled();
});
it('revalidates configuration and unit contents before resuming an interrupted bootstrap', async () => {
  const { file, plan } = await fixture('started');
  await fs.writeFile(plan.unit.file, 'edited while coordinator was offline');
  await expect(applySupervisorTransition(file)).rejects.toThrow('changed before resume');
  expect(fake.job).not.toHaveBeenCalled();
  await fs.writeFile(plan.unit.file, plan.unit.after); fake.config = plan.before;
  await expect(applySupervisorTransition(file)).rejects.toThrow('changed before resume');
  expect(fake.job).not.toHaveBeenCalled();
});
it('refuses a changed application inventory without changing OS jobs or backend admission', async () => {
  const { file } = await fixture('started'); fake.snapshot.inventoryDigest = 'e'.repeat(64);
  await expect(applySupervisorTransition(file)).rejects.toThrow('application inventory changed');
  expect(fake.control).not.toHaveBeenCalled(); expect(fake.job).not.toHaveBeenCalled();
});
it('cannot use a plan to change owner configuration or another instance', async () => {
  const { file, plan } = await fixture();
  plan.after.owner = { ...plan.after.owner, artifact: 'f'.repeat(64) };
  await writePrivateRecord(file, plan);
  await expect(applySupervisorTransition(file)).rejects.toThrow('Invalid supervisor transition');
  expect(fake.opened).not.toHaveBeenCalled();
});
it('rejects a startup selection changed after preparation', async () => {
  const { file } = await fixture(); fake.selection = { current: 'f'.repeat(64) };
  await expect(applySupervisorTransition(file)).rejects.toThrow('selection changed');
  expect(fake.control).not.toHaveBeenCalled(); expect(fake.job).not.toHaveBeenCalled();
});
