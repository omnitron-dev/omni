/**
 * omnitron cluster status|step-down — Cluster management commands
 *
 * Communicates with the daemon via Unix socket RPC to query
 * cluster state and issue control commands.
 */

import { log, table, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function clusterStatusCommand(): Promise<void> {
  const client = createDaemonClient();

  try {
    // Query cluster state via OmnitronCluster.getClusterState
    const state = await invokeClusterRpc(client, 'getClusterState');

    log.info(`${prism.bold('Cluster State')}`);
    log.info(`  Node ID:    ${state.nodeId}`);
    log.info(`  State:      ${formatElectionState(state.state)}`);
    log.info(`  Term:       ${state.term}`);
    log.info(`  Leader:     ${state.leaderId ?? prism.dim('none')}`);
    log.info(`  Voted For:  ${state.votedFor ?? prism.dim('none')}`);
    log.info(`  Uptime:     ${formatDuration(state.uptime)}`);

    // Also show fleet nodes for context
    try {
      const fleetSummary = await invokeFleetRpc(client, 'getSummary');
      log.info('');
      log.info(`${prism.bold('Fleet Nodes')} (${fleetSummary.onlineNodes}/${fleetSummary.totalNodes} online)`);

      if (fleetSummary.nodes.length > 0) {
        table({
          data: fleetSummary.nodes.map((n: any) => ({
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
    } catch {
      // Fleet query failed — cluster state is still useful
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found') || msg.includes('not running')) {
      log.warn('Cluster mode is not enabled. Enable it in omnitron.config.ts:');
      log.info('  cluster: { enabled: true, discovery: \'redis\' }');
    } else {
      log.error(`Failed to get cluster status: ${msg}`);
    }
  }

  await client.disconnect();
}

export async function clusterStepDownCommand(): Promise<void> {
  const client = createDaemonClient();

  try {
    const result = await invokeClusterRpc(client, 'stepDown');

    if (result.success) {
      log.success(result.message);
    } else {
      log.warn(result.message);
    }
  } catch (err) {
    log.error(`Failed to step down: ${(err as Error).message}`);
  }

  await client.disconnect();
}

// =============================================================================
// Helpers
// =============================================================================

async function invokeClusterRpc(client: any, method: string, data?: any): Promise<any> {
  await client['ensureConnected']();
  const netron = client['netron'];
  const peers = netron.getPeers ? netron.getPeers() : [];
  for (const peer of peers) {
    try {
      const svc = await peer.queryInterface('OmnitronCluster');
      if (svc && typeof svc[method] === 'function') {
        return data ? await svc[method](data) : await svc[method]();
      }
    } catch {
      continue;
    }
  }
  throw new Error('OmnitronCluster service not found — is cluster mode enabled?');
}

async function invokeFleetRpc(client: any, method: string, data?: any): Promise<any> {
  await client['ensureConnected']();
  const netron = client['netron'];
  const peers = netron.getPeers ? netron.getPeers() : [];
  for (const peer of peers) {
    try {
      const svc = await peer.queryInterface('OmnitronFleet');
      if (svc && typeof svc[method] === 'function') {
        return data ? await svc[method](data) : await svc[method]();
      }
    } catch {
      continue;
    }
  }
  throw new Error('OmnitronFleet service not found');
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
