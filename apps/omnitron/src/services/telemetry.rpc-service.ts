/**
 * Telemetry RPC Service
 *
 * Netron RPC endpoints for:
 * 1. Follower → Leader telemetry push (receive batches)
 * 2. Webapp → Leader telemetry stats (relay health)
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type { TelemetryRelayService, TelemetryEntry } from '@omnitron-dev/titan-telemetry-relay';

@Service({ name: 'OmnitronTelemetry' })
export class TelemetryRpcService {
  constructor(private readonly relay: TelemetryRelayService) {}

  /**
   * Receive telemetry batch from a follower node.
   * Called by remote omnitron daemons via Netron TCP.
   */
  @Public({ auth: { allowAnonymous: true } })
  async pushBatch(data: { nodeId: string; entries: TelemetryEntry[] }): Promise<{ ackd: number }> {
    const ackd = await this.relay.receive(data.nodeId, data.entries);
    return { ackd };
  }

  /**
   * Get relay stats for monitoring dashboard.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getRelayStats(): Promise<ReturnType<TelemetryRelayService['stats']>> {
    return this.relay.stats();
  }
}
