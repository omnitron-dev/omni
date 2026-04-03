/**
 * Discovery RPC Service
 *
 * Netron RPC endpoints for auto-discovery of Docker containers and SSH hosts.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type { DiscoveryService, OmnitronDiscoveredTarget, DiscoveryScanResult } from './discovery.service.js';

@Service({ name: 'OmnitronDiscovery' })
export class DiscoveryRpcService {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async discoverContainers(): Promise<OmnitronDiscoveredTarget[]> {
    return this.discovery.discoverContainers();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async discoverNodes(data: { hosts: string[] }): Promise<OmnitronDiscoveredTarget[]> {
    return this.discovery.discoverNodes(data.hosts);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async scanAll(): Promise<DiscoveryScanResult> {
    return this.discovery.scanAll();
  }
}
