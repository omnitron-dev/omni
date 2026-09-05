/**
 * omnitron backup create [database] — Create database backup
 * omnitron backup list — List available backups
 * omnitron backup restore <id> — Restore from backup
 */

import { log } from '@xec-sh/kit';
import { formatBackupSize } from '../services/backup-pipeline.js';
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
    const header = ['Database', 'Filename', 'Size', 'Created'].map((h) => h.padEnd(25)).join('');
    log.info(header);
    log.info('-'.repeat(100));

    for (const b of backups) {
      const sizeMB = formatBackupSize(b.size);
      const created = new Date(b.createdAt).toLocaleString();
      log.info([
        b.database.padEnd(25),
        b.filename.slice(0, 24).padEnd(25),
        sizeMB.padEnd(25),
        created.padEnd(25),
      ].join(''));
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
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
    log.success(`Scheduled backup of '${target}' every '${cron}'`);
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
    log.info(`Restoring backup '${id}'...`);
    await invokeRpc('restoreBackup', { backupId: id });
    log.success('Backup restored successfully');
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}
