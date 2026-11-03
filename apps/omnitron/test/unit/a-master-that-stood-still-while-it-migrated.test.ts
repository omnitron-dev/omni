/**
 * A master that stood still while it migrated.
 *
 * A local stack's migrations ran through `execFileSync`, on the daemon's own
 * event loop. The event-loop watch caught it at a master boot on 2026-09-23:
 *
 *     02:04:11.745  Running database migrations   (main)
 *     02:04:13.284  Migrations applied
 *     02:04:13.285  The event loop stood still — 1 587 ms, 12 ms of CPU, off-cpu
 *
 * and five more after it, each under the watch's one-second threshold and
 * each holding the loop all the same: 1 539 / 871 / 727 / 941 / 740 / 782
 * ms, 5.6 s in which the master answered no CLI, no console and no mesh — on
 * every restart. The retry policy allows 60 s per attempt, and a migration
 * that hung held the daemon for all of it.
 *
 * The real `runStackMigrations`, a real `node --import tsx/esm` child, and a
 * migrator that takes two seconds; a 50 ms timer asks whether the loop ran
 * meanwhile.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, it, expect, vi, afterEach } from 'vitest';

// The database is not what is judged here.
const { probe } = vi.hoisted(() => ({ probe: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock('../../src/services/wait-for-postgres.js', () => ({ waitForPostgres: probe }));

import { ProjectService } from '../../src/services/project.service.js';
import { normalizeInfraConfig } from '../../src/infrastructure/config-normalizer.js';
import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import type { InfrastructureConfig } from '../../src/infrastructure/types.js';

const REPO = path.resolve(import.meta.dirname, '../../../..');

const cleanup: string[] = [];
afterEach(() => {
  probe.mockClear();
  vi.restoreAllMocks();
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A project whose `main` app has a migrator doing `body`, with tsx reachable. */
function project(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-migrate-'));
  cleanup.push(root);
  fs.mkdirSync(path.join(root, 'apps/main/src/database'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/main/src/database/migrate.ts'), body);
  // An ES module, as the sample apps are: tsx compiles a `.ts` outside one to
  // CommonJS, where a top-level `await` does not compile.
  fs.writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  // `--import tsx/esm` resolves from the child's working directory upward.
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));
  return root;
}

function service() {
  const said: Array<{ level: string; msg: string; fields: Record<string, unknown> }> = [];
  const at = (level: string) => (a: unknown, b?: string) =>
    said.push({ level, fields: typeof a === 'object' && a ? (a as Record<string, unknown>) : {}, msg: typeof a === 'string' ? a : (b ?? '') });
  const logger: any = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace() {}, fatal() {}, child: () => logger };
  const stateStore: any = { selectProjectsSync: () => [], kvGetSync: () => null, save() {}, load: () => null, get: () => null, set() {} };
  const svc: any = new ProjectService(logger, { list: () => [], listHandleNames: () => [] } as never, stateStore);
  const migrate = (root: string, infra: InfrastructureConfig = { postgres: { databases: { main: { migrate: true } } } }, env: Record<string, string> = { DATABASE_URL: "postgres://postgres:x@127.0.0.1:5544/main" }) =>
    svc.runStackMigrations(
      'sample',
      'dev',
      normalizeInfraConfig(infra, createDefaultRegistry()),
      [{ name: 'main' }],
      root,
      (entry: { name: string }) => ({ ...entry, env }),
    ) as Promise<void>;
  return { migrate, said, svc };
}

