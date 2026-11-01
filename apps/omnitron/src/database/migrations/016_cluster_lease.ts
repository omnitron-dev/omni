import { POSTGRES_LEASE_SCHEMA_V1 } from '@omnitron-dev/titan-database/coordination';
import { defineSqlMigration } from '../../migration/index.js';

export const migration = defineSqlMigration('016_cluster_lease',
  POSTGRES_LEASE_SCHEMA_V1, 'DROP TABLE titan_database_leases');
export const up = migration.up;
export const down = migration.down!;
