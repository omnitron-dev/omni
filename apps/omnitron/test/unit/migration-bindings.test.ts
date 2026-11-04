import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { normalizeInfraConfig } from '../../src/infrastructure/config-normalizer.js';
import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';
import { requestedMigrations, localMigrationTargets, migrationDatabaseEnvironment, validateMigrationDestinations, orderMigrationPlacements, requiredMigrationFiles } from '../../src/services/migration-target.js';
import { executeLocalMigration, prepareRemoteMigration } from '../../src/services/migration-process.js';
import { planDeclaredWorkspaceMigrations } from '../../src/migration/workspace.js';
import { execFileSync } from 'node:child_process';
import type { MigrationBinding } from '../../src/infrastructure/types.js';

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('../../src/services/wait-for-postgres.js', () => ({ waitForPostgres: probe }));
const roots: string[] = [];
afterEach(async () => { probe.mockClear(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const binding = (name = 'portal'): MigrationBinding => ({ app: 'owner-api', config: `src/database/${name}.ts`, releaseConfig: `dist/database/${name}.js` });
function services(migrate: unknown, database = 'api') {
  return normalizeInfraConfig({ services: { primary: { preset: 'postgres', config: { databases: { [database]: { migrate } } } } } }, createDefaultRegistry());
}
async function workspace() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'migration-binding-'))); roots.push(root);
  const cwd = path.join(root, 'apps/api');
  await fs.mkdir(path.join(cwd, 'src/database'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(cwd, 'src/database/portal.ts'), 'export default {};');
  return { root, cwd, entries: [{ name: 'owner-api', cwd: 'apps/api', bootstrap: 'src/bootstrap.ts', env: { DATABASE_URL: 'postgres://u:p@localhost/api' } }] };
}

