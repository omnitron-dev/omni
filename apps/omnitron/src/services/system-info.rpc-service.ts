/**
 * SystemInfoRpcService — OmnitronSystemInfo Netron RPC
 *
 * Exposes real-time system metrics to webapp /system page.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import type { SystemInfoService, SystemSnapshot } from './system-info.service.js';

import type { IOmnitronSystemInfoService } from '../shared/dto/services.js';

@Service({ name: 'OmnitronSystemInfo' })
export class SystemInfoRpcService implements IOmnitronSystemInfoService {
  constructor(private readonly systemInfo: SystemInfoService) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getSnapshot(options?: { fresh?: boolean }): Promise<SystemSnapshot> {
    return this.systemInfo.getSnapshot(options);
  }
}
