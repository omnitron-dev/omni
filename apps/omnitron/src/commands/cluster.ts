/**
 * omnitron cluster status|step-down — Cluster management commands
 *
 * Communicates with the daemon via Unix socket RPC to query
 * cluster state and issue control commands.
 */

import { log, table, prism } from '@xec-sh/kit';
import { emitError, emitJson } from './output.js';
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
      const reason = 'This daemon has no cluster status service. Its enrollment is unreported.';
      if (!emitJson({ enabled: null, reason })) log.warn(reason);
      process.exitCode = 2;
      return;
    }

    const state = await cluster.getClusterState();
    // Older controllers returned the election observation without a participant discriminator.
    if (emitJson({ ...state, enabled: state.participant !== 'standalone' })) return;
    if (state.participant === 'standalone') { reportClusterOff(); return; }
    if (state.participant === 'worker') {
      log.info(`Cluster ${state.clusterId} · worker ${state.nodeId}`);
      log.info('  Authority: the recipient must verify the lease before each effect');
      log.info(`  Fenced protocol operations: ${state.fencedOperations.join(', ')}`);
      return;
    }

    log.info(`${prism.bold('Cluster State')}`);
    log.info(`  Node ID:    ${state.nodeId}`);
    log.info(`  State:      ${formatElectionState(state.state)}`);
    log.info(`  Epoch:      ${state.term ?? prism.dim('unconfirmed')}`);
    log.info(`  Leader:     ${state.leaderId ?? prism.dim('none')}`);
    if (state.authority) log.info(`  Authority:  ${state.authority}${state.coordination ? ` (${state.coordination})` : ''}`);
    if (typeof state.leaseRemainingMs === 'number') log.info(`  Lease:      ${state.leaseRemainingMs} ms remaining`);
    if (state.reason) log.warn(`  Reason:     ${state.reason}`);
    log.info(`  Fenced protocol operations: ${state.fencedOperations?.join(', ') || 'unreported'}`);
    if (typeof state.uptime === 'number') log.info(`  Uptime:     ${formatDuration(state.uptime)}`);

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
    emitError(`Failed to get cluster status: ${(err as Error).message}`);
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
      log.warn('This daemon has no cluster status service. Its enrollment is unreported.');
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

/** Legacy daemons can lack the observation service. Other transport failures preserve their cause. */
async function clusterService(client: DaemonClient): Promise<ClusterRpc | null> {
  try {
    return await client.service<ClusterRpc>('OmnitronCluster');
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 404) return null;
    throw err;
  }
}

function reportClusterOff(): void {
  log.info('This daemon runs standalone.');
  log.info('For HA, enroll the controller in the daemon config.json and configure OMNITRON_CLUSTER_DATABASE_URL. Workers verify authority without running elections.');
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
