/**
 * Backup RPC Service
 *
 * Netron RPC endpoints for database backup management from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, ADMIN_ROLES } from '../shared/roles.js';
import type { BackupService, BackupInfo, BackupStatus } from './backup.service.js';

import type { IOmnitronBackupsService } from '../shared/dto/services.js';
import type { BackupArtifactRequest, BackupRecord } from '../shared/dto/backups.js';
import type { OperationReceipt } from '../shared/dto/execution-operations.js';
import { daemonPrincipal } from './daemon-principal.js';
import type { AuthService } from './auth.service.js';

@Service({ name: 'OmnitronBackups' })
export class BackupRpcService implements IOmnitronBackupsService {
  constructor(private readonly backups: BackupService, private readonly auth: Pick<AuthService, 'validateSession'> | null) {}

  @Public({ auth: { roles: ADMIN_ROLES } })
  async createBackup(data: { database: string; compress?: boolean; operationId?: string }): Promise<BackupInfo> {
    return this.backups.createBackup(data.database, {
      ...(data.compress !== undefined && { compress: data.compress }),
      ...(data.operationId !== undefined && { operationId: data.operationId }),
    });
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async createArtifactBackup(data: BackupArtifactRequest): Promise<BackupRecord> {
    return this.backups.createArtifactBackup(data);
  }

  /** Back up every database of every running stack. */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async createAllBackups(): Promise<Array<{ database: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    return this.backups.createAllBackups();
  }

  /** Full backup: all stack DBs + minio storage + tor keys + daemon-state. */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async createFullBackup(): Promise<Array<{ target: string; ok: boolean; id?: string; size?: number; error?: string }>> {
    return this.backups.createFullBackup();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listBackups(data?: { database?: string }): Promise<BackupInfo[]> {
    return this.backups.listBackups(data?.database);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async restoreBackup(data: { backupId: string; operationId?: string }): Promise<{ success: boolean }> {
    await this.backups.restoreBackup(data.backupId, data.operationId);
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

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listSchedules(): Promise<Record<string, string>> {
    return this.backups.listSchedules();
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async removeSchedule(data: { database: string }): Promise<{ success: boolean }> {
    await this.backups.removeSchedule(data.database);
    return { success: true };
  }

  /**
   * Each schedule's last pass and next run, and which stacks this host backs
   * up at all. `backup schedules` and `backup list` printed «unknown» in their
   * place: the service computed it and no call reached it.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getBackupStatus(): Promise<BackupStatus> {
    return this.backups.getStatus();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listOperations(): Promise<OperationReceipt[]> { return this.backups.listOperations(true); }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getOperation(data: { id: string }): Promise<OperationReceipt | null> { return this.backups.getOperation(data.id); }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async cancelOperation(data: { id: string; revision: number }): Promise<OperationReceipt> {
    return this.backups.cancelOperation(data.id, data.revision);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async reconcileOperation(data: { id: string; revision: number }): Promise<OperationReceipt> {
    return this.backups.reconcileOperation(data.id, data.revision);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async acknowledgeUnknownBackup(data: { id: string; revision: number; reason: string }): Promise<OperationReceipt> {
    // A node without a session store can admit only the existing local UDS
    // principal; a remote human session cannot be authenticated there.
    const actor = await daemonPrincipal(this.auth ?? { validateSession: async () => null }, 'admin');
    return this.backups.acknowledgeUnknownBackup(data.id, data.revision, actor.context.userId!, data.reason);
  }
}
