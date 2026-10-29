/**
 * Omnitron Database Migration CLI
 *
 * Applies (or rolls back) the migrations in `migrations/index.ts` against
 * omnitron-pg. The daemon's boot path runs the SAME registry through the
 * SAME engine (`migration-runner.ts`) — this entry point only adds argv
 * handling, console logging and the rollback direction.
 *
 * Usage:
 *   tsx src/database/migrate.ts          (apply all pending)
 *   tsx src/database/migrate.ts --down   (rollback last)
 */

import { createOmnitronMigrationRunner } from './migration-runner.js';

import { createOmnitronDb, resolveOmnitronPgConfig } from './connection.js';

const isDown = process.argv.includes('--down');

async function run() {
  const { host, port, database } = resolveOmnitronPgConfig();
  console.log(`Target: ${host}:${port}/${database}`);

  const db = await createOmnitronDb<unknown>({ max: 2 });

  const runner = createOmnitronMigrationRunner(db);

  try {
    if (isDown) {
      const result = await runner.down(1);
      console.log(`Rolled back ${result.executed.length} migration(s).`);
    } else {
      const result = await runner.up();
      console.log(`${result.executed.length} migration(s) applied.`);
    }
  } finally {
    await db.destroy();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