describe('explicit migration ownership', () => {
  it('keeps database, service, alias and source cwd independent', async () => {
    const f = await workspace();
    const requests = requestedMigrations(services(binding()));
    expect(requests).toEqual([{ service: 'primary', database: 'api', app: 'owner-api', mode: 'config', source: binding().config, release: binding().releaseConfig }]);
    const [target] = await localMigrationTargets(requests, f.entries, f.root);
    expect(target).toMatchObject({ cwd: f.cwd, script: path.join(f.cwd, binding().config), sealed: false });
    expect(requiredMigrationFiles(requests)).toEqual({ 'owner-api': ['dist/database/portal.js'] });
    const absolute = await localMigrationTargets(requests, [{ ...f.entries[0]!, cwd: f.cwd }], f.root);
    expect(absolute[0]).toEqual(target);
  });
  it('retains separate ordered configs and refuses duplicate or conflicting owners', () => {
    expect(requestedMigrations(services([binding(), binding('market')])).map(item => item.source)).toEqual([binding().config, binding('market').config]);
    expect(() => requestedMigrations(services([binding(), binding()]))).toThrow('more than once');
    expect(() => requestedMigrations(services([binding(), { ...binding('market'), app: 'another' }]))).toThrow('one migration owner');
    expect(() => requestedMigrations(services([]))).toThrow('empty');
    expect(() => requestedMigrations(services('owner-api'))).toThrow('Invalid migration binding');
  });
  it('does not merge same-named databases on different services', () => {
    const first = services(binding());
    const second = services({ ...binding('second'), app: 'second-api' });
    const plan = requestedMigrations({ first: first['primary']!, second: second['primary']! });
    expect(plan.map(item => [item.service, item.database, item.app])).toEqual([['first', 'api', 'owner-api'], ['second', 'api', 'second-api']]);
  });
  it.each(['../outside.ts', '/absolute.ts', 'src/../outside.ts', 'C:/file.ts', 'src\\file.ts', 'src/registry.ts:stream'])('rejects escaping config member %s', config => {
    expect(() => requestedMigrations(services({ ...binding(), config }))).toThrow('package-relative');
  });
  it('refuses missing owner, missing config, and a source symlink escaping its cwd', async () => {
    const f = await workspace(), requests = requestedMigrations(services(binding()));
    await expect(localMigrationTargets(requests, [], f.root)).rejects.toThrow('no unique application');
    await fs.rm(path.join(f.cwd, binding().config));
    await expect(localMigrationTargets(requests, f.entries, f.root)).rejects.toThrow('unavailable');
    await fs.writeFile(path.join(f.root, 'outside.ts'), 'export default {};');
    await fs.symlink(path.join(f.root, 'outside.ts'), path.join(f.cwd, binding().config));
    await expect(localMigrationTargets(requests, f.entries, f.root)).rejects.toThrow('within its package');
  });
  it('preserves explicit legacy opt-in and never discovers undeclared programs', async () => {
    const f = await workspace();
    expect(requestedMigrations(services(false))).toEqual([]);
    expect(requestedMigrations(services(undefined))).toEqual([]);
    await fs.writeFile(path.join(f.cwd, 'src/database/migrate.ts'), '');
    const [target] = await localMigrationTargets(requestedMigrations(services(true)), [{ name: 'api', cwd: f.cwd }], f.root);
    expect(target).toMatchObject({ app: 'api', database: 'api', mode: 'script', script: path.join(f.cwd, 'src/database/migrate.ts') });
  });
  it('validates destination independently of alias and retains config transport options', () => {
    const url = 'postgres://u:p@localhost/api?sslmode=require&application_name=owner';
    expect(migrationDatabaseEnvironment('owner-api', url, 'api', 'config').env).toEqual({ DATABASE_URL: url });
    expect(() => migrationDatabaseEnvironment('owner-api', url, 'api')).toThrow('refuses DATABASE_URL options');
    expect(() => migrationDatabaseEnvironment('owner-api', url, 'owner-api', 'config')).toThrow('targeting owner-api');
    for (const key of ['host', 'port', 'database', 'dbname', 'user', 'password'])
      expect(() => migrationDatabaseEnvironment('owner-api', 'postgres://u:p@localhost/api?' + key + '=other', 'api', 'config')).toThrow('destination overrides');
    const database = migrationDatabaseEnvironment('owner-api', url, 'api', 'config');
    expect(() => validateMigrationDestinations([{ app: 'owner-api', database }, { app: 'other', database }])).toThrow('conflicting owners');
    expect(() => validateMigrationDestinations([{ app: 'owner-api', database }, { app: 'owner-api', database }])).not.toThrow();
  });
  it('orders one explicit owner before consumers and refuses replica ambiguity before any execution', () => {
    const requests = requestedMigrations(services(binding()));
    const consumer = { apps: [{ name: 'worker' }] }, owner = { apps: [{ name: 'owner-api' }] };
    expect(orderMigrationPlacements(requests, [consumer, owner])).toEqual([owner, consumer]);
    expect(() => orderMigrationPlacements(requests, [owner, owner])).toThrow('exactly one node');
    const other = requestedMigrations(services({ ...binding('second'), app: 'second-api' }, 'second'));
    expect(() => orderMigrationPlacements([...requests, ...other], [owner, { apps: [{ name: 'second-api' }] }])).toThrow('global migration barrier');
  });
  it('uses the same declaration for standalone CLI and preserves explicit false', async () => {
    const f = await workspace();
    const config = { apps: f.entries, infrastructure: { services: { primary: { preset: 'postgres', config: { databases: { api: { migrate: binding() } } } } } } };
    const plan = await planDeclaredWorkspaceMigrations(f.root, config as never);
    expect(plan?.[0]?.target).toMatchObject({ app: 'owner-api', database: 'api', cwd: f.cwd, mode: 'config' });
    config.infrastructure.services.primary.config.databases.api.migrate = false as never;
    await expect(planDeclaredWorkspaceMigrations(f.root, config as never)).resolves.toEqual([]);
  });
});

