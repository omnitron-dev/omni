import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planWorkspaceMigrations } from '../../src/migration/workspace.js';
import { infraMigrateCommand } from '../../src/commands/infra.js';

const admitted = vi.hoisted(() => vi.fn());
const load = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
const migration = vi.hoisted(() => vi.fn());
const database = vi.hoisted(() => vi.fn());
vi.mock('../../src/cluster/standalone-infrastructure.js', () => ({ assertStandaloneInfrastructure: admitted }));
vi.mock('../../src/config/loader.js', () => ({ loadEcosystemConfig: load }));
vi.mock('node:child_process', async original => ({ ...(await original<typeof import('node:child_process')>()), spawnSync: execute }));
vi.mock('../../src/services/migration-process.js', () => ({ executeLocalMigration: migration }));
vi.mock('../../src/services/wait-for-postgres.js', () => ({ waitForPostgres: database }));

let root: string;
function pkg(name: string, script = true) {
  const cwd = path.join(root, name);
  mkdirSync(cwd);
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: '@example/' + name, scripts: script ? { migrate: 'node migration.js' } : {} }));
  writeFileSync(path.join(cwd, 'app.ts'), '');
  return { cwd, name: name + '-service', script: 'app.ts' };
}
beforeEach(() => { vi.resetAllMocks(); root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'omnitron-migration-plan-'))); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
describe('workspace migration admission', () => {
  it('prepares dependencies first using actual package directories and visits a shared package once', async () => {
    const db = pkg('db'), api = pkg('web'), worker = pkg('worker', false);
    const apps = [{ ...api, dependsOn: [db.name] }, db, worker, { ...db, name: 'second-db-process' }];
    await expect(planWorkspaceMigrations(root, apps)).resolves.toEqual([
      { app: db.name, directory: db.cwd }, { app: api.name, directory: api.cwd },
    ]);
    await expect(planWorkspaceMigrations(root, apps, worker.name)).rejects.toThrow('no migrate script');
    await expect(planWorkspaceMigrations(root, apps, '*')).rejects.toThrow('No unique');
  });
  it('refuses an entry escaping the workspace via symlink', async () => {
    const app = pkg('unit');
    symlinkSync(process.execPath, path.join(app.cwd, 'outside'));
    await expect(planWorkspaceMigrations(root, [{ ...app, script: 'outside' }])).rejects.toThrow('must belong to this workspace');
  });
  it('checks admission before importing ecosystem code, supports preview, and stops at the first failed script', async () => {
    const first = pkg('a'), next = { ...pkg('b'), dependsOn: [first.name] };
    load.mockResolvedValue({ apps: [next, first] });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    admitted.mockImplementationOnce(() => { throw new Error('Fenced'); });
    await expect(infraMigrateCommand()).rejects.toThrow('Fenced');
    expect(load).not.toHaveBeenCalled();
    await infraMigrateCommand(undefined, { dryRun: true });
    expect(execute).not.toHaveBeenCalled();
    execute.mockReturnValue({ status: 23 });
    await expect(infraMigrateCommand()).rejects.toThrow("Migration failed for 'a-service': exit 23");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith('pnpm', ['run', 'migrate'], expect.objectContaining({ cwd: first.cwd }));
  });
  it('preflights every declared config before connecting and never falls back to a package script', async () => {
    const owner = pkg('api');
    writeFileSync(path.join(owner.cwd, 'portal.mjs'), 'export default {};');
    writeFileSync(path.join(owner.cwd, 'market.mjs'), 'export default {};');
    load.mockResolvedValue({ apps: [{ ...owner, env: { DATABASE_URL: 'postgres://u:p@localhost/api' } }],
      infrastructure: { services: { pg: { preset: 'postgres', config: { databases: { api: { migrate:
        ['portal', 'market'].map(name => ({ app: owner.name, config: name + '.mjs', releaseConfig: 'dist/' + name + '.js' })),
      } } } } } } });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    migration.mockImplementation(async (_target, _env, options) => {
      if (options?.validate) throw Object.assign(Error('invalid config'), { stderr: 'missing connect()' });
      return { stdout: '', stderr: '' };
    });
    await infraMigrateCommand(undefined, { dryRun: true });
    expect(migration).not.toHaveBeenCalled();
    await expect(infraMigrateCommand()).rejects.toThrow('No migrations executed');
    expect(database).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    migration.mockResolvedValue({ stdout: '', stderr: '' });
    migration.mockClear();
    await infraMigrateCommand();
    expect(migration.mock.calls.map(call => Boolean(call[2]?.validate))).toEqual([true, true, false, false]);
    expect(database).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });
  it('rechecks the source boundary after readiness and before execution', async () => {
    const owner = pkg('api');
    const file = path.join(owner.cwd, 'portal.mjs');
    writeFileSync(file, 'export default {};');
    load.mockResolvedValue({ apps: [{ ...owner, env: { DATABASE_URL: 'postgres://u:p@localhost/api' } }],
      infrastructure: { services: { pg: { preset: 'postgres', config: { databases: { api: { migrate:
        { app: owner.name, config: 'portal.mjs', releaseConfig: 'dist/portal.js' },
      } } } } } } });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    migration.mockResolvedValue({ stdout: '', stderr: '' });
    database.mockImplementation(async () => { rmSync(file); symlinkSync(process.execPath, file); });
    await expect(infraMigrateCommand()).rejects.toThrow('within its package');
    expect(migration).toHaveBeenCalledOnce();
    expect(migration.mock.calls[0]?.[2]).toEqual({ validate: true });
  });
});
