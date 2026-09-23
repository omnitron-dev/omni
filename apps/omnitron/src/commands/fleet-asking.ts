/**
 * How a fleet command reaches a machine's daemon.
 *
 * These commands dialled `host:9700` and nothing else. A node whose daemon
 * port is not open to this master answers nothing — which is the normal
 * state of a hardened server and the whole reason the mesh tunnels over SSH
 * — so `fleet status` printed
 *
 *     daos-test  37.27.130.185:9700  offline  0 apps
 *
 * about a machine running six, with every port listening and the master
 * deploying to it over that tunnel minutes earlier.
 *
 * The direct dial is first for a machine the mesh does not reach through a
 * tunnel: one hop, and it is what answers for the local daemon and for any
 * node whose port IS open. A node the mesh reaches over `ssh-tunnel` is
 * asked over the mesh FIRST — the tunnel is the master's own finding that
 * the port is shut, and dialling it anyway cost every fleet command five
 * seconds per node, measured twice on 2026-09-23 (the dial fails at 5.0 s,
 * `fleet status` took 6.2–6.9 s for one node). The mesh is only for machines
 * the node registry knows, because reaching one is the daemon's business
 * and it needs a node id to do it.
 */

import { createRemoteDaemonClient, createDaemonClient } from '../daemon/daemon-client.js';
import type { IDaemonService, IOmnitronNodesService } from '../shared/dto/services.js';
import type { IMeshNodeStatus } from '../shared/dto/nodes.js';

export type FleetQuestion = 'status' | 'health' | 'metrics';

export interface MachineAnswer<T> {
  readonly value: T | null;
  /** How it was reached — `null` when it was not. */
  readonly via: 'direct' | 'mesh' | null;
  readonly error: string | null;
}

/** Opened at most once per command, for every machine that needs the mesh. */
export class MeshAsker {
  /**
   * How the local daemon is opened. Injected by the tests, which have a
   * daemon to fake and none to run.
   */
  constructor(private readonly open: () => ReturnType<typeof createDaemonClient> = createDaemonClient) {}

  private client: ReturnType<typeof createDaemonClient> | null = null;
  private nodes: IOmnitronNodesService | null = null;
  /** How the master reaches each node right now, read once per command. */
  private routes: Map<string, IMeshNodeStatus['via']> | null = null;

  /** The local daemon's node service, or the reason it cannot be had. */
  private async service(): Promise<IOmnitronNodesService | string> {
    if (this.nodes) return this.nodes;
    this.client ??= this.open();
    if (!(await this.client.isReachable())) {
      return 'the local daemon did not answer, so the mesh could not be used';
    }
    this.nodes = await this.client.service<IOmnitronNodesService>('OmnitronNodes');
    return this.nodes;
  }

  /**
   * How the master's mesh reaches a node now — `ssh-tunnel` meaning its
   * daemon port is shut to this master — or `null` when it is not connected
   * or nothing could be learned. Asked once, for every node, per command.
   */
  async routeOf(nodeId: string): Promise<IMeshNodeStatus['via']> {
    if (!this.routes) {
      this.routes = new Map();
      try {
        const nodes = await this.service();
        if (typeof nodes !== 'string') {
          for (const m of await nodes.getMeshStatus()) {
            if (m.inMesh && m.status === 'connected') this.routes.set(m.nodeId, m.via);
          }
        }
      } catch {
        // Not knowing the route is not a failure: the machine is asked the
        // way it always was, direct first.
      }
    }
    return this.routes.get(nodeId) ?? null;
  }

  async ask<T>(nodeId: string, question: FleetQuestion): Promise<MachineAnswer<T>> {
    try {
      const nodes = await this.service();
      if (typeof nodes === 'string') return { value: null, via: null, error: nodes };
      const answer =
        question === 'status'
          ? await nodes.getNodeDaemonStatus({ nodeId })
          : question === 'health'
            ? await nodes.getNodeDaemonHealth({ nodeId })
            : await nodes.getNodeDaemonMetrics({ nodeId });

      return answer.reachable
        ? { value: answer.answer as T, via: 'mesh', error: null }
        : { value: null, via: null, error: answer.error };
    } catch (err) {
      return { value: null, via: null, error: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    if (this.client) await this.client.disconnect();
    this.client = null;
    this.nodes = null;
    this.routes = null;
  }
}

export async function askMachine<T>(
  machine: { host: string; port: number; nodeId?: string | undefined },
  question: FleetQuestion,
  mesh: MeshAsker,
  dial: (host: string, port: number) => ReturnType<typeof createRemoteDaemonClient> = createRemoteDaemonClient,
): Promise<MachineAnswer<T>> {
  // A node the mesh reaches through a tunnel: its port is known to be shut,
  // so the mesh goes first and the dial is only the last resort.
  let askedMesh: MachineAnswer<T> | null = null;
  if (machine.nodeId && (await mesh.routeOf(machine.nodeId)) === 'ssh-tunnel') {
    askedMesh = await mesh.ask<T>(machine.nodeId, question);
    if (askedMesh.via) return askedMesh;
  }

  const client = dial(machine.host, machine.port);
  let directError: string;
  try {
    const daemon = await client.service<IDaemonService>('OmnitronDaemon');
    const value =
      question === 'status'
        ? await daemon.status()
        : question === 'health'
          ? await daemon.getHealth({})
          : await daemon.getMetrics({});
    return { value: value as T, via: 'direct', error: null };
  } catch (err) {
    directError = (err as Error).message;
  } finally {
    await client.disconnect();
  }

  if (!machine.nodeId) return { value: null, via: null, error: directError };
  // Asked already, first: a second call would say the same thing again.
  if (askedMesh) return { value: null, via: null, error: askedMesh.error ?? directError };

  const relayed = await mesh.ask<T>(machine.nodeId, question);
  return relayed.via ? relayed : { value: null, via: null, error: relayed.error ?? directError };
}
