/**
 * Telemetry RPC Service
 *
 * Netron RPC endpoints for:
 * 1. Follower → Leader telemetry push (receive batches)
 * 2. Webapp → Leader telemetry stats (relay health)
 */

import { requireArray, requirePayload, requireString } from './anonymous-input.js';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
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
    const payload = requirePayload(data, 'pushBatch');
    const nodeId = requireString(payload, 'nodeId', 'pushBatch');
    const entries = requireArray(payload, 'entries', 'pushBatch') as TelemetryEntry[];
    const ackd = await this.relay.receive(nodeId, entries);
    return { ackd };
  }

  /**
   * Get relay stats for monitoring dashboard.
   */
  // Same read, same principal: `getNodeRelayStats` asks each node for this,
  // and `totalDropped` is the one counter in the fleet that reports LOSS.
  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getRelayStats(): Promise<ReturnType<TelemetryRelayService['stats']>> {
    return this.relay.stats();
  }
}