async function applicationDependencies(cwd: string) {
  const installed = path.resolve(import.meta.dirname, '../../node_modules');
  await fs.mkdir(path.join(cwd, 'node_modules/@omnitron-dev'), { recursive: true });
  for (const name of ['better-sqlite3', 'kysely', 'tsx', '@omnitron-dev/titan', '@omnitron-dev/titan-database'])
    await fs.symlink(path.join(installed, name), path.join(cwd, 'node_modules', name));
  const sdk = path.join(cwd, 'node_modules/@omnitron-dev/omnitron');
  await fs.mkdir(sdk);
  await fs.writeFile(path.join(sdk, 'package.json'), JSON.stringify({ name: '@omnitron-dev/omnitron', type: 'module', exports: { './migration': './migration.mjs' } }));
  const { build } = await import('esbuild');
  await build({ entryPoints: [path.resolve(import.meta.dirname, '../../src/migration/index.ts')],
    outfile: path.join(sdk, 'migration.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
}

async function nativeConfig(f: Awaited<ReturnType<typeof workspace>>, name: string, fail = false) {
  const file = path.join(f.cwd, `src/database/${name}.ts`);
  await fs.writeFile(file, `import {Kysely,SqliteDialect} from 'kysely';
import Database from 'better-sqlite3';
import {defineMigrationConfig,defineSqlMigration,createMigrationHistory} from '@omnitron-dev/omnitron/migration';
export default defineMigrationConfig({name:${JSON.stringify(name)},
  migrations:[defineSqlMigration('1',${JSON.stringify(fail ? 'invalid SQL' : `create table ${name}_value (id integer)`)})],
  options:{history:createMigrationHistory({tableName:${JSON.stringify(name + '_history')},checksumColumn:'checksum'})},
  async connect(){const db=new Kysely({dialect:new SqliteDialect({database:new Database(process.env.TEST_DATABASE!)})});
    return {db,close:()=>db.destroy()};}});`);
  return file;
}

it('executes the real public operation in a child with two independent persisted registries', async () => {
  const f = await workspace();
  await applicationDependencies(f.cwd);
  await nativeConfig(f, 'portal'); await nativeConfig(f, 'market');
  const targets = await localMigrationTargets(requestedMigrations(services([binding(), binding('market')])), f.entries, f.root);
  const database = path.join(f.root, 'state.sqlite');
  for (const target of targets) await executeLocalMigration(target, { TEST_DATABASE: database });
  const db = new Database(database);
  try {
    expect(db.prepare('select count(*) as n from portal_history').get()).toEqual({ n: 1 });
    expect(db.prepare('select count(*) as n from market_history').get()).toEqual({ n: 1 });
  } finally { db.close(); }
  await expect(executeLocalMigration(targets[0]!, { TEST_DATABASE: database })).resolves.toHaveProperty('stdout');
});

it('executes a compiled config through the same remote adapter without exposing credentials in argv', async () => {
  const f = await workspace();
  await applicationDependencies(f.cwd);
  const file = await nativeConfig(f, 'portal');
  const compiled = path.join(f.cwd, 'portal.mjs');
  await fs.writeFile(compiled, (await fs.readFile(file, 'utf8')).replace('process.env.TEST_DATABASE!', 'process.env.TEST_DATABASE'));
  const request = prepareRemoteMigration({ cwd: f.cwd, script: compiled, node: process.execPath, mode: 'config' }, { TEST_DATABASE: path.join(f.root, 'remote.sqlite'), DATABASE_URL: 'synthetic-secret' });
  expect(request.command).not.toContain('synthetic-secret');
  const output = execFileSync('/bin/sh', ['-c', request.command], { encoding: 'utf8', input: request.stdin, timeout: 10000 });
  expect(JSON.parse(output.trim())).toMatchObject({ name: 'portal', operation: 'up' });
  const db = new Database(path.join(f.root, 'remote.sqlite'));
  try { expect(db.prepare('select count(*) as n from portal_history').get()).toEqual({ n: 1 }); }
  finally { db.close(); }
});


it('preflights every config export before any connection, including a later invalid registry', async () => {
  const f = await workspace();
  await applicationDependencies(f.cwd);
  const marker = path.join(f.root, 'connected');
  await fs.writeFile(path.join(f.cwd, binding().config), `import fs from 'node:fs';
export default {migrations:[],connect:async()=>{fs.writeFileSync(${JSON.stringify(marker)},'unexpected');throw Error('connect must not run')}};`);
  await fs.writeFile(path.join(f.cwd, binding('market').config), 'export default {migrations:[]};');
  const { ProjectService } = await import('../../src/services/project.service.js');
  const service = Object.create(ProjectService.prototype) as any;
  service.logger = { info: vi.fn(), error: vi.fn() };
  await expect(service.runStackMigrations('fixture', 'dev', services([binding(), binding('market')]), f.entries, f.root,
    (entry: object) => ({ ...entry, env: { DATABASE_URL: 'postgres://u:p@localhost/api' } })))
    .rejects.toThrow('no migrations executed');
  expect(await fs.stat(marker).then(() => true, () => false)).toBe(false);
  expect(probe).not.toHaveBeenCalled();
});

it('does not turn infrastructure discovery into permission to migrate a database', async () => {
  const f = await workspace();
  await fs.mkdir(path.join(f.cwd, 'config'));
  await fs.writeFile(path.join(f.cwd, 'config/default.json'), JSON.stringify({ omnitron: { database: true } }));
  const { ProjectService } = await import('../../src/services/project.service.js');
  const service = Object.create(ProjectService.prototype) as any;
  service.logger = { debug: vi.fn() };
  const infrastructure = await service.generateDefaultInfrastructure({ apps: [{ name: 'api', bootstrap: 'apps/api/src/bootstrap.ts' }] }, f.root, 'all');
  expect(infrastructure.postgres.databases.api).toEqual({});
});
