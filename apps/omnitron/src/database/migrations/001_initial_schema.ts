/**
 * Migration 001 — Initial Omnitron Database Schema
 *
 * Creates all core tables for Omnitron's internal database:
 * nodes, portal users, sessions, logs, alerts, deployments, audit log.
 *
 * Seeds a default admin user (password: 'admin' — MUST be changed on first login).
 */

import { randomBytes, scryptSync } from 'node:crypto';
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Enable UUID generation
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`.execute(db);

  // ---------------------------------------------------------------------------
  // Nodes — Cluster Topology
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('nodes')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('hostname', 'text', (col) => col.notNull())
    .addColumn('address', 'text', (col) => col.notNull())
    .addColumn('port', 'integer', (col) => col.notNull())
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('follower'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('online'))
    .addColumn('lastHeartbeat', 'timestamptz')
    .addColumn('metadata', 'jsonb')
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  await db.schema
    .createIndex('idx_nodes_status')
    .on('nodes')
    .column('status')
    .execute();

  // ---------------------------------------------------------------------------
  // Portal Users
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('omnitron_users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('username', 'text', (col) => col.notNull().unique())
    .addColumn('passwordHash', 'text', (col) => col.notNull())
    .addColumn('displayName', 'text')
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('viewer'))
    .addColumn('totpSecret', 'text')
    .addColumn('totpEnabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('pgpPublicKey', 'text')
    .addColumn('pgpEnabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('lastLoginAt', 'timestamptz')
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('omnitron_sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('userId', 'uuid', (col) =>
      col.notNull().references('omnitron_users.id').onDelete('cascade')
    )
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('expiresAt', 'timestamptz', (col) => col.notNull())
    .addColumn('ipAddress', 'text')
    .addColumn('userAgent', 'text')
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  await db.schema
    .createIndex('idx_sessions_token')
    .on('omnitron_sessions')
    .column('token')
    .execute();

  await db.schema
    .createIndex('idx_sessions_userId')
    .on('omnitron_sessions')
    .column('userId')
    .execute();

  await db.schema
    .createIndex('idx_sessions_expiresAt')
    .on('omnitron_sessions')
    .column('expiresAt')
    .execute();

  // ---------------------------------------------------------------------------
  // Logs — Structured Log Storage
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('logs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('nodeId', 'uuid')
    .addColumn('app', 'text', (col) => col.notNull())
    .addColumn('level', 'text', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('labels', 'jsonb')
    .addColumn('traceId', 'text')
    .addColumn('spanId', 'text')
    .addColumn('metadata', 'jsonb')
    .execute();

  await db.schema.createIndex('idx_logs_timestamp').on('logs').column('timestamp').execute();
  await db.schema.createIndex('idx_logs_app').on('logs').column('app').execute();
  await db.schema.createIndex('idx_logs_level').on('logs').column('level').execute();
  await db.schema
    .createIndex('idx_logs_app_level_ts')
    .on('logs')
    .columns(['app', 'level', 'timestamp'])
    .execute();
  await db.schema.createIndex('idx_logs_traceId').on('logs').column('traceId').execute();

  // GIN index on labels for label-based queries (e.g. WHERE labels @> '{"env":"prod"}')
  await sql`CREATE INDEX idx_logs_labels ON logs USING GIN (labels jsonb_path_ops)`.execute(db);

  // ---------------------------------------------------------------------------
  // Alert Rules
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('alert_rules')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('expression', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('severity', 'text', (col) => col.notNull())
    .addColumn('forDuration', 'integer')
    .addColumn('annotations', 'jsonb')
    .addColumn('labels', 'jsonb')
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('lastEvaluatedAt', 'timestamptz')
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  // ---------------------------------------------------------------------------
  // Alert Events
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('alert_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('ruleId', 'uuid', (col) =>
      col.notNull().references('alert_rules.id').onDelete('cascade')
    )
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('value', 'text')
    .addColumn('annotations', 'jsonb')
    .addColumn('firedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('resolvedAt', 'timestamptz')
    .addColumn('acknowledgedAt', 'timestamptz')
    .addColumn('acknowledgedBy', 'text')
    .execute();

  await db.schema
    .createIndex('idx_alert_events_rule')
    .on('alert_events')
    .column('ruleId')
    .execute();

  await db.schema
    .createIndex('idx_alert_events_status')
    .on('alert_events')
    .column('status')
    .execute();

  await db.schema
    .createIndex('idx_alert_events_firedAt')
    .on('alert_events')
    .column('firedAt')
    .execute();

  // ---------------------------------------------------------------------------
  // Deployments
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('deployments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('app', 'text', (col) => col.notNull())
    .addColumn('version', 'text', (col) => col.notNull())
    .addColumn('previousVersion', 'text')
    .addColumn('strategy', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('startedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('completedAt', 'timestamptz')
    .addColumn('deployedBy', 'text')
    .addColumn('nodeId', 'uuid')
    .addColumn('metadata', 'jsonb')
    .execute();

  await db.schema
    .createIndex('idx_deployments_app')
    .on('deployments')
    .column('app')
    .execute();

  await db.schema
    .createIndex('idx_deployments_status')
    .on('deployments')
    .column('status')
    .execute();

  await db.schema
    .createIndex('idx_deployments_startedAt')
    .on('deployments')
    .column('startedAt')
    .execute();

  // ---------------------------------------------------------------------------
  // Audit Log
  // ---------------------------------------------------------------------------
  await db.schema
    .createTable('omnitron_audit_log')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('actorId', 'text')
    .addColumn('actorType', 'text', (col) => col.notNull().defaultTo('system'))
    .addColumn('resourceType', 'text', (col) => col.notNull())
    .addColumn('resourceId', 'text')
    .addColumn('details', 'jsonb')
    .addColumn('ipAddress', 'text')
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  await db.schema
    .createIndex('idx_audit_action')
    .on('omnitron_audit_log')
    .column('action')
    .execute();

  await db.schema
    .createIndex('idx_audit_resource')
    .on('omnitron_audit_log')
    .columns(['resourceType', 'resourceId'])
    .execute();

  await db.schema
    .createIndex('idx_audit_actor')
    .on('omnitron_audit_log')
    .columns(['actorType', 'actorId'])
    .execute();

  await db.schema
    .createIndex('idx_audit_createdAt')
    .on('omnitron_audit_log')
    .column('createdAt')
    .execute();

  // ---------------------------------------------------------------------------
  // Seed — Default admin user (password: 'admin')
  // Uses scrypt hash format matching AuthService.hashPassword() — scrypt:salt:derived
  // ---------------------------------------------------------------------------
  const salt = randomBytes(32);
  const derived = scryptSync('admin', salt, 64);
  const adminPasswordHash = `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;

  await sql`
    INSERT INTO omnitron_users (username, "passwordHash", "displayName", role)
    VALUES ('admin', ${adminPasswordHash}, 'Administrator', 'admin')
    ON CONFLICT (username) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('omnitron_audit_log').ifExists().execute();
  await db.schema.dropTable('deployments').ifExists().execute();
  await db.schema.dropTable('alert_events').ifExists().execute();
  await db.schema.dropTable('alert_rules').ifExists().execute();
  await db.schema.dropTable('logs').ifExists().execute();
  await db.schema.dropTable('omnitron_sessions').ifExists().execute();
  await db.schema.dropTable('omnitron_users').ifExists().execute();
  await db.schema.dropTable('nodes').ifExists().execute();
}
