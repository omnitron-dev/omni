/**
 * omnitron backup create [database] — Create database backup
 * omnitron backup list — List available backups
 * omnitron backup restore <id> — Restore from backup
 */

import { log } from '@xec-sh/kit';
import {
  formatBackupSize,
  formatUtc,
  resolveBackupId,
  uniqueIdPrefixLength,
} from '../services/backup-pipeline.js';
import { createDaemonClient } from '../daemon/daemon-client.js';

async function invokeRpc(method: string, data?: any): Promise<any> {
  const client = createDaemonClient();
  try {
    if (!(await client.isReachable())) {
      throw new Error('omnitron daemon is not running (start it with `omnitron up`)');
    }
    const svc = await client.service<Record<string, (arg?: any) => Promise<any>>>('OmnitronBackups');
    return data !== undefined ? await svc[method]!(data) : await svc[method]!();
  } finally {
    await client.disconnect();
  }
}

/**
 * Call a method an older daemon does not serve, and learn that without
 * failing. Netron refuses an unknown method by name ("Unknown member: …");
 * that one refusal becomes `undefined`, and the command says what it cannot
 * show. Any other error is still an error.
 */
async function invokeOptionalRpc(method: string, data?: any): Promise<any | undefined> {
  try {
    return await invokeRpc(method, data);
  } catch (err) {
    if (/Unknown member: '[^']+' is not defined/.test((err as Error).message)) return undefined;
    throw err;
  }
}

/** The status the daemon reports beside the index rows, or why there is none. */
async function readBackupStatus(): Promise<{ status?: any; unavailable?: string }> {
  try {
    const status = await invokeOptionalRpc('getBackupStatus');
    return status ? { status } : { unavailable: 'this daemon does not report it (no getBackupStatus)' };
  } catch (err) {
    return { unavailable: (err as Error).message };
  }
}

/** A span as an operator reads it: `3 d 15 h`, `5 h 43 min`, `12 min`, `40 s`. */
function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * One recorded pass, in UTC, with the reason of everything that failed.
 * `EMPTY` is spelled out: a pass that found nothing did not succeed.
 */
function describePass(pass: any): string {
  if (!pass) return 'none recorded yet';
  const when = formatUtc(pass.startedAt);
  if (pass.outcome === 'empty') return `${when}  EMPTY — nothing was found to back up`;
  const took = Math.max(0, Math.round((Date.parse(pass.finishedAt) - Date.parse(pass.startedAt)) / 1000));
  const head = `${when}  ${String(pass.outcome).toUpperCase()} — ${pass.ok} of ${pass.total} in ${took} s`;
  const failures: any[] = pass.failures ?? [];
  return failures.length === 0 ? head : `${head}; failed: ${failures.map((f) => `${f.target} (${f.error})`).join('; ')}`;
}

