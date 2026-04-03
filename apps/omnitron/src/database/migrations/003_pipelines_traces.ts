/**
 * Migration 003 — Pipelines, Pipeline Runs, and Traces tables
 *
 * Phase 5: Advanced — CI/CD pipeline execution and distributed tracing.
 *
 * Tables:
 * - pipelines: CI/CD pipeline definitions (steps, triggers)
 * - pipeline_runs: Execution history with per-step results
 * - traces: Distributed trace spans (OTLP-compatible)
 */

import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // =========================================================================
  // Pipelines — CI/CD pipeline definitions
  // =========================================================================

  await db.schema
    .createTable('pipelines')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('description', 'text')
    .addColumn('steps', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    .addColumn('triggers', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  // =========================================================================
  // Pipeline Runs — Execution history
  // =========================================================================

  await db.schema
    .createTable('pipeline_runs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('pipelineId', 'uuid', (col) => col.notNull().references('pipelines.id').onDelete('cascade'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('steps', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    .addColumn('startedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('completedAt', 'timestamptz')
    .addColumn('triggeredBy', 'text', (col) => col.notNull().defaultTo('manual'))
    .addColumn('params', 'jsonb')
    .execute();

  // Index: query runs by pipeline (most recent first)
  await db.schema
    .createIndex('idx_pipeline_runs_pipeline_started')
    .on('pipeline_runs')
    .columns(['pipelineId', 'startedAt'])
    .execute();

  // Index: query runs by status
  await db.schema
    .createIndex('idx_pipeline_runs_status')
    .on('pipeline_runs')
    .column('status')
    .execute();

  // =========================================================================
  // Traces — Distributed trace spans
  // =========================================================================

  await db.schema
    .createTable('traces')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('traceId', 'text', (col) => col.notNull())
    .addColumn('spanId', 'text', (col) => col.notNull())
    .addColumn('parentSpanId', 'text')
    .addColumn('operationName', 'text', (col) => col.notNull())
    .addColumn('serviceName', 'text', (col) => col.notNull())
    .addColumn('startTime', 'timestamptz', (col) => col.notNull())
    .addColumn('endTime', 'timestamptz', (col) => col.notNull())
    .addColumn('duration', 'double precision', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('ok'))
    .addColumn('tags', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('logs', 'jsonb')
    .execute();

  // Primary query pattern: find spans for a trace
  await db.schema
    .createIndex('idx_traces_trace_id')
    .on('traces')
    .column('traceId')
    .execute();

  // Query by service + time range
  await db.schema
    .createIndex('idx_traces_service_time')
    .on('traces')
    .columns(['serviceName', 'startTime'])
    .execute();

  // Query by operation + time range
  await db.schema
    .createIndex('idx_traces_operation_time')
    .on('traces')
    .columns(['operationName', 'startTime'])
    .execute();

  // Duration-based filtering (slow trace detection)
  await db.schema
    .createIndex('idx_traces_duration')
    .on('traces')
    .column('duration')
    .execute();

  // Tag-based filtering via GIN
  await sql`CREATE INDEX idx_traces_tags ON traces USING GIN (tags jsonb_path_ops)`.execute(db);

  // Parent-child join for service map queries
  await db.schema
    .createIndex('idx_traces_parent_span')
    .on('traces')
    .columns(['traceId', 'parentSpanId'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('pipeline_runs').ifExists().execute();
  await db.schema.dropTable('pipelines').ifExists().execute();
  await db.schema.dropTable('traces').ifExists().execute();
}
