/**
 * Omnitron Migration Registry — the single ordered list of migrations.
 *
 * Three call sites used to keep their own hand-maintained copy of this
 * list, and all three had drifted: the daemon knew 001–005, the
 * infrastructure service only 001–002, and the `migrate` CLI 001–003.
 * Whichever path ran first decided how much of the schema existed.
 *
 * Adding a migration now means adding it here, once. `migrations.test.ts`
 * fails if a `NNN_*.ts` file in this directory is missing from the list,
 * so the registry cannot silently fall behind again.
 */

import type { Migration } from '@kysera/migrations';

import * as m001 from './001_initial_schema.js';
import * as m002 from './002_metrics_raw.js';
import * as m003 from './003_pipelines_traces.js';
import * as m004 from './004_sync_buffer.js';
import * as m005 from './005_node_health_checks.js';
import * as m006 from './006_login_throttle.js';
import * as m007 from './007_sync_ingested.js';

/**
 * Every Omnitron migration, in apply order.
 *
 * Names are the on-disk basenames without extension — they are the keys
 * recorded in the migrations table, so they must never be renamed.
 */
export const OMNITRON_MIGRATIONS: Migration[] = [
  { name: '001_initial_schema', up: m001.up, down: m001.down },
  { name: '002_metrics_raw', up: m002.up, down: m002.down },
  { name: '003_pipelines_traces', up: m003.up, down: m003.down },
  { name: '004_sync_buffer', up: m004.up, down: m004.down },
  { name: '005_node_health_checks', up: m005.up, down: m005.down },
  { name: '006_login_throttle', up: m006.up, down: m006.down },
  { name: '007_sync_ingested', up: m007.up, down: m007.down },
];
