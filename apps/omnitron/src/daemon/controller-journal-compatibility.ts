import { lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import formats from '../shared/controller-journal-formats.json' with { type: 'json' };
import { inspectRuntimeArtifact } from '../shared/runtime-artifact.js';

type Database = ReturnType<typeof openSqliteDatabase>;

/** Only presence and cardinality are needed. Prompts, provider handles and human session grants stay in SQLite. */
export function controllerJournalNeeds(db: Database) {
  const table = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?");
  const has = (sql: string, ...args: (number | string)[]) => db.prepare(sql).get(...args) !== undefined;
  return db.transaction(() => {
    const teams = !!table.get('studio_peers');
    return {
      customStudioProviders:
        (!!table.get('studio_connections') &&
          has("SELECT 1 FROM studio_connections WHERE expires>? AND instr(provider,'/')>0 LIMIT 1", Date.now())) ||
        (!!table.get('studio_threads') && has("SELECT 1 FROM studio_threads WHERE instr(provider,'/')>0 LIMIT 1")) ||
        (teams &&
          (has("SELECT 1 FROM studio_peers WHERE instr(provider,'/')>0 LIMIT 1") ||
            has(
              "SELECT 1 FROM studio_threads AS t, json_each(t.policy,'$.providers') AS p WHERE t.policy IS NOT NULL AND instr(p.value,'/')>0 LIMIT 1"
            ))),
      teamRooms: teams && has('SELECT 1 FROM studio_threads WHERE policy IS NOT NULL LIMIT 1'),
      concurrentTurns:
        teams &&
        (has(
          "SELECT 1 FROM studio_turns WHERE status IN ('queued','running') GROUP BY threadId HAVING count(*)>1 LIMIT 1"
        ) ||
          has("SELECT 1 FROM studio_turns WHERE status='running' GROUP BY connection HAVING count(*)>1 LIMIT 1")),
      activeFlows:
        !!table.get('flow_definitions') && has('SELECT 1 FROM flow_definitions WHERE active IS NOT NULL LIMIT 1'),
      pendingDeliveries:
        !!table.get('flow_deliveries') &&
        has("SELECT 1 FROM flow_deliveries WHERE status IN ('pending','dispatching') LIMIT 1"),
    };
  })();
}
type Needs = ReturnType<typeof controllerJournalNeeds>;
function needed(needs: Needs) {
  return Object.values(needs).some(Boolean);
}
function statIfPresent(file: string) {
  try {
    return lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function assertControllerJournals(needs: Needs, directory: string) {
  if (!needed(needs)) return;
  const file = path.join(directory, 'shared/controller-journal-formats.json');
  let target: Partial<typeof formats> | null = null;
  const stat = statIfPresent(file);
  if (stat) {
    if (!stat.isFile() || stat.size > 4096) throw Error('Invalid controller journal format declaration');
    target = JSON.parse(await readFile(file, 'utf8'));
  }
  if ((needs.teamRooms || needs.concurrentTurns) && target?.studioTeams !== formats.studioTeams)
    throw Error(
      'The selected runtime cannot preserve Studio team conversations or concurrent turns. Select a team-compatible runtime.'
    );
  if (needs.customStudioProviders && target?.studioProviders !== formats.studioProviders)
    throw Error(
      'The selected runtime cannot preserve custom Studio providers. Select a runtime that supports registered connector IDs.'
    );
  if ((needs.activeFlows || needs.pendingDeliveries) && target?.hostFlows !== formats.hostFlows)
    throw Error(
      'The selected runtime cannot drive active flows or pending deliveries. Settle outstanding work and pause its flow, or select a flow-compatible runtime.'
    );
}

/** Older management processes may skip their own format check. The serving source checks again once RPC has drained. */
export function sourceControllerJournalCheck(home: string, targetHash?: string) {
  let target: { directory: string; assertUnchanged: () => Promise<void> } | undefined;
  return async () => {
    const file = path.join(home, 'data/daemon-state.db');
    if (!statIfPresent(file)) return;
    const db = openSqliteDatabase(file, { readonly: true, fileMustExist: true });
    let needs: Needs;
    try {
      needs = controllerJournalNeeds(db);
    } finally {
      db.close();
    }
    if (!needed(needs)) return;
    if (!targetHash || !/^[a-f0-9]{64}$/.test(targetHash))
      throw Error(
        'Studio or Flows requires a verified destination runtime. Use a manager that supplies the installed target identity.'
      );
    if (target) await target.assertUnchanged();
    else {
      const { RuntimeInstallation } = await import('./runtime-installation.js');
      const installation = await RuntimeInstallation.openReadOnly(home);
      if (!installation) throw Error('The destination runtime installation is unavailable');
      try {
        const root = installation.releasePath(targetHash);
        if (!lstatSync(root).isDirectory()) throw Error('The destination runtime must be an installed directory');
        const { assertUnchanged } = await inspectRuntimeArtifact(root, targetHash);
        target = { directory: path.join(root, 'packages/0/dist'), assertUnchanged };
      } finally {
        await installation.close();
      }
    }
    await assertControllerJournals(needs, target.directory);
  };
}
