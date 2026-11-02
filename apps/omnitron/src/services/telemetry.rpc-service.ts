import { Service, Public } from '@omnitron-dev/titan/decorators';
import { CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import type { TelemetryRelayService } from '@omnitron-dev/titan-telemetry-relay';

@Service({ name: 'OmnitronTelemetry' })
export class TelemetryRpcService {
  constructor(private readonly relay: TelemetryRelayService) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getRelayStats(): Promise<ReturnType<TelemetryRelayService['stats']>> {
    return this.relay.stats();
  }
}
