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
import type { SyncService, SyncBatch, IngestBatchResult } from './sync.service.js';
export type { SyncBatch };
import type { ISyncStatus } from '../shared/dto/project.js';

@Service({ name: 'OmnitronSync' })
export class SyncRpcService {
  constructor(private readonly syncService: SyncService) {}

  /**
   * Receive a sync batch from a slave daemon.
   * Called over Netron TCP transport.
   *
   * Idempotent — and now actually so. The claim is enforced by a ledger
   * keyed on the slave's entry id, so a batch replayed after a lost
   * acknowledgement is recognised rather than ingested twice.
   */
  // `service_role` cannot be presented today: the daemon issues JWTs whose
  // role comes from `omnitron_users.role` (admin | operator | viewer), and
  // titan-auth only mints a service context from `validateApiKey()`, which
  // needs a `serviceKey` the daemon does not configure. It is left named
  // because this is one end of an unfinished cross-daemon path — the other
  // end, `SyncService.setMasterConnection()`, has no production caller
  // either — and removing it would erase the only statement of the intent.
  // Reachable in practice by admin and operator.
  @Public({ auth: { roles: ['admin', 'operator', 'service_role'] } })
  async receiveBatch(data: SyncBatch): Promise<IngestBatchResult> {
    return this.syncService.receiveBatch(data);
  }

  /**
   * Hand pending entries to the master — called by the master over TCP.
   *
   * Returns them without releasing them. The master calls `ackDrained` once
   * it holds them; until then a repeat call returns the same entries, which
   * is what keeps a failure between the two from losing data.
   */
  @Public({ auth: { roles: ['admin', 'operator', 'service_role'] } })
  async drainBuffer(data?: { limit?: number }): Promise<SyncBatch> {
    return this.syncService.drainBuffer(data?.limit);
  }

  /**
   * Release entries the master has confirmed it holds.
   */
  @Public({ auth: { roles: ['admin', 'operator', 'service_role'] } })
  async ackDrained(data: { ids: string[] }): Promise<{ released: number }> {
    return this.syncService.ackDrained(data?.ids ?? []);
  }

  /**
   * Get sync status (for webapp monitoring).
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getSyncStatus(): Promise<ISyncStatus> {
    return this.syncService.getStatus();
  }
}
