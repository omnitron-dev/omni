/**
 * omnitron discover — what Omnitron manages: this machine's containers, and
 * the registered nodes with how each one is reached.
 *
 * Measured 2026-09-23 on the master, every field of the old output was one
 * nothing had measured:
 *
 *   - all twelve containers `discovered` (in red, in a TTY), `PORT 0`, id
 *     `docker:daos-` — the service filled state and port with constants and
 *     this cut the synthetic id `docker:<name>` to twelve characters;
 *   - «SSH Nodes» listed `127.0.0.1:9700` — the master itself, from the
 *     control-plane table — and not daos-test, the one remote node, because
 *     an unreachable probe was dropped rather than reported;
 *   - it compared against `running` and `reachable`, values that never
 *     arrived, so every row was red;
 *   - both tables printed before the box that was meant to hold them, under
 *     their own headers;
 *   - the empty case sent the operator to `omnitron remote add`, a registry
 *     this command does not read.
 *
 * Now the containers carry their real state, health and published ports,
 * and the nodes come from the node registry — the one `node list` and the
 * console read — with the mesh's account of how each is reached.
 */

import { log, prism, table } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { listManagedContainers } from '../infrastructure/container-runtime.js';
import { containerTarget } from '../services/discovery.service.js';
import type { OmnitronDiscoveredTarget } from '../shared/dto/discovery.js';
import type { IOmnitronDiscoveryService, IOmnitronNodesService } from '../shared/dto/services.js';
import type { IMeshNodeStatus, INodeWithStatus } from '../shared/dto/nodes.js';
import { describeAbsence } from './daemon-required.js';
import { formatCheckedAt, formatDaemon } from './node.js';

/** A container's state in the colour it deserves — green only for running. */
function colourState(state: string): string {
  if (state === 'running') return prism.green(state);
  if (state === 'exited' || state === 'dead') return prism.red(state);
  return prism.yellow(state);
}

function colourHealth(health: string): string {
  if (health === 'healthy') return prism.green(health);
  if (health === 'unhealthy') return prism.red(health);
  if (health === 'starting') return prism.yellow(health);
  return prism.dim('-');
}

/** Published ports as `host→container/proto`, or `-` when there are none. */
function formatPorts(ports: unknown): string {
  const entries = Object.entries((ports ?? {}) as Record<string, number>);
  return entries.length > 0 ? entries.map(([inner, host]) => `${host}→${inner}`).join(', ') : '-';
}

export function printContainers(containers: readonly OmnitronDiscoveredTarget[]): void {
  if (containers.length === 0) {
    log.info(prism.dim('No Omnitron-managed containers on this machine (label omnitron.managed=true).'));
    return;
  }
  log.info(prism.bold(`Containers on this machine (${containers.length})`));
  table({
    width: 'auto',
    data: containers.map((t) => {
      const project = t.labels?.['omnitron.project'];
      const stack = t.labels?.['omnitron.stack'];
      return {
        name: t.name,
        stack: project && stack ? `${project}/${stack}` : '-',
        state: colourState(t.status),
        health: colourHealth(String(t.metadata?.['health'] ?? 'none')),
        ports: formatPorts(t.metadata?.['ports']),
        id: t.id.slice(0, 12),
      };
    }),
    columns: [
      { key: 'name', header: 'NAME' },
      { key: 'stack', header: 'STACK' },
      { key: 'state', header: 'STATE' },
      { key: 'health', header: 'HEALTH' },
      { key: 'ports', header: 'PUBLISHED' },
      { key: 'id', header: 'ID' },
    ],
  });
}

/** How the master's mesh reaches a node, in words, in the colour it deserves. */
function describeReach(mesh: IMeshNodeStatus | undefined): string {
  if (!mesh || !mesh.inMesh) return prism.dim('not in the mesh');
  const via = mesh.via ? ` via ${mesh.via}` : '';
  if (mesh.status === 'connected') {
    return mesh.authenticated
      ? prism.green(`mesh${via}, authenticated`)
      : prism.yellow(`mesh${via}, NOT authenticated — pings only, no data`);
  }
  if (mesh.status === 'error') return prism.red(`mesh error${mesh.lastError ? `: ${mesh.lastError}` : ''}`);
  return prism.yellow(`mesh ${mesh.status}${via}`);
}

export function printNodes(nodes: readonly INodeWithStatus[], mesh: readonly IMeshNodeStatus[]): void {
  // The local node is this machine — the one doing the discovering.
  const remote = nodes.filter((n) => !n.isLocal);
  if (remote.length === 0) {
    log.info(
      prism.dim(
        'No remote nodes registered. Add one with `omnitron node add` (the console\'s Nodes page uses the same registry).',
      ),
    );
    return;
  }
  const byId = new Map(mesh.map((m) => [m.nodeId, m]));
  log.info(prism.bold(`Registered nodes (${remote.length})`));
  table({
    width: 'auto',
    data: remote.map((n) => {
      const m = byId.get(n.id);
      return {
        name: n.name,
        address: `${n.host}:${n.daemonPort}`,
        reached: describeReach(m),
        heartbeat: m?.lastHeartbeat ? formatCheckedAt(new Date(m.lastHeartbeat).toISOString()) : '-',
        daemon: `${formatDaemon(n.status)}, checked ${formatCheckedAt(n.status?.checkedAt)}`,
      };
    }),
    columns: [
      { key: 'name', header: 'NODE' },
      { key: 'address', header: 'DAEMON ADDRESS' },
      { key: 'reached', header: 'REACHED' },
      { key: 'heartbeat', header: 'HEARTBEAT' },
      { key: 'daemon', header: 'LAST CHECK' },
    ],
  });
}

export async function discoverCommand(): Promise<void> {
  const client = createDaemonClient();

  const absence = await client.whyUnreachable();
  if (absence) {
    // Offline mode: this machine's containers are still readable without the
    // daemon; the registered nodes live in its registry and are not.
    log.warn(`${describeAbsence(absence)} — listing this machine's containers only; registered nodes need the daemon`);
    await localContainerDiscovery();
    await client.disconnect();
    return;
  }

  try {
    const started = Date.now();
    // Call the daemon-exposed peer services directly. (`exec` routes to an
    // *app* handle via getHandle(name); '__daemon__' is not an app, so it
    // 404s — the daemon's own services are reached with service().)
    const discovery = await client.service<IOmnitronDiscoveryService>('OmnitronDiscovery');
    const nodesService = await client.service<IOmnitronNodesService>('OmnitronNodes');
    const [containers, nodes, mesh] = await Promise.all([
      discovery.discoverContainers(),
      nodesService.listNodes(),
      nodesService.getMeshStatus(),
    ]);

    printContainers(containers);
    log.info('');
    printNodes(nodes, mesh);
    log.info(prism.dim(`Scanned in ${Date.now() - started}ms`));
  } catch (err) {
    log.warn(`RPC discovery unavailable: ${(err as Error).message}`);
    log.info('Falling back to local container discovery');
    await localContainerDiscovery();
  } finally {
    await client.disconnect();
  }
}

/**
 * This machine's containers, read without the daemon — through the same
 * runtime call the daemon makes, so the two outputs are the same shape.
 */
async function localContainerDiscovery(): Promise<void> {
  try {
    printContainers((await listManagedContainers({ orThrow: true })).map(containerTarget));
  } catch (err) {
    log.error(`Docker is not available or not running: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
