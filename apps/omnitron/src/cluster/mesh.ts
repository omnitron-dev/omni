/**
 * Join every registered node to the mesh, and keep it joined.
 *
 * `SlaveConnector` maintains master→node connections and pulls each node's
 * replication buffer on connect and on every heartbeat. All of it worked.
 * The only thing that ever called `addSlave` was a remote or cluster STACK
 * starting, so the set of nodes the master connected to was "the ones
 * something was deployed onto", not "the ones this master has".
 *
 * A node added through the console, provisioned, running its own daemon and
 * collecting its own metrics and logs, was therefore never dialled. It
 * buffers locally by design when it has no master — that is the correct
 * behaviour for a node that has lost one — and nothing distinguishes that
 * from a master that was never going to call. Measured on the first such
 * node: 47,407 entries in the write-ahead buffer, none delivered, over
 * eleven hours, with the node reporting healthy throughout.
 *
 * Membership follows the registry, because the registry is what an operator
 * edits. Added is joined, removed is dropped; whether a node is currently
 * reachable is the connector's problem, and it already has backoff for it.
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { SlaveConnector } from './slave-connector.js';

/** A registered node, in the terms the mesh needs. */
export interface MeshNode {
  id: string;
  name: string;
  host: string;
  daemonPort: number;
  sshPort?: number;
  sshUser?: string;
  isLocal: boolean;
}

/** The part of the node registry this needs — an EventEmitter with a list. */
export interface MeshRegistry {
  listNodes(): MeshNode[];
  on(event: 'node:added' | 'node:updated' | 'node:ssh-trust-changed', listener: (node: MeshNode) => void): unknown;
  on(event: 'node:removed', listener: (id: string) => void): unknown;
}

export interface MeshHandle {
  /** Stop following the registry. Does not disconnect — the connector owns that. */
  stop(): void;
}

/**
 * The local machine is not a peer of itself.
 *
 * The registry contains one entry for the machine the master runs on, so
 * that the console can show it beside the others. Dialling it would have the
 * master connect to its own daemon and pull its own buffer into itself —
 * every entry ingested with its own node id, which is how one machine's
 * readings become two nodes on a chart.
 */
export function meshMembers<T extends { isLocal: boolean }>(nodes: T[]): T[] {
  return nodes.filter((node) => !node.isLocal);
}

export function startMesh(options: {
  registry: MeshRegistry;
  connector: SlaveConnector;
  logger: ILogger;
}): MeshHandle {
  const { registry, connector, logger } = options;
  let stopped = false;

  const address = (node: MeshNode) => JSON.stringify([node.host, node.daemonPort]);
  const addressById = new Map<string, string>();
  const groups = new Map<string, Map<string, MeshNode>>();
  function remember(node: MeshNode): void {
    const key = address(node);
    const group = groups.get(key) ?? new Map<string, MeshNode>();
    group.set(node.id, node);
    groups.set(key, group);
    addressById.set(node.id, key);
  }
  function forget(id: string, key: string): void {
    const group = groups.get(key);
    group?.delete(id);
    if (!group?.size) groups.delete(key);
    addressById.delete(id);
  }
  const connected = new Map<string, MeshNode>();
  const closing = new Set<string>();

  // Close the previous peer before joining another identity at the same address.
  // During shutdown or an overlapping edit, reconcile the latest registry state.
  function reconcile(key: string, trustChanged = false): void {
    if (stopped || closing.has(key)) return;
    const candidates = groups.get(key);
    const desired = candidates?.size === 1 ? candidates.values().next().value : undefined;
    const previous = connected.get(key);
    if (previous) {
      if (!trustChanged && desired && previous.id === desired.id &&
          previous.sshPort === desired.sshPort && previous.sshUser === desired.sshUser) return;
      closing.add(key);
      // removeSlave synchronously revokes the peer and resolves after closing the tunnel.
      void connector.removeSlave(previous.host, previous.daemonPort).then(() => {
        connected.delete(key);
        closing.delete(key);
        reconcile(key);
      }, (error: Error) => {
        closing.delete(key);
        logger.warn({ host: previous.host, error: error.message }, 'Failed to close previous mesh peer');
      });
      return;
    }
    if (!desired) {
      if (candidates && candidates.size > 1) logger.warn({ nodeIds: [...candidates.keys()] },
        'Mesh paused: multiple node registrations share this daemon address');
      return;
    }
    connected.set(key, desired);
    void connector.addSlave({ host: desired.host, port: desired.daemonPort, label: desired.name, nodeId: desired.id })
      .catch((error: Error) => logger.warn({ host: desired.host, port: desired.daemonPort, error: error.message },
        'Could not add a registered node to the mesh'));
  }

  for (const node of meshMembers(registry.listNodes())) remember(node);
  for (const key of groups.keys()) reconcile(key);
  logger.info({ nodes: addressById.size }, 'Mesh following the node registry');

  const onUpdated = (node: MeshNode) => {
    if (stopped || node.isLocal) return;
    const before = addressById.get(node.id);
    const key = address(node);
    if (before && before !== key) {
      forget(node.id, before);
      reconcile(before);
    }
    remember(node);
    reconcile(key);
  };
  const onSshTrustChanged = (node: MeshNode) => {
    const key = addressById.get(node.id);
    if (key) reconcile(key, true);
  };
  const onRemoved = (id: string) => {
    const key = addressById.get(id);
    if (key) {
      forget(id, key);
      reconcile(key);
    }
  };

  registry.on('node:added', onUpdated);
  registry.on('node:updated', onUpdated);
  registry.on('node:removed', onRemoved);
  registry.on('node:ssh-trust-changed', onSshTrustChanged);

  return {
    stop() {
      stopped = true;
      const emitter = registry as unknown as { off?: (event: string, listener: unknown) => void };
      emitter.off?.('node:added', onUpdated);
      emitter.off?.('node:updated', onUpdated);
      emitter.off?.('node:removed', onRemoved);
      emitter.off?.('node:ssh-trust-changed', onSshTrustChanged);
    },
  };
}
