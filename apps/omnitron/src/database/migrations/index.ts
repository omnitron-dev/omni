/**
 * Omnitron Migration Registry — the single ordered list of migrations.
 *
 * Three call sites used to keep their own hand-maintained copy of this
 * list, and all three had drifted: the daemon knew 001–005, the
 * infrastructure service only 001–002, and the `migrate` CLI 001–003.
 * Whichever path ran first decided how much of the schema existed.
 *
 * Adding a migration now means adding it here, once. `omnitron-migrations.test.ts`
 * fails if a `NNN_*.ts` file in this directory is missing from the list,
 * so the registry cannot silently fall behind again.
 */

import type { Migration } from '../../migration/index.js';

import * as m001 from './001_initial_schema.js';
import * as m002 from './002_metrics_raw.js';
import * as m003 from './003_pipelines_traces.js';
import * as m004 from './004_sync_buffer.js';
import * as m005 from './005_node_health_checks.js';
import * as m006 from './006_login_throttle.js';
import * as m007 from './007_sync_ingested.js';
import * as m008 from './008_node_health_version_text.js';
import * as m009 from './009_node_health_unmeasured.js';
import * as m010 from './010_metrics_raw_had_no_reader.js';
import * as m011 from './011_alerts_nobody_had_to_write.js';
import * as m012 from './012_a_disk_nobody_watched.js';
import * as m013 from './013_an_alarm_delivered.js';
import * as m014 from './014_replication_receipts.js';
import * as m015 from './015_persistent_metrics.js';
import * as m016 from './016_cluster_lease.js';

/**
 * Every Omnitron migration, in apply order.
 *
 * Names are the on-disk basenames without extension — they are the keys
 * recorded in the migrations table, so they must never be renamed.
 */
// Procedural 001–013 retain their exact source digest across transpilation.
// The registry test binds these declarations to the immutable source files.
// Kysera records them only for new executions; old null checksums stay unknown.
export const OMNITRON_MIGRATIONS: Migration[] = [
  { name: '001_initial_schema', checksum: '1ea5700699a42c993cc2aa4b8cc0ff7b2136b089e9dab66a1f2159defb125251', up: m001.up, down: m001.down },
  { name: '002_metrics_raw', checksum: '64b895f31363f464479fd5746d48a7be71643d2c069c774d5c276202b67cf7a8', up: m002.up, down: m002.down },
  { name: '003_pipelines_traces', checksum: 'ce3574c4aac44f1c6501a85d7f9fbcfcd30c878f6b32da6db39db8a12fe7c851', up: m003.up, down: m003.down },
  { name: '004_sync_buffer', checksum: '44b1845017fccc485b8368568199bb6caf0a779f5df603d6a2a505013bad5961', up: m004.up, down: m004.down },
  { name: '005_node_health_checks', checksum: '9e20b8f3040a15eb6c042c5b5bc025fa7bf8434aa4028d3ae1c1bd543d76a2a8', up: m005.up, down: m005.down },
  { name: '006_login_throttle', checksum: 'a0fe0d3f7a99e613aa81d7f5830cff0b17e4375bed2e85152f0e64879849300b', up: m006.up, down: m006.down },
  { name: '007_sync_ingested', checksum: '1c88cd7f6efafc157f0c64aef8b1ba3ada3699a546cb97f3ed27816395021ff4', up: m007.up, down: m007.down },
  { name: '008_node_health_version_text', checksum: '278065f143d4378adf1c50c8a9d0eeaddffae34f158b971e8e83e4553b1471dd', up: m008.up, down: m008.down },
  { name: '009_node_health_unmeasured', checksum: 'fdd4170c9537c61ca37ac8669d0264da3ec56e66c1e7e037fd96380d69c26055', up: m009.up, down: m009.down },
  { name: '010_metrics_raw_had_no_reader', checksum: '5ae1123fa50438c5b0a3939a8589d99cca845f94d9c70d8c4e080431215edb56', up: m010.up, down: m010.down },
  { name: '011_alerts_nobody_had_to_write', checksum: 'dc55705e8a9b1d0c828563ad5cb11a0e71550af09e602368f5364f63b762ddbf', up: m011.up, down: m011.down },
  { name: '012_a_disk_nobody_watched', checksum: 'bf42ae2699c0f29027f1a8293a6cc76d751669eaf96bcb73e2f3f6bbf7ca883b', up: m012.up, down: m012.down },
  { name: '013_an_alarm_delivered', checksum: '006941fcd7ce74a977a66e0509e358bc11f60a678c2a251fcf5dcb5e658635ef', up: m013.up, down: m013.down },
  m014.migration,
  m015.migration,
  m016.migration,
];
