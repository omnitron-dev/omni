import { METRICS_POSTGRES_SCHEMA_V1 } from '@omnitron-dev/titan-metrics';
import { defineSqlMigration } from '../../migration/index.js';

/** Titan owns storage/query semantics; Omnitron owns the migration lifecycle. */
export const migration = defineSqlMigration('015_persistent_metrics',
  METRICS_POSTGRES_SCHEMA_V1.join(';\n'), 'DROP TABLE metrics_samples');
export const up = migration.up;
export const down = migration.down!;
