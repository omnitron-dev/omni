import { lstatSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readSavedDaemonConfig } from '../config/saved.js';
import { OMNITRON_HOME } from '../config/defaults.js';
import { CLUSTER_ENROLLMENT_KEY } from './enrollment.js';

/** Direct Docker commands have no cluster grant. A missing config must not downgrade an enrolled installation. */
export function assertStandaloneInfrastructure(home = OMNITRON_HOME): void {
  const config = readSavedDaemonConfig(path.join(home, 'config.json'));
  const refused = 'Direct infrastructure changes are unavailable on a cluster member. Use the elected controller.';
  if (config?.cluster !== undefined && config.cluster?.enabled !== false) throw new Error(refused);

  const file = path.join(home, 'data/daemon-state.db');
  if (!lstatSync(file, { throwIfNoEntry: false })) return;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (db.prepare('SELECT 1 FROM state_kv WHERE key = ?').get(CLUSTER_ENROLLMENT_KEY)) throw new Error(refused);
  } finally {
    db.close();
  }
}
