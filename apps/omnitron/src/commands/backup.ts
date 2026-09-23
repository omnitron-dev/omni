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
      for (const r of results) {
        if (r.ok) log.success(`  ✓ ${r.database} — ${formatBackupSize(r.size)} [${r.id.slice(0, 8)}]`);
        else log.error(`  ✗ ${r.database}: ${r.error}`);
      }
      const ok = results.filter((r) => r.ok).length;
      log.info(`Done: ${ok}/${results.length} database(s) backed up`);
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
      b.database,
      formatBackupSize(b.size),
      // UTC, as the filenames are — see `formatUtc`.
      formatUtc(b.createdAt),
      b.filename,
    ]);
    for (const line of renderTable(['ID', 'Database', 'Size', 'Created (UTC)', 'File'], rows)) log.info(line);
    log.info('\nRestore one with: omnitron backup restore <ID>');

    // A pass that lost a database leaves a listing that looks complete — the
    // missing row is the only trace. Say so here, where people look.
    const { status, unavailable } = await readBackupStatus();
    if (!status) {
      log.warn(`Last pass of each schedule: unknown — ${unavailable}`);
      return;
    }
    for (const s of status.schedules ?? []) {
      if (s.lastPass && s.lastPass.outcome !== 'ok') {
        log.warn(`Last '${s.target}' pass: ${describePass(s.lastPass)}`);
      }
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
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
    log.info('Creating FULL backup (all DBs + storage + tor keys + daemon-state)...');
    const results: any[] = await invokeRpc('createFullBackup');
    if (!results || results.length === 0) {
      log.warn('Nothing to back up — is a stack running?');
      return;
    }
    for (const r of results) {
      if (r.ok) log.success(`  ✓ ${r.target} — ${formatBackupSize(r.size ?? 0)} [${(r.id || '').slice(0, 8)}]`);
      else log.error(`  ✗ ${r.target}: ${r.error}`);
    }
    const ok = results.filter((r) => r.ok).length;
    log.info(`Done: ${ok}/${results.length} target(s) backed up`);
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
      const line = `      last pass  ${describePass(s.lastPass)}`;
      if (s.lastPass && s.lastPass.outcome !== 'ok') log.warn(line);
      else log.info(line);
    }
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
      (b) => `${b.id} (${b.database}, ${formatUtc(b.createdAt)})`,
    );
    log.info(`Restoring ${target.id} — ${target.database}, taken ${formatUtc(target.createdAt)} (${target.filename})...`);
    await invokeRpc('restoreBackup', { backupId: target.id });
    log.success('Backup restored successfully');
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}
