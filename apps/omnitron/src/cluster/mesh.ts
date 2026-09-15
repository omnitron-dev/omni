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
  isLocal: boolean;
}

/** The part of the node registry this needs — an EventEmitter with a list. */
export interface MeshRegistry {
  listNodes(): MeshNode[];
  on(event: 'node:added' | 'node:updated', listener: (node: MeshNode) => void): unknown;
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

  /**
   * Node id → the address it was joined at.
   *
   * `node:removed` carries the id and fires AFTER the row is deleted, so
   * asking the registry where that node lived answers nothing. The connector
   * is keyed on host:port, so the address has to be remembered while it
   * still exists or a removed node keeps its connection — and its SSH
   * tunnel — for the life of the daemon.
   */
  const joined = new Map<string, { host: string; port: number }>();

  const join = (node: MeshNode) => {
    if (stopped || node.isLocal) return;
    joined.set(node.id, { host: node.host, port: node.daemonPort });
    void connector
      .addSlave({ host: node.host, port: node.daemonPort, label: node.name, nodeId: node.id })
      .catch((err: unknown) =>
        logger.warn(
          { host: node.host, port: node.daemonPort, error: (err as Error).message },
          'Could not add a registered node to the mesh',
        ),
      );
  };

  const drop = (id: string) => {
    const at = joined.get(id);
    if (!at) return;
    joined.delete(id);
    void connector.removeSlave(at.host, at.port).catch(() => undefined);
  };

  const known = meshMembers(registry.listNodes());
  for (const node of known) join(node);
  logger.info({ nodes: known.length }, 'Mesh following the node registry');

  const onAdded = (node: MeshNode) => join(node);

  /**
   * An edited address is a different node to the connector.
   *
   * Editing a node's host or daemon port in the console is how an operator
   * corrects a mistake or follows a machine that moved. Without this the
   * master keeps dialling the old address forever and the corrected one is
   * never tried — the edit appears to do nothing, which is the worst way for
   * a correction to fail.
   */
  const onUpdated = (node: MeshNode) => {
    if (stopped) return;
    const at = joined.get(node.id);
    const moved = !at || at.host !== node.host || at.port !== node.daemonPort;
    if (!moved) return;
    if (at) drop(node.id);
    join(node);
  };

  const onRemoved = (id: string) => {
    if (stopped) return;
    drop(id);
  };

  registry.on('node:added', onAdded);
  registry.on('node:updated', onUpdated);
  registry.on('node:removed', onRemoved);

  return {
    stop() {
      stopped = true;
      const emitter = registry as unknown as { off?: (event: string, listener: unknown) => void };
      emitter.off?.('node:added', onAdded);
      emitter.off?.('node:updated', onUpdated);
      emitter.off?.('node:removed', onRemoved);
    },
  };
}
