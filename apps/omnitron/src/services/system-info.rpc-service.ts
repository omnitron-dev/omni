/**
 * SystemInfoRpcService — OmnitronSystemInfo Netron RPC
 *
 * Exposes real-time system metrics to webapp /system page.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type { SystemInfoService, SystemSnapshot } from './system-info.service.js';

@Service({ name: 'OmnitronSystemInfo' })
export class SystemInfoRpcService {
  constructor(private readonly systemInfo: SystemInfoService) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getSnapshot(): Promise<SystemSnapshot> {
    return this.systemInfo.getSnapshot();
  }
}
