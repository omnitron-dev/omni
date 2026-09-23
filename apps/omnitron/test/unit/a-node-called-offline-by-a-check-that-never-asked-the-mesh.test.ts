/**
 * A node serving six apps, reported offline by the check that is meant to
 * stand in for the health worker.
 *
 * Measured 2026-09-23 on the live master, with the health worker detached:
 *
 *     $ omnitron node check 16f3dd5a-2727-49e5-90a2-d762b57073f6
 *     SSH: - not checked
 *     Omnitron: ○ offline
 *     Omnitron error: Connection timeout to tcp://37.27.130.185:9700 via tcp
 *
 * while the mesh held that node `connected via ssh-tunnel, authenticated`,
 * and `fleet status` read six apps from it through that very connection 35 s
 * later. The daemon's own check dialled `tcp://<host>:9700` and nothing else;
 * the node's firewall drops that port, so its answer was «offline» for every
 * hardened node, every time. The comment above the probe said the
 * SlaveConnector was asked first. The code never asked it.
 *
 * The same path runs once a minute from the daemon's fallback loop whenever
 * the worker is down, so the registry — and `node list`, and the console's
 * dots — went on saying the same thing.
 */

import net from 'node:net';
import { describe, it, expect } from 'vitest';

import { NodeManagerService } from '../../src/services/node-manager.service.js';
import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';

const silent: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silent,
};

/** A port on loopback that was open a moment ago and is closed now. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A registry holding one remote node whose daemon port refuses everything. */
async function registryWithOneNode() {
  const port = await closedPort();
  const node = {
    id: 'node-daos-test',
    name: 'daos-test',
    host: '127.0.0.1',
    sshPort: 22,
    sshUser: 'root',
    sshAuthMethod: 'key',
    runtime: 'node',
    daemonPort: port,
    tags: [],
    isLocal: false,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
  };
  const store = {
    selectNodesSync: () => [{ id: node.id, status: 'unknown', last_heartbeat: null, metadata: JSON.stringify(node) }],
    upsertNodeSync: () => {},
    deleteNodeSync: () => {},
    touchNodeHeartbeatSync: () => {},
    kvGetSync: () => null,
    kvSetSync: () => {},
  };
  const manager = new NodeManagerService(silent, store as never);
  // No ICMP from a court, and a short deadline on the dial that is refused.
  manager.setCheckConfig({ pingEnabled: false, omnitronCheckTimeout: 1_000 });
  return { manager, node };
}

/** The mesh as the master holds it: one node, answering over the tunnel. */
function meshAnswering(calls: string[] = []) {
  return {
    async invokeOnSlave(host: string, port: number, service: string, method: string) {
      calls.push(`${host}:${port} ${service}.${method}`);
      return { version: '0.2.0+build.20260923', pid: 1186017, uptime: 3_000_000 };
    },
  };
}

const meshWithoutTheNode = {
  async invokeOnSlave(host: string, port: number) {
    throw new Error(`Slave ${host}:${port} not connected`);
  },
};

describe('the daemon\'s own node check', () => {
  it('asks the daemon over the mesh the master already holds', async () => {
    const { manager, node } = await registryWithOneNode();
    const calls: string[] = [];
    manager.setSlaveConnector(meshAnswering(calls));

    const status = await manager.checkNodeStatus(node.id);

    expect(calls).toEqual([`127.0.0.1:${node.daemonPort} OmnitronDaemon.ping`]);
    expect(status.omnitronConnected).toBe(true);
    expect(status.omnitronVersion).toBe('0.2.0+build.20260923');
    expect(status.omnitronPid).toBe(1186017);
    expect(status.omnitronError).toBeUndefined();
  });

  it('does not call the daemon down when no path reached it', async () => {
    // The mesh has no link to it and the port refuses. The daemon may be up
    // or down — the check cannot tell, and `false` says it can.
    const { manager, node } = await registryWithOneNode();
    manager.setSlaveConnector(meshWithoutTheNode);

    const status = await manager.checkNodeStatus(node.id);

    expect(status.omnitronConnected).toBeNull();
    // Each path named with its own reason: «connection timeout» alone does not
    // say which door was shut.
    expect(status.omnitronError).toMatch(/mesh: Slave 127\.0\.0\.1:\d+ not connected/);
    expect(status.omnitronError).toMatch(/direct dial to 127\.0\.0\.1:\d+/);
  });

  it('says there was no mesh to ask, on a master whose mesh did not start', async () => {
    const { manager, node } = await registryWithOneNode();

    const status = await manager.checkNodeStatus(node.id);

    expect(status.omnitronConnected).toBeNull();
    expect(status.omnitronError).toMatch(/mesh: this daemon has no mesh connector/);
  });

  it('keeps the unknown in the summary the console and triggerNodeCheck read', async () => {
    const { manager, node } = await registryWithOneNode();
    manager.setSlaveConnector(meshWithoutTheNode);

    await manager.checkNodeStatus(node.id);

    const [summary] = manager.getHealthSummaries(node.id);
    expect(summary!.lastCheck!.omnitronConnected).toBeNull();
  });

  it('answers the fallback loop\'s round from the mesh too', async () => {
    // `checkAllNodes` is what the daemon runs once a minute while the worker
    // is down; it goes through the same check.
    const { manager, node } = await registryWithOneNode();
    manager.setSlaveConnector(meshAnswering());

    const statuses = await manager.checkAllNodes();

    expect(statuses.find((s) => s.nodeId === node.id)?.omnitronConnected).toBe(true);
    expect(manager.getNode(node.id)?.status?.omnitronConnected).toBe(true);
  });
});

describe('the connector the daemon wires', () => {
  it('reaches the node manager through the RPC service\'s setter', async () => {
    // The daemon hands the connector to `NodeManagerRpcService` once
    // (daemon.ts, where the mesh is built). A worker-less `checkNodeStatus`
    // lands in the node manager, so that is where it has to arrive.
    const { manager, node } = await registryWithOneNode();
    const rpc = new NodeManagerRpcService(manager);
    rpc.setSlaveConnector(meshAnswering() as never);

    const status = await rpc.checkNodeStatus({ id: node.id });

    expect(status.omnitronConnected).toBe(true);
  });
});
