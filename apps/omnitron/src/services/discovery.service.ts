/**
 * DiscoveryService — Omnitron-managed Docker containers on this machine, and
 * the control-plane members answering on their fleet port.
 *
 * The containers are read the way `omnitron infra status` and
 * `OmnitronInfra.listContainers` read them — `listManagedContainers`, one
 * `docker inspect` of everything labelled `omnitron.managed=true` — so the
 * three cannot disagree. This used to go through `@xec-sh/ops` Discovery,
 * whose docker scan returns neither a state nor a port, and the mapping
 * filled the gaps with constants: measured 2026-09-23, all twelve containers
 * on the master came back `status: 'discovered'` and `port: 0`, with ids
 * `docker:<name>` that the CLI cut to `docker:daos-`.
 *
 * `ssh` is a TCP probe of each control-plane member's fleet port — the PG
 * membership table, not the node registry — and it reports every member,
 * answering or not. The xec probe dropped a host that did not answer, so an
 * unreachable member vanished from the scan instead of reading unreachable.
 * The CLI lists registered nodes from the node registry and the mesh, which
 * say how each one is actually reached.
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { FLEET_SERVICE_TOKEN } from '../shared/tokens.js';
import type { FleetService } from './fleet.service.js';
import { listManagedContainers } from '../infrastructure/container-runtime.js';
import type { ContainerState } from '../infrastructure/types.js';

// =============================================================================
// Types
// =============================================================================

export type {
  OmnitronDiscoveredTarget,
  DiscoveryScanResult,
} from '../shared/dto/discovery.js';

import type {
  OmnitronDiscoveredTarget,
  DiscoveryScanResult,
} from '../shared/dto/discovery.js';

// =============================================================================
// Containers
// =============================================================================

/**
 * A managed container as discovery reports it.
 *
 * `status` is the container's own state — `running`, `exited`, `restarting`
 * and the rest — and `metadata.ports` every port it publishes, `"5432/tcp"
 * → 5432`. `port` is the first of those, or 0 when it publishes none: the
 * wire type is a number, so read `metadata.ports` to tell «none» from a port.
 */
export function containerTarget(c: ContainerState): OmnitronDiscoveredTarget {
  const ports = c.ports ?? {};
  const labels: Record<string, string> = { 'omnitron.managed': 'true' };
  if (c.service) labels['omnitron.service'] = c.service;
  if (c.project) labels['omnitron.project'] = c.project;
  if (c.stack) labels['omnitron.stack'] = c.stack;
  return {
    id: c.containerId ?? c.name,
    type: 'docker',
    name: c.name,
    address: 'localhost',
    port: Object.values(ports)[0] ?? 0,
    status: c.status,
    labels,
    metadata: {
      image: c.image,
      health: c.health ?? 'none',
      ports,
      ...(c.error ? { error: c.error } : {}),
    },
  };
}

// =============================================================================
// Fleet-port probe
// =============================================================================

/** Whether each host accepts a TCP connection on its port — all of them reported. */
async function probeHosts(
  hosts: ReadonlyArray<{ host: string; port: number; name?: string; metadata?: Record<string, unknown> }>,
  timeout = 3000,
): Promise<OmnitronDiscoveredTarget[]> {
  const net = await import('node:net');
  return Promise.all(
    hosts.map(async ({ host, port, name, metadata }) => {
      const error = await new Promise<string | null>((resolve) => {
        const socket = net.createConnection({ host, port }, () => {
          socket.destroy();
          resolve(null);
        });
        socket.setTimeout(timeout);
        socket.on('timeout', () => {
          socket.destroy();
          resolve(`no answer within ${timeout}ms`);
        });
        socket.on('error', (err) => resolve(err.message));
      });
      return {
        id: `tcp:${host}:${port}`,
        type: 'ssh' as const,
        name: name ?? host,
        address: host,
        port,
        status: error ? 'unreachable' : 'reachable',
        metadata: { probe: `tcp ${port}`, ...(error ? { error } : {}), ...(metadata ?? {}) },
      };
    }),
  );
}

// =============================================================================
// Service
// =============================================================================

@Injectable()
export class DiscoveryService {
  // T-2 — @Inject decorator pins the DI token to the param position;
  // the framework reads metadata directly so no inject:[] array can
  // drift out of sync with constructor order.
  constructor(
    @Inject(FLEET_SERVICE_TOKEN) private readonly fleetService: FleetService
  ) {}

  /** Every Omnitron-managed container on this machine, running or not. */
  async discoverContainers(): Promise<OmnitronDiscoveredTarget[]> {
    return (await listManagedContainers()).map(containerTarget);
  }

  /** Whether each host answers on the default fleet port. */
  async discoverNodes(hosts: string[]): Promise<OmnitronDiscoveredTarget[]> {
    if (hosts.length === 0) return [];
    return probeHosts(hosts.map((host) => ({ host, port: 9700 })));
  }

  /**
   * Full scan: this machine's containers, and each control-plane member
   * probed on the port it registered with.
   */
  async scanAll(): Promise<DiscoveryScanResult> {
    const start = Date.now();
    const members = await this.fleetService.listNodes();
    const [docker, ssh] = await Promise.all([
      this.discoverContainers(),
      probeHosts(
        members.map((m) => ({
          host: m.address,
          port: m.port ?? 9700,
          name: m.hostname,
          metadata: { source: 'control-plane', role: m.role },
        })),
      ),
    ]);

    return {
      docker,
      ssh,
      timestamp: new Date().toISOString(),
      duration: Date.now() - start,
    };
  }
}
