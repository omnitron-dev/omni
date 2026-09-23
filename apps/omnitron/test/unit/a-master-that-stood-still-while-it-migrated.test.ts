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
vi.mock('../../src/services/wait-for-postgres.js', () => ({ waitForPostgres: async () => {} }));

import { ProjectService } from '../../src/services/project.service.js';

const REPO = path.resolve(import.meta.dirname, '../../../..');

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A project whose `main` app has a migrator doing `body`, with tsx reachable. */
function project(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-migrate-'));
  cleanup.push(root);
  fs.mkdirSync(path.join(root, 'apps/main/src/database'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/main/src/database/migrate.ts'), body);
  // An ES module, as the daos apps are: tsx compiles a `.ts` outside one to
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
  const stateStore: any = { save() {}, load: () => null, get: () => null, set() {} };
  const svc: any = new ProjectService(logger, { list: () => [], listHandleNames: () => [] } as never, stateStore);
  const migrate = (root: string) =>
    svc.runStackMigrations(
      'daos',
      'dev',
      { postgres: { port: 5432, user: 'postgres', password: 'x', databases: { main: { migrate: true } } } },
      [{ name: 'main' }],
      root,
    ) as Promise<void>;
  return { migrate, said };
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

  it('still reports a failed migration with what it wrote to stderr', async () => {
    const root = project("process.stderr.write('ERROR: relation \"wallets\" does not exist\\n'); process.exit(1);\n");
    const { migrate, said } = service();

    await migrate(root);

    const failed = said.find((s) => s.msg === 'Migration failed — app may fail to start');
    expect(failed?.level).toBe('error');
    expect(failed?.fields['stderr']).toBe('ERROR: relation "wallets" does not exist');
    expect(said.some((s) => s.msg === 'Migrations applied')).toBe(false);
  });
});
