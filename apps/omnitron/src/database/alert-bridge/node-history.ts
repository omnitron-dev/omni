import type { Kysely } from 'kysely';
import { createMigrationHistory, createMigrationRunner } from '../../migration/index.js';
import { migrateSlaveDb, SLAVE_MIGRATIONS } from '../slave-migrations/index.js';
import { STORAGE_ORIGIN_ROLLBACK } from './layout.js';

const expansion = {
  name: '002_host_storage_alert',
  checksum: STORAGE_ORIGIN_ROLLBACK.node,
  async up(): Promise<void> { throw Error('Only the expanded node release may apply 002_host_storage_alert'); },
};

/** Recognize the reviewed future row, without ever writing it or blessing unverified future history. */
export async function migrateBridgeNode(db: Kysely<unknown>): Promise<void> {
  const history = createMigrationHistory({ checksumColumn: 'checksum', orderColumn: 'execution_order' });
  const runner = createMigrationRunner(db, [...SLAVE_MIGRATIONS, expansion], {
    verbose: false,
    history: { ...history, async setup(connection) {
      const rows = await history.read(connection);
      if (rows.find(row => row.name === expansion.name)?.checksum !== expansion.checksum)
        throw Error('The reviewed node expansion changed before startup');
      await history.setup(connection);
    } },
  });
  const report = await runner.inspect();
  const applied = report.executed.find(row => row.name === expansion.name);
  if (!applied) return migrateSlaveDb(db);
  if (applied.checksum !== expansion.checksum || report.pending.length || report.drift.length || report.missingFiles.length)
    throw Error('Cannot admit the node migration history as the reviewed storage-alert expansion');
  await runner.up();
}
