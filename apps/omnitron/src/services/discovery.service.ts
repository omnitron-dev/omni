/**
 * DiscoveryService — Auto-discover Docker containers and SSH-reachable hosts
 *
 * Wraps @xec-sh/ops Discovery for multi-source target discovery:
 * - Docker: containers with 'omnitron.managed=true' label
 * - SSH: hosts from fleet registry, probed on configurable port
 *
 * Falls back to basic Docker CLI + TCP probe when @xec-sh/ops is not installed.
 */

import type { FleetService } from './fleet.service.js';

// =============================================================================
// Types
// =============================================================================

export interface OmnitronDiscoveredTarget {
  id: string;
  type: 'docker' | 'ssh' | 'unknown';
  name: string;
  address: string;
  port: number;
  status: string;
  labels?: Record<string, string> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface DiscoveryScanResult {
  docker: OmnitronDiscoveredTarget[];
  ssh: OmnitronDiscoveredTarget[];
  timestamp: string;
  duration: number;
}

// =============================================================================
// @xec-sh/ops integration — loaded dynamically
// =============================================================================

import { loadXecOps } from '../shared/xec-loader.js';

type XecDiscoveredTarget = import('@xec-sh/ops').DiscoveredTarget;

/**
 * Map xec DiscoveredTarget to our OmnitronDiscoveredTarget.
 */
function mapXecTarget(t: XecDiscoveredTarget, defaultType: 'docker' | 'ssh'): OmnitronDiscoveredTarget {
  const type: OmnitronDiscoveredTarget['type'] =
    t.type === 'docker' ? 'docker' : t.type === 'ssh' ? 'ssh' : defaultType;
  return {
    id: t.id,
    type,
    name: t.container ?? t.host ?? t.id,
    address: t.host ?? 'localhost',
    port: t.port ?? 0,
    status: 'discovered',
    ...(t.labels ? { labels: t.labels } : {}),
    ...(t.meta ? { metadata: t.meta } : {}),
  };
}

// =============================================================================
// Fallback discovery (when @xec-sh/ops is not available)
// =============================================================================

/**
 * Discover Docker containers with omnitron labels via Docker CLI.
 */
async function fallbackDockerDiscovery(): Promise<OmnitronDiscoveredTarget[]> {
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync(
      'docker ps --filter "label=omnitron.managed=true" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
      { encoding: 'utf-8', timeout: 10_000 }
    ).trim();

    if (!output) return [];

    return output.split('\n').map((line) => {
      const [id = '', name = '', status = '', ports = ''] = line.split('\t');
      // Extract first host port from ports string (e.g., "0.0.0.0:5432->5432/tcp")
      const portMatch = ports.match(/:(\d+)->/);
      return {
        id: id.slice(0, 12),
        type: 'docker' as const,
        name,
        address: 'localhost',
        port: portMatch ? parseInt(portMatch[1]!, 10) : 0,
        status: status.includes('Up') ? 'running' : 'stopped',
        labels: { 'omnitron.managed': 'true' },
      };
    });
  } catch {
    return [];
  }
}

/**
 * Probe SSH-reachable hosts via basic TCP connection.
 */
async function fallbackSshDiscovery(hosts: string[], port = 9700, timeout = 3000): Promise<OmnitronDiscoveredTarget[]> {
  const net = await import('node:net');
  const results: OmnitronDiscoveredTarget[] = [];

  await Promise.allSettled(
    hosts.map(async (host) => {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection({ host, port }, () => {
            socket.destroy();
            resolve();
          });
          socket.setTimeout(timeout);
          socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
          socket.on('error', reject);
        });
        results.push({
          id: `ssh-${host}:${port}`,
          type: 'ssh',
          name: host,
          address: host,
          port,
          status: 'reachable',
        });
      } catch {
        results.push({
          id: `ssh-${host}:${port}`,
          type: 'ssh',
          name: host,
          address: host,
          port,
          status: 'unreachable',
        });
      }
    })
  );

  return results;
}

// =============================================================================
// Service
// =============================================================================

export class DiscoveryService {
  constructor(
    private readonly fleetService: FleetService
  ) {}

  /**
   * Discover all Omnitron-managed Docker containers.
   */
  async discoverContainers(): Promise<OmnitronDiscoveredTarget[]> {
    const xec = await loadXecOps();

    if (xec) {
      const discovery = xec.Discovery.create().docker({
        label: 'omnitron.managed=true',
        status: 'running',
      });
      const results = await discovery.scan();
      return results.map((r) => mapXecTarget(r, 'docker'));
    }

    return fallbackDockerDiscovery();
  }

  /**
   * Discover SSH-reachable hosts from fleet registry.
   */
  async discoverNodes(hosts: string[]): Promise<OmnitronDiscoveredTarget[]> {
    if (hosts.length === 0) return [];

    const xec = await loadXecOps();

    if (xec) {
      const discovery = xec.Discovery.create().ssh({
        hosts,
        port: 9700,
        timeout: 3000,
      });
      const results = await discovery.scan();
      return results.map((r) => mapXecTarget(r, 'ssh'));
    }

    return fallbackSshDiscovery(hosts);
  }

  /**
   * Full scan: Docker containers + registered fleet nodes.
   */
  async scanAll(): Promise<DiscoveryScanResult> {
    const start = Date.now();
    const xec = await loadXecOps();

    if (xec) {
      const discovery = xec.Discovery.create().docker({
        label: 'omnitron.managed=true',
      });

      // Add SSH hosts from fleet registry
      const nodes = await this.fleetService.listNodes();
      if (nodes.length > 0) {
        discovery.ssh({
          hosts: nodes.map((n) => n.address),
          port: 9700,
        });
      }

      const grouped = await discovery.scanGrouped();
      const docker = (grouped['docker'] ?? []).map((r) => mapXecTarget(r, 'docker'));
      const ssh = (grouped['ssh'] ?? []).map((r) => mapXecTarget(r, 'ssh'));

      return { docker, ssh, timestamp: new Date().toISOString(), duration: Date.now() - start };
    }

    // Fallback: parallel Docker + SSH discovery
    const nodes = await this.fleetService.listNodes();
    const [docker, ssh] = await Promise.all([
      fallbackDockerDiscovery(),
      fallbackSshDiscovery(nodes.map((n) => n.address)),
    ]);

    return {
      docker,
      ssh,
      timestamp: new Date().toISOString(),
      duration: Date.now() - start,
    };
  }
}

