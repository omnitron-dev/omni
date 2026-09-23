/**
 * omnitron cluster status|step-down — Cluster management commands
 *
 * Communicates with the daemon via Unix socket RPC to query
 * cluster state and issue control commands.
 */

import { log, table, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronFleetService } from '../shared/dto/services.js';
import type { ClusterRpcService } from '../cluster/cluster.rpc-service.js';

type DaemonClient = ReturnType<typeof createDaemonClient>;

/** The two calls this file makes, typed by the service that answers them. */
type ClusterRpc = Pick<ClusterRpcService, 'getClusterState' | 'stepDown'>;

export async function clusterStatusCommand(): Promise<void> {
  const client = createDaemonClient();

  try {
    const cluster = await clusterService(client);
    if (!cluster) {
      // An answer, not a failure: the question was what the cluster looks
      // like, and on this daemon there is none.
      reportClusterOff();
      return;
    }

    const state = await cluster.getClusterState();

    log.info(`${prism.bold('Cluster State')}`);
    log.info(`  Node ID:    ${state.nodeId}`);
    log.info(`  State:      ${formatElectionState(state.state)}`);
    log.info(`  Term:       ${state.term}`);
    log.info(`  Leader:     ${state.leaderId ?? prism.dim('none')}`);
    log.info(`  Voted For:  ${state.votedFor ?? prism.dim('none')}`);
    log.info(`  Uptime:     ${formatDuration(state.uptime)}`);

    // Also show fleet nodes for context
    try {
      const fleet = await client.service<IOmnitronFleetService>('OmnitronFleet');
      const fleetSummary = await fleet.getSummary();
      log.info('');
      log.info(`${prism.bold('Fleet Nodes')} (${fleetSummary.onlineNodes}/${fleetSummary.totalNodes} online)`);

      if (fleetSummary.nodes.length > 0) {
        table({
          width: 'auto',
          data: fleetSummary.nodes.map((n) => ({
            id: n.id.slice(0, 8),
            hostname: n.hostname,
            address: `${n.address}:${n.port}`,
            role: formatRole(n.role),
            status: formatNodeStatus(n.status),
          })),
          columns: [
            { key: 'id', header: 'ID' },
            { key: 'hostname', header: 'HOSTNAME' },
            { key: 'address', header: 'ADDRESS' },
            { key: 'role', header: 'ROLE' },
            { key: 'status', header: 'STATUS' },
          ],
        });
      }
    } catch (err) {
      // The cluster state above still stands. This catch was empty, and
      // the fleet table simply did not appear — which reads as a fleet of
      // nobody rather than a question that went unanswered.
      log.warn(`Fleet nodes not shown: ${(err as Error).message}`);
    }
  } catch (err) {
    log.error(`Failed to get cluster status: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

export async function clusterStepDownCommand(): Promise<void> {
  const client = createDaemonClient();

  try {
    const cluster = await clusterService(client);
    if (!cluster) {
      reportClusterOff();
      // A step-down asked of a daemon with no election deposed nobody.
      process.exitCode = 1;
      return;
    }

    const result = await cluster.stepDown();

    if (result.success) {
      log.success(result.message);
    } else {
      // «This node is not the leader»: refused, nothing changed.
      log.warn(result.message);
      process.exitCode = 1;
    }
  } catch (err) {
    log.error(`Failed to step down: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * The daemon's cluster service, or `null` when this daemon runs none.
 *
 * Through `client.service()`, as every other command reaches a service. This
 * used to walk `client['netron'].getPeers()` — a method Netron does not have
 * (its peers are the `peers` Map) — so the walk never ran and the lookup
 * ended in its own `throw`, «OmnitronCluster service not found — is cluster
 * mode enabled?», every time. `cluster status` then matched «not found» and
 * printed «Cluster mode is not enabled» whatever the daemon ran; the Fleet
 * lookup beside it had the same walk, and `step-down` failed with exit 0.
 * On the development daemon the sentence happens to be true — the daemon
 * exposes `OmnitronCluster` only with `cluster.enabled` (daemon.ts), and
 * measured 2026-09-23 the lookup answers 404 — which is how an answer that
 * could not have been anything else went unnoticed.
 *
 * `null` means exactly one thing: the lookup's own 404, no service by that
 * name. Over the unix socket the CLI holds the admin role, so a 404 there is
 * absence rather than a refusal. Everything else — no daemon, a timeout — is
 * thrown and reported as the failure it is; it used to be sorted by whether
 * the words «not found» or «not running» appeared anywhere in the message.
 */
async function clusterService(client: DaemonClient): Promise<ClusterRpc | null> {
  try {
    return await client.service<ClusterRpc>('OmnitronCluster');
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 404) return null;
    throw err;
  }
}

/**
 * What a daemon without cluster mode is told.
 *
 * The advice here was «Enable it in omnitron.config.ts: cluster: { enabled:
 * true, discovery: 'redis' }». The daemon does not read that file for its own
 * settings: all three start paths — `daemon-entry.ts`, `up.ts`,
 * `daemon-cmd.ts` — take `cluster` from DEFAULT_DAEMON_CONFIG alone
 * (`enabled: false`), and `discovery` is marked NOT READ where it is
 * declared. Following the advice changed nothing. No setting switches cluster
 * mode on today, so none is named.
 */
function reportClusterOff(): void {
  log.warn('Cluster mode is off on this daemon: it runs no leader election (no OmnitronCluster service).');
  log.info('No configuration switches it on yet: every daemon start path takes `cluster` from the built-in defaults, `enabled: false`.');
}

function formatElectionState(state: string): string {
  switch (state) {
    case 'leader': return prism.green('leader');
    case 'candidate': return prism.yellow('candidate');
    case 'follower': return prism.blue('follower');
    default: return state;
  }
}

function formatRole(role: string): string {
  switch (role) {
    case 'leader': return prism.green(role);
    case 'follower': return prism.blue(role);
    case 'candidate': return prism.yellow(role);
    default: return role;
  }
}

function formatNodeStatus(status: string): string {
  switch (status) {
    case 'online': return prism.green(status);
    case 'offline': return prism.red(status);
    case 'draining': return prism.yellow(status);
    default: return status;
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
