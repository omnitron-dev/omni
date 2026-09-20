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
 * The direct dial stays first: one hop, and it is what answers for the local
 * daemon and for any node whose port IS open. The mesh is the fallback, and
 * only for machines the node registry knows, because reaching one is the
 * daemon's business and it needs a node id to do it.
 */

import { createRemoteDaemonClient, createDaemonClient } from '../daemon/daemon-client.js';
import type { IDaemonService, IOmnitronNodesService } from '../shared/dto/services.js';

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

  async ask<T>(nodeId: string, question: FleetQuestion): Promise<MachineAnswer<T>> {
    try {
      if (!this.nodes) {
        this.client ??= this.open();
        if (!(await this.client.isReachable())) {
          return { value: null, via: null, error: 'the local daemon did not answer, so the mesh could not be used' };
        }
        this.nodes = await this.client.service<IOmnitronNodesService>('OmnitronNodes');
      }
      const answer =
        question === 'status'
          ? await this.nodes.getNodeDaemonStatus({ nodeId })
          : question === 'health'
            ? await this.nodes.getNodeDaemonHealth({ nodeId })
            : await this.nodes.getNodeDaemonMetrics({ nodeId });

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
  }
}

export async function askMachine<T>(
  machine: { host: string; port: number; nodeId?: string | undefined },
  question: FleetQuestion,
  mesh: MeshAsker,
  dial: (host: string, port: number) => ReturnType<typeof createRemoteDaemonClient> = createRemoteDaemonClient,
): Promise<MachineAnswer<T>> {
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

  const relayed = await mesh.ask<T>(machine.nodeId, question);
  return relayed.via ? relayed : { value: null, via: null, error: relayed.error ?? directError };
}

