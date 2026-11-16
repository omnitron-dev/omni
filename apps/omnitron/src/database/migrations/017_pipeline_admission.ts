import { defineSqlMigration } from '../../migration/index.js';

export const migration = defineSqlMigration('017_pipeline_admission',
  'ALTER TABLE pipeline_runs ADD COLUMN admission JSONB',
  'ALTER TABLE pipeline_runs DROP COLUMN admission');
export const up = migration.up;
export const down = migration.down!;