describe('a master that stood still while it migrated', () => {
  it('keeps its loop running while a migration runs', async () => {
    const root = project('await new Promise((r) => setTimeout(r, 2_000));\n');
    const { migrate, said } = service();

    let last = performance.now();
    let longest = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 50);
    const t0 = performance.now();
    try {
      await migrate(root);
      // Up to now, too: a loop held until the very end resumes in a chain of
      // microtasks that reaches this line before the timer can fire again,
      // and the gap it left would never be measured. (It was not, in the
      // first version of this case, which the synchronous runner passed.)
      longest = Math.max(longest, performance.now() - last);
    } finally {
      clearInterval(timer);
    }
    const took = performance.now() - t0;

    expect(said.find((s) => s.msg === 'Migrations applied')?.fields).toMatchObject({ database: 'main', attempts: 1 });
    expect(took, 'the migrator really ran its two seconds').toBeGreaterThanOrEqual(2_000);
    expect(longest, 'the longest the loop went without running a 50 ms timer').toBeLessThan(1_500);
  });

  it("logs what the migrations said, and cuts the runner's list of every name to its count", async () => {
    // What sample's runner and migration 195 printed on dev, 2026-09-25 — and
    // what the daemon threw away, logging only «Migrations applied».
    const root = project(
      [
        "console.log('Connecting to PostgreSQL at localhost:5432/main');",
        "console.log('Discovered 3 migration(s): 193_a_tie, 194_three_keys, 195_a_marketplace');",
        "console.log('  195: measurement axes — found 0, created 5; presets added 23');",
        "console.log('  195: other measurement axes in scope product: 2 — units-1788956628078 «Единицы» (count, 4 values)');",
        "console.log('');",
        "console.log('1 migration(s) applied. 2 already applied.');",
      ].join('\n') + '\n',
    );
    const { migrate, said } = service();

    await migrate(root);

    const lines = said.filter((s) => s.msg === 'Migration said');
    expect(lines.map((s) => s.fields['line'])).toEqual([
      'Connecting to PostgreSQL at localhost:5432/main',
      'Discovered 3 migration(s)',
      '  195: measurement axes — found 0, created 5; presets added 23',
      '  195: other measurement axes in scope product: 2 — units-1788956628078 «Единицы» (count, 4 values)',
      '1 migration(s) applied. 2 already applied.',
    ]);
    expect(lines.every((s) => s.level === 'info' && s.fields['database'] === 'main')).toBe(true);
    // Said before the verdict, not instead of it.
    const applied = said.findIndex((s) => s.msg === 'Migrations applied');
    expect(applied).toBeGreaterThan(said.lastIndexOf(lines.at(-1)!));
  });

  it('still reports a failed migration with what it wrote to stderr', async () => {
    const root = project("process.stderr.write('ERROR: relation \"wallets\" does not exist\\n'); process.exit(1);\n");
    const { migrate, said } = service();

    await expect(migrate(root)).rejects.toThrow('stack startup refused: ERROR: relation "wallets" does not exist');

    const failed = said.find((s) => s.msg === 'Migration failed — stack startup refused');
    expect(failed?.level).toBe('error');
    expect(failed?.fields['stderr']).toBe('ERROR: relation "wallets" does not exist');
    expect(said.some((s) => s.msg === 'Migrations applied')).toBe(false);
  });
  it('does not probe or execute when databases were only inferred', async () => {
    const root = project("throw Error('must not execute');");
    await service().migrate(root, { postgres: { databases: { main: {} } } });
    expect(probe).not.toHaveBeenCalled();
  });

  it('does not retry a connection failure after the migrator has executed', async () => {
    const root = project(`import fs from 'node:fs';
      fs.appendFileSync('attempts', 'one\\n');
      process.stderr.write('ECONNRESET after commit'); process.exit(1);`);
    await expect(service().migrate(root)).rejects.toThrow('Inspect the migration ledger before retrying');
    expect(fs.readFileSync(path.join(root, 'apps/main/attempts'), 'utf8')).toBe('one\n');
  });

  it('honors an explicit named service and preserves the resolved application connection', async () => {
    const url = 'postgresql://app%40user:p%2Fword@127.0.0.1:5544/main';
    const root = project(`
      import assert from 'node:assert/strict';
      assert.equal(process.env.DATABASE_URL, ${JSON.stringify(url)});
      assert.equal(process.env.MAIN__DATABASE__PORT, '5544');
      assert.equal(process.env.MAIN__DATABASE__PASSWORD, 'p/word');
      assert.equal(process.env.APP_SETTING, 'kept');
    `);
    await service().migrate(root, { services: { database: { preset: 'postgres', config: { databases: { main: { migrate: true } } } } } }, { DATABASE_URL: url, APP_SETTING: 'kept' });
    expect(probe).toHaveBeenCalledExactlyOnceWith('127.0.0.1', 5544, 'app@user', 'p/word', 180_000, url);
  });

  it('refuses URL options that the standard migrator cannot guarantee before probing the database', async () => {
    const root = project("throw Error('must not execute');");
    await expect(service().migrate(root, undefined, { DATABASE_URL: 'postgres://u:secret@localhost:5544/main?sslmode=require' }))
      .rejects.toThrow('refuses DATABASE_URL options');
    expect(probe).not.toHaveBeenCalled();
  });

  it('an explicit named service overrides legacy migration sugar, just as provisioning does', async () => {
    const root = project("throw Error('must not execute');");
    await service().migrate(root, { postgres: { databases: { main: { migrate: true } } }, services: { postgres: { preset: 'postgres', config: { databases: { main: {} } } } } });
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses a missing requested script before probing any database', async () => {
    const root = project('');
    fs.unlinkSync(path.join(root, 'apps/main/src/database/migrate.ts'));
    await expect(service().migrate(root)).rejects.toThrow('migration script is unavailable');
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses absent or mismatched connections without echoing credentials', async () => {
    const root = project('');
    for (const env of [{}, { DATABASE_URL: 'postgres://user:secret@localhost:5432/other' }]) {
      const error = await service().migrate(root, undefined, env).catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('requires its resolved PostgreSQL DATABASE_URL');
      expect(error.message).not.toContain('secret');
    }
    expect(probe).not.toHaveBeenCalled();
  });

});

