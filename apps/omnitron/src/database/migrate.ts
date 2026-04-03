/**
 * Omnitron Database Migration Runner
 *
 * Runs migrations on omnitron-pg (port 5480) using @kysera/migrations.
 *
 * Usage:
 *   tsx src/database/migrate.ts          (apply all pending)
 *   tsx src/database/migrate.ts --down   (rollback last)
 */

import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { createMigrationRunner } from '@kysera/migrations';

import * as m001 from './migrations/001_initial_schema.js';
import * as m002 from './migrations/002_metrics_raw.js';
import * as m003 from './migrations/003_pipelines_traces.js';

const DATABASE_URL = process.env['OMNITRON_DATABASE_URL'] || 'postgresql://omnitron:omnitron@localhost:5480/omnitron';
const url = new URL(DATABASE_URL);

const db = new Kysely<unknown>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      host: url.hostname,
      port: Number(url.port) || 5480,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
    }),
  }),
});

const migrations = [
  { name: '001_initial_schema', up: m001.up, down: m001.down },
  { name: '002_metrics_raw', up: m002.up, down: m002.down },
  { name: '003_pipelines_traces', up: m003.up, down: m003.down },
];

const isDown = process.argv.includes('--down');

async function run() {
  const runner = createMigrationRunner(db, migrations, {
    verbose: true,
    useTransactions: true,
    logger: {
      info: (msg: string) => console.log(msg),
      warn: (msg: string) => console.warn(msg),
      error: (msg: string) => console.error(msg),
      debug: () => {},
      trace: () => {},
      fatal: (msg: string) => console.error(msg),
    },
  });

  if (isDown) {
    const result = await runner.down(1);
    console.log(`Rolled back ${result.executed.length} migration(s).`);
  } else {
    const result = await runner.up();
    console.log(`${result.executed.length} migration(s) applied.`);
  }

  await db.destroy();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
