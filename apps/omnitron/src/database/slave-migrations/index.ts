import type { Kysely } from 'kysely';
import { createMigrationRunner, type Migration } from '../../migration/index.js';
import * as evidence from './001_replication_evidence.js';

/** Local SQLite evolves through the same engine as public application migrations. */
export const SLAVE_MIGRATIONS: Migration[] = [
  { name: '001_replication_evidence', up: evidence.up },
];

export async function migrateSlaveDb(db: Kysely<unknown>): Promise<void> {
  await createMigrationRunner(db, SLAVE_MIGRATIONS, { verbose: false }).up();
}
