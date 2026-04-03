/**
 * Backup RPC Service
 *
 * Netron RPC endpoints for database backup management from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, ADMIN_ROLES } from '../shared/roles.js';
import type { BackupService, BackupInfo } from './backup.service.js';

@Service({ name: 'OmnitronBackups' })
export class BackupRpcService {
  constructor(private readonly backups: BackupService) {}

  @Public({ auth: { roles: ADMIN_ROLES } })
  async createBackup(data: { database: string; compress?: boolean }): Promise<BackupInfo> {
    return this.backups.createBackup(data.database, data.compress != null ? { compress: data.compress } : undefined);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listBackups(data?: { database?: string }): Promise<BackupInfo[]> {
    return this.backups.listBackups(data?.database);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async restoreBackup(data: { backupId: string }): Promise<{ success: boolean }> {
    await this.backups.restoreBackup(data.backupId);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async deleteBackup(data: { backupId: string }): Promise<{ success: boolean }> {
    await this.backups.deleteBackup(data.backupId);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async setSchedule(data: { database: string; cron: string }): Promise<{ success: boolean }> {
    await this.backups.setSchedule(data.database, data.cron);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getSchedule(data: { database: string }): Promise<string | null> {
    return this.backups.getSchedule(data.database);
  }
}
