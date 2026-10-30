import { defineSqlMigration } from '../../migration/index.js';

/** Preserve the outcome across a lost acknowledgement and a repeated batch. */
export const migration = defineSqlMigration('014_replication_receipts',
  `ALTER TABLE sync_ingested ADD COLUMN outcome varchar(16) NOT NULL DEFAULT 'unverified'`,
  'ALTER TABLE sync_ingested DROP COLUMN outcome');
export const up = migration.up;
export const down = migration.down!;
