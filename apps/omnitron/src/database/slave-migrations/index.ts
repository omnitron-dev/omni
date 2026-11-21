import type { Kysely } from 'kysely';
import { createMigrationRunner, type Migration } from '../../migration/index.js';
import * as evidence from './001_replication_evidence.js';
import * as storage from './002_host_storage_alert.js';

/** Local SQLite evolves through the same engine as public application migrations. */
export const SLAVE_MIGRATIONS: Migration[] = [
  { name: '001_replication_evidence', checksum: 'f741723f7af629811a79b13c214a81ca472beedcd03896c8ecac79554463d098', up: evidence.up },
  { name: '002_host_storage_alert', checksum: 'c3db5c37a9fc110dcb6f6cabf3b304da4407530de99286d77bdff41646a20105', up: storage.up, down: storage.down },
];

export async function migrateSlaveDb(db: Kysely<unknown>): Promise<void> {
  await createMigrationRunner(db, SLAVE_MIGRATIONS, { verbose: false }).up();
}