/** Exercise inference, normalization, port allocation and the real app builder together.
 * Only Docker provisioning, bootstrap loading and process creation are substituted.
 */
describe('local stack migration admission', () => {
  function stack(root: string, migrate: boolean, env?: Record<string, string>) {
    const { svc } = service();
    const startApp = vi.fn(async (..._args: unknown[]) => {});
    const manager = new StackInfrastructureManager(svc.logger);
    svc.infraManager = manager;
    svc.registry = { get: () => ({ name: 'sample', path: root }) };
    svc.stackStates = new Map([['sample/dev', {}]]);
    svc.orchestrator = { startApp };
    svc.stackEnvFor = async () => ({});
    svc.loadAppDefinitions = async () => new Map([['main', { omnitronConfig: { database: true } }]]);
    vi.spyOn(InfrastructureService.prototype, 'provision').mockResolvedValue(undefined);
    vi.spyOn(InfrastructureService.prototype, 'getState').mockImplementation(function (this: InfrastructureService) {
      return { services: Object.fromEntries(this.getDesiredServices().map(service => [service.name, {
        name: service.name, status: 'running', health: 'healthy',
      }])) } as never;
    });
    const configuration = {
      type: 'local', apps: 'all', settings: { portOffsets: { postgres: 112 } }, infrastructure: { services: {
        postgres: { preset: 'postgres', docker: { portMappings: { main: 5544 } }, config: { databases: { main: migrate ? { migrate: true } : {} } } },
      } },
    };
    return { startApp, manager, start: () => svc.startLocalStack('sample', 'dev', configuration, {
      apps: [{ name: 'main', bootstrap: 'apps/main/bootstrap.ts', ...(env && { env }) }],
    }) };
  }

  it('starts an inferred database consumer without a migration connection, using the allocated service port', async () => {
    const fixture = stack(project("throw Error('not requested');"), false);
    try {
      await fixture.start();
      expect(probe).not.toHaveBeenCalled();
      expect(fixture.startApp).toHaveBeenCalledTimes(1);
      const entry = fixture.startApp.mock.calls[0]![0] as unknown as { env: Record<string, string> };
      const connection = new URL(entry.env.DATABASE_URL!);
      expect(connection.port).toBe('5544');
      expect(connection.pathname).toBe('/main');
    } finally { fixture.manager.dispose(); }
  });

  it('refuses a missing requested migrator before infrastructure provisioning', async () => {
    const root = project('');
    fs.unlinkSync(path.join(root, 'apps/main/src/database/migrate.ts'));
    const fixture = stack(root, true);
    const provision = vi.spyOn(fixture.manager, 'provisionStack');
    try {
      await expect(fixture.start()).rejects.toThrow('migration script is unavailable');
      expect(provision).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
      expect(fixture.startApp).not.toHaveBeenCalled();
    } finally { fixture.manager.dispose(); }
  });

  it('refuses unsupported migration connection options before changing infrastructure', async () => {
    const fixture = stack(project(''), true, { DATABASE_URL: 'postgres://u:p@localhost:5544/main?sslmode=require' });
    const provision = vi.spyOn(fixture.manager, 'provisionStack');
    try {
      await expect(fixture.start()).rejects.toThrow('refuses DATABASE_URL options');
      expect(provision).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
      expect(fixture.startApp).not.toHaveBeenCalled();
    } finally { fixture.manager.dispose(); }
  });

  it('refuses application creation if an explicitly requested migration fails', async () => {
    const fixture = stack(project("throw Error('fixture schema refusal');"), true);
    try {
      await expect(fixture.start()).rejects.toThrow('stack startup refused');
      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe.mock.calls[0]?.[1]).toBe(5544);
      expect(fixture.startApp).not.toHaveBeenCalled();
    } finally { fixture.manager.dispose(); }
  });
});
