/**
 * omnitron backup create [database] — Create database backup
 * omnitron backup list — List available backups
 * omnitron backup restore <id> — Restore from backup
 */

import { log } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

async function invokeRpc(method: string, data?: any): Promise<any> {
  const client = createDaemonClient();
  try {
    await (client as any).ensureConnected();
    const netron = (client as any).netron;
    const peers = netron.getPeers ? netron.getPeers() : [];
    for (const peer of peers) {
      try {
        const svc = await peer.queryInterface('OmnitronBackups');
        if (svc && typeof svc[method] === 'function') {
          return data ? await svc[method](data) : await svc[method]();
        }
      } catch {
        continue;
      }
    }
    throw new Error('OmnitronBackups service not available');
  } finally {
    await client.disconnect();
  }
}

export async function backupCreateCommand(database?: string): Promise<void> {
  const db = database || 'omnitron';
  try {
    log.info(`Creating backup for '${db}'...`);
    const backup: any = await invokeRpc('createBackup', { database: db, compress: true });
    const sizeMB = (backup.size / (1024 * 1024)).toFixed(2);
    log.success(`Backup created: ${backup.filename} (${sizeMB} MB)`);
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
      const sizeMB = (b.size / (1024 * 1024)).toFixed(2) + ' MB';
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

export async function backupRestoreCommand(id: string): Promise<void> {
  try {
    log.info(`Restoring backup '${id}'...`);
    await invokeRpc('restoreBackup', { backupId: id });
    log.success('Backup restored successfully');
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}
