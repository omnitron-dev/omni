import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { infraMigrateCommand } from '../../src/commands/infra.js';
const fixture = vi.hoisted(() => ({ rpc: { listProjects: vi.fn(), reviewStackMigrations: vi.fn(), migrateStack: vi.fn(), getStackMigration: vi.fn() },
  local: vi.fn(), disconnect: vi.fn(), json: vi.fn(() => true) }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ LONG_REQUEST_TIMEOUT: 50000, createDaemonClient: () => ({ service: async () => fixture.rpc, disconnect: fixture.disconnect }) }));
vi.mock('../../src/config/loader.js', () => ({ loadEcosystemConfig: fixture.local }));
vi.mock('../../src/commands/output.js', () => ({ emitJson: fixture.json, isJsonMode: () => true }));
let directory: string;
beforeEach(async () => { vi.clearAllMocks(); directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'migration-cli-'))); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { force: true, recursive: true }); process.exitCode = 0; });
it('delegates registered review, execution and status without loading local application config', async () => {
  fixture.rpc.reviewStackMigrations.mockResolvedValue({ digest: 'a'.repeat(64), stopped: true });
  await infraMigrateCommand('api', { stack: 'example/dev', dryRun: true });
  expect(fixture.rpc.reviewStackMigrations).toHaveBeenCalledWith({ project: 'example', stack: 'dev', app: 'api' });
  const operationId = randomUUID(); fixture.rpc.migrateStack.mockResolvedValue({ id: operationId, state: 'unknown' });
  await infraMigrateCommand('api', { stack: 'example/dev', review: 'a'.repeat(64), requestId: operationId });
  expect(fixture.rpc.migrateStack).toHaveBeenCalledWith({ project: 'example', stack: 'dev', app: 'api', review: 'a'.repeat(64), operationId });
  expect(process.exitCode).toBe(1);
  fixture.rpc.getStackMigration.mockResolvedValue({ id: operationId, state: 'unknown' });
  await infraMigrateCommand(undefined, { stack: 'example/dev', status: operationId });
  expect(fixture.rpc.getStackMigration).toHaveBeenCalledWith({ project: 'example', stack: 'dev', operationId });
  expect(fixture.local).not.toHaveBeenCalled(); expect(fixture.disconnect).toHaveBeenCalledTimes(3);
});
it('resolves a bare stack through one registered checkout, including imported configuration names', async () => {
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  fixture.rpc.listProjects.mockResolvedValue([{ name: 'removed', path: path.join(directory, 'absent') },
    { name: 'example', configurations: [{ name: 'imported', path: directory, stacks: { dev: 'local-preview' } }] }]);
  await infraMigrateCommand(undefined, { stack: 'dev', dryRun: true });
  expect(fixture.rpc.reviewStackMigrations).toHaveBeenCalledWith({ project: 'example', stack: 'local-preview' });
  fixture.rpc.listProjects.mockResolvedValue([{ name: 'one', path: directory }, { name: 'two', path: directory }]);
  await expect(infraMigrateCommand(undefined, { stack: 'dev', dryRun: true })).rejects.toThrow('No unique'); expect(fixture.local).not.toHaveBeenCalled();
});
it('never falls back on RPC failure or without an explicit reviewed execution', async () => {
  await expect(infraMigrateCommand('api', { stack: 'example/dev' })).rejects.toThrow('--review');
  fixture.rpc.reviewStackMigrations.mockRejectedValue(Error('owner unavailable'));
  await expect(infraMigrateCommand('api', { stack: 'example/dev', dryRun: true })).rejects.toThrow('owner unavailable');
  expect(fixture.local).not.toHaveBeenCalled(); expect(fixture.rpc.migrateStack).not.toHaveBeenCalled();
});
