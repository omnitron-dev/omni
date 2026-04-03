/**
 * SyncRpcService — Netron RPC endpoints for slave→master data sync
 *
 * Master exposes:
 *   - receiveBatch: accepts sync batches from slaves (idempotent)
 *   - getSyncStatus: returns sync status for monitoring
 *
 * Slaves call receiveBatch via Netron TCP transport.
 * TCP transport is auth-free (fleet assumes network-level security via WireGuard).
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type { SyncService, SyncBatch } from './sync.service.js';
export type { SyncBatch };
import type { ISyncStatus } from '../shared/dto/project.js';

@Service({ name: 'OmnitronSync' })
export class SyncRpcService {
  constructor(private readonly syncService: SyncService) {}

  /**
   * Receive a sync batch from a slave daemon.
   * Called over Netron TCP transport.
   * Idempotent — safe to retry on network failure.
   */
  @Public({ auth: { roles: ['admin', 'operator', 'service_role'] } })
  async receiveBatch(data: SyncBatch): Promise<{ accepted: number }> {
    return this.syncService.receiveBatch(data);
  }

  /**
   * Drain buffered sync entries — called by master over TCP.
   * Returns pending entries and marks them as synced atomically.
   */
  @Public({ auth: { roles: ['admin', 'operator', 'service_role'] } })
  async drainBuffer(data?: { limit?: number }): Promise<SyncBatch> {
    return this.syncService.drainBuffer(data?.limit);
  }

  /**
   * Get sync status (for webapp monitoring).
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getSyncStatus(): Promise<ISyncStatus> {
    return this.syncService.getStatus();
  }
}
