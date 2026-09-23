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
    const map: Record<string, string> = await invokeRpc('listSchedules');
    const entries = Object.entries(map || {});
    if (entries.length === 0) {
      log.info('No backup schedules configured');
      return;
    }
    log.info('Backup schedules:');
    for (const [target, cron] of entries) log.info(`  ${target.padEnd(28)} ${cron}`);
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