export async function backupCreateCommand(database?: string): Promise<void> {
  try {
    // No target ⇒ back up every database of every running stack (the safe
    // default for data protection). A specific name backs up just that DB.
    if (!database) {
      log.info('Creating backups for all running-stack databases...');
      const results: any[] = await invokeRpc('createAllBackups');
      if (!results || results.length === 0) {
        log.warn('No databases found to back up — is a stack running?');
        return;
      }
      printPassResults(results, (r) => qualifiedName(r, r.database), 'database(s)');
      return;
    }

    log.info(`Creating backup for '${database}'...`);
    const backup: any = await invokeRpc('createBackup', { database, compress: true });
    log.success(`Backup created: ${backup.filename} (${formatBackupSize(backup.size)})`);
    log.info(`  ID: ${backup.id}`);
    log.info(`  Database: ${backup.database}`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

export async function backupListCommand(): Promise<void> {
  try {
    const backups: any[] = await invokeRpc('listBackups');

    if (backups.length === 0) {
      log.info('No backups available');
      return;
    }

    log.info(`Found ${backups.length} backup(s):\n`);
    // The id is the first column because it is what `backup restore` takes —
    // the list used to print everything except it. A prefix, as long as it
    // needs to be to stay unique and never shorter than `backup create`'s
    // eight characters, so the same token works from either.
    const idLength = uniqueIdPrefixLength(backups.map((b) => String(b.id)));
    const rows = backups.map((b) => [
      String(b.id).slice(0, idLength),
      // Whose database this is: two stacks can both have a `main`.
      stackLabel(b),
      b.database,
      formatBackupSize(b.size),
      // UTC, as the filenames are — see `formatUtc`.
      formatUtc(b.createdAt),
      b.filename,
    ]);
    for (const line of renderTable(['ID', 'Stack', 'Database', 'Size', 'Created (UTC)', 'File'], rows)) log.info(line);
    if (backups.some((b) => stackLabel(b) === '—')) {
      log.info('(Stack — : taken before backups recorded their stack)');
    }
    log.info('\nRestore one with: omnitron backup restore <ID>');

    // A pass that lost a database leaves a listing that looks complete — the
    // missing row is the only trace. Say so here, where people look.
    const { status, unavailable } = await readBackupStatus();
    if (!status) {
      log.warn(`Which stacks are backed up, and how each schedule last ran: unknown — ${unavailable}`);
      return;
    }
    for (const s of status.schedules ?? []) {
      if (s.lastPass && s.lastPass.outcome !== 'ok') {
        log.warn(`Last '${s.target}' pass: ${describePass(s.lastPass)}`);
      }
    }
    reportCoverage(status.stacks);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

/** `project/stack`, `control-plane`, or `—` for a row from before the stack was recorded. */
function stackLabel(b: any): string {
  if (b.project && b.stack) return `${b.project}/${b.stack}`;
  return b.scope === 'control-plane' ? 'control-plane' : '—';
}

/** A database named with its stack when the daemon said which one. */
function qualifiedName(r: any, name: string): string {
  return r.project && r.stack && !r.skipped ? `${r.project}/${r.stack}/${name}` : name;
}

/**
 * Which running stacks this daemon backs up — and, as a warning, which it
 * does not. «Found 380 backup(s)» and «all hourly» read as «everything is
 * covered» on the master, while the test stack's databases — on another
 * machine — were in none of them.
 */
function reportCoverage(stacks: any[] | undefined): void {
  const list = stacks ?? [];
  if (list.length === 0) return;
  log.info('\nRunning stacks:');
  for (const s of list) {
    const name = `${s.project}/${s.stack}`;
    if (s.notBackedUp) log.warn(`  ${name}: not backed up — ${s.notBackedUp}`);
    else if (s.databases?.length) log.info(`  ${name}: backed up — ${s.databases.join(', ')}`);
    else log.info(`  ${name}: no databases`);
  }
}

/** The per-entry lines of an `all` or `full` pass, and its tally. */
function printPassResults(results: any[], nameOf: (r: any) => string, unit: string): void {
  const skipped = results.filter((r) => r.skipped);
  const attempted = results.filter((r) => !r.skipped);
  for (const r of attempted) {
    if (r.ok) log.success(`  ✓ ${nameOf(r)} — ${formatBackupSize(r.size ?? 0)} [${String(r.id ?? '').slice(0, 8)}]`);
    else log.error(`  ✗ ${nameOf(r)}: ${r.error}`);
  }
  for (const r of skipped) log.warn(`  – ${nameOf(r)}: ${r.error}`);
  const ok = attempted.filter((r) => r.ok).length;
  log.info(`Done: ${ok}/${attempted.length} ${unit} backed up`);
  if (skipped.length > 0) log.warn(`Not backed up: ${skipped.map(nameOf).join(', ')}`);
}

/**
 * Columns as wide as what they hold. The fixed 25 characters are how the
 * filename was cut at `geo_2026-09-23T08-19-04-` — one character before the
 * part that identified the backup.
 */
function renderTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]): string =>
    cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join('  ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
}

export async function backupFullCommand(): Promise<void> {
  try {
    log.info('Creating FULL backup (all DBs + control-plane DB + storage + tor keys + daemon-state)...');
    const results: any[] = await invokeRpc('createFullBackup');
    if (!results || results.length === 0) {
      log.warn('Nothing to back up — is a stack running?');
      return;
    }
    printPassResults(results, (r) => qualifiedName(r, r.target), 'target(s)');
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

export async function backupScheduleCommand(target: string, cron: string): Promise<void> {
  try {
    await invokeRpc('setSchedule', { database: target, cron });
    log.success(`Scheduled backup of '${target}': ${cron}`);
    log.info(`  (use 'all' to back up every running-stack database)`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

export async function backupSchedulesCommand(): Promise<void> {
  try {
    const { status, unavailable } = await readBackupStatus();
    if (!status) {
      // The configuration is all an older daemon can say — printed as it was,
      // with the gap named rather than left to look like "all is well".
      const map: Record<string, string> = await invokeRpc('listSchedules');
      const entries = Object.entries(map || {});
      if (entries.length === 0) {
        log.info('No backup schedules configured');
        return;
      }
      log.info('Backup schedules:');
      for (const [target, cron] of entries) log.info(`  ${target.padEnd(28)} ${cron}`);
      log.warn(`When each last ran, and how that went: unknown — ${unavailable}`);
      return;
    }

    const schedules: any[] = status.schedules ?? [];
    if (schedules.length === 0) {
      log.info('No backup schedules configured');
      return;
    }
    // "all hourly" said what was configured, and nothing about whether it
    // ran: the master's hourly `all` lost `main` at 06:04Z with no line
    // saying so. Each schedule now carries its last pass and its outcome.
    log.info('Backup schedules:');
    for (const s of schedules) {
      const how = s.schedule ?? `UNREADABLE — ${s.error ?? 'not armed'}`;
      log.info(`  ${String(s.target).padEnd(10)} ${String(s.spec).padEnd(12)} ${how}${s.armed ? '' : '  (not armed)'}`);
      let line = `      last pass  ${describePass(s.lastPass)}`;
      // Before any pass was recorded, the index still knows when this target
      // last produced a backup — which is what its next run is measured from.
      if (!s.lastPass && s.lastBackupAt) {
        line += ` — newest backup ${formatUtc(s.lastBackupAt)}, ${formatAge(Date.now() - Date.parse(s.lastBackupAt))} ago`;
      }
      if (s.lastPass && s.lastPass.outcome !== 'ok') log.warn(line);
      else log.info(line);
      if (s.nextRunAt) {
        log.info(`      next run   ${formatUtc(s.nextRunAt)} (in ${formatAge(Date.parse(s.nextRunAt) - Date.now())})`);
      }
    }
    reportCoverage(status.stacks);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

export async function backupUnscheduleCommand(target: string): Promise<void> {
  try {
    await invokeRpc('removeSchedule', { database: target });
    log.success(`Removed backup schedule for '${target}'`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

export async function backupRestoreCommand(id: string): Promise<void> {
  try {
    // Resolved here as well as in the daemon, so the operator sees WHICH
    // backup a prefix named before anything is overwritten — and the daemon
    // is then handed the full id, which every daemon version accepts.
    const backups: any[] = await invokeRpc('listBackups');
    const target = resolveBackupId(
      backups,
      id,
      (b) => `${b.id} (${qualifiedName(b, b.database)}, ${formatUtc(b.createdAt)})`,
    );
    log.info(
      `Restoring ${target.id} — ${qualifiedName(target, target.database)}, taken ${formatUtc(target.createdAt)} (${target.filename})...`,
    );
    await invokeRpc('restoreBackup', { backupId: target.id });
    log.success('Backup restored successfully');
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}
