/** Worker outbox operations invoked by the mesh controller. */
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import type { SyncService, SyncBatch } from './sync.service.js';
export type { SyncBatch };
import type { ISyncStatus } from '../shared/dto/project.js';
import type { ReplicationReceipt } from './replication-evidence.js';
import type { ReconciliationProof } from './replication-reconciliation.js';

@Service({ name: 'OmnitronSync' })
export class SyncRpcService {
  constructor(private readonly syncService: SyncService) {}

  /**
   * Hand pending entries to the master — called by the master over TCP.
   *
   * Returns them without releasing them. The master calls `ackDrained` once
   * it holds them; until then a repeat call returns the same entries, which
   * is what keeps a failure between the two from losing data.
   */
  @Public({ auth: { roles: ['admin', 'service_role'] } })
  async drainBuffer(data?: { limit?: number }): Promise<SyncBatch> {
    return this.syncService.drainBuffer(data?.limit);
  }

  /**
   * Release entries the master has confirmed it holds.
   */
  @Public({ auth: { roles: ['service_role'] } })
  async ackDrained(data: { ids: string[]; receipt?: ReplicationReceipt }): Promise<{ released: number }> {
    return this.syncService.ackDrained(data?.ids ?? [], data?.receipt);
  }

  /** Administrative recovery reads only released, retained metrics, in bounded pages. */
  @Public({ auth: { roles: ['admin', 'service_role'] } })
  readUnverifiedMetrics(data?: { after?: string; through?: string; epoch?: string; limit?: number }) {
    return this.syncService.readUnverifiedMetrics(data);
  }

  /** A separate, payload-bound proof settles history without rewriting the original receipt. */
  @Public({ auth: { roles: ['service_role'] } })
  acknowledgeReconciliation(data: { proofs: ReconciliationProof[] }) {
    return this.syncService.acknowledgeReconciliation(data.proofs);
  }

  /**
   * Get sync status (for webapp monitoring).
   */
  // Read BY the master, not only about it: the master pulls this on every
  // heartbeat to fill the «Sync» column and the stack's backlog figure. It
  // reaches the node with `service_role`, which `VIEWER_ROLES` — the human
  // hierarchy — does not contain, so the node accepted `drainBuffer` from
  // this very credential and refused the read beside it.
  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getSyncStatus(): Promise<ISyncStatus> {
    return this.syncService.getStatus();
  }
}
