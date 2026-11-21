import { defineSqlMigration } from '../../migration/index.js';

/** A native rule identity shared with the node that owns its own critical alert and delivery policy. */
export const STORAGE_ALERT_RULE = {
  id: 'ba2e59e0-b9fc-444c-a61e-c2be399ff828',
  name: 'Linux storage degraded',
  expression: 'host.storage.health == degraded',
  severity: 'critical',
  type: 'health',
  forDuration: null,
  summary: 'Linux reports a storage device or array redundancy fault',
} as const;

const rule = STORAGE_ALERT_RULE;
const annotation = JSON.stringify({ summary: rule.summary });
export const seedStorageAlert = `INSERT INTO alert_rules (id, name, expression, type, severity, annotations, enabled)
   VALUES ('${rule.id}', '${rule.name}', '${rule.expression}', '${rule.type}', '${rule.severity}', '${annotation}', true)
   ON CONFLICT (name) DO NOTHING`;
export const removeStorageAlert = `DELETE FROM alert_rules WHERE id = '${rule.id}' AND name = '${rule.name}' AND expression = '${rule.expression}'
   AND type = '${rule.type}' AND severity = '${rule.severity}' AND "forDuration" IS NULL AND enabled = true
   AND annotations = '${annotation}' AND labels IS NULL
   AND NOT EXISTS (SELECT 1 FROM alert_events WHERE "ruleId" = '${rule.id}')`;
// Keep the additive provenance column through a rollback. Existing alert history still needs its origin.
export const migration = defineSqlMigration(
  '018_host_storage_alert',
  `DO $migration$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'alert_events'::regclass AND attname = 'originNode' AND NOT attisdropped) THEN
      ALTER TABLE alert_events ADD COLUMN "originNode" text, ADD COLUMN "legacyOrigin" boolean NOT NULL DEFAULT false;
      -- Before this migration both the receiver and a local rule could supply annotations.node. Neither can prove ownership now.
      UPDATE alert_events SET "legacyOrigin" = true WHERE jsonb_typeof(annotations -> 'node') = 'string';
    END IF;
  END $migration$; ${seedStorageAlert}`,
  removeStorageAlert
);
export const { up, down } = migration;
