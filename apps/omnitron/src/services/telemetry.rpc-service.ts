import { Service, Public } from '@omnitron-dev/titan/decorators';
import { CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import type { TelemetryRelayService } from '@omnitron-dev/titan-telemetry-relay';
import type { TelemetryRelayObservation } from '../shared/dto/nodes.js';

@Service({ name: 'OmnitronTelemetry' })
export class TelemetryRpcService {
  constructor(private readonly relay: TelemetryRelayService | null) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getRelayStats(): Promise<TelemetryRelayObservation> {
    return this.relay
      ? { state: 'active', stats: this.relay.stats() }
      : { state: 'not-applicable', reason: 'worker-uses-durable-replication' };
  }
}
