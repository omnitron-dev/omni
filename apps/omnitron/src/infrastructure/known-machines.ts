/**
 * Every remote machine this installation knows about, from both places it
 * keeps them.
 *
 * There are two registries for "a remote machine", and they do not know about
 * each other:
 *
 *   `~/.omnitron/servers.json`  — written by `omnitron remote add`, read by
 *                                 `omnitron remote` and `omnitron fleet`.
 *   the SQLite `nodes` table    — written by the console's Nodes page and
 *                                 `omnitron node add`, read by the fleet
 *                                 view, the health monitor and the deployer.
 *
 * Which of the two should survive is a decision with consequences for stored
 * credentials and for anyone's existing setup, and it is not made here. What
 * IS made here is that neither answers for the other's machines, because that
 * produces a lie rather than a limitation.
 *
 * Measured 2026-09-15 on this installation: `servers.json` does not exist,
 * and the `nodes` table holds three entries, two of them remote and both
 * being health-checked by the daemon every minute. `omnitron fleet status`
 * printed
 *
 *     No remote servers registered. Use `omnitron remote add` to add servers.
 *
 * — which is false about the fleet and directs the operator to add, a second
 * time and in a second place, machines the product already knows.
 *
 * So: both are read, each machine says where it came from, and a machine in
 * both is one machine.
 */

import type { ServerInfoDto } from '../shared/dto/services.js';

/** Which registry a machine was found in. */
export type MachineSource = 'servers.json' | 'nodes';

export interface KnownMachine {
  /** How a person refers to it — an alias, or the node's name. */
  readonly name: string;
  readonly host: string;
  /** The daemon's fleet port on that machine. */
  readonly port: number;
  readonly tags: readonly string[];
  /** Where it is registered. Both, when both know it. */
  readonly sources: readonly MachineSource[];
  /** The node id, when it is in the node registry — needed to act on it. */
  readonly nodeId?: string | undefined;
}

/** Just enough of a registered node for this. */
export interface NodeLike {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly daemonPort?: number | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly isLocal?: boolean | undefined;
}

/**
 * Merge the two registries.
 *
 * A machine is the same machine when its host and fleet port match — not when
 * its NAME matches. An alias in `servers.json` and a node's name are chosen
 * by a person on two different occasions and need not agree, while the
 * address is what either of them is for.
 *
 * The local node is excluded: a fleet is the machines that are not this one,
 * and `fleet status` reaching over the network to itself would report the
 * daemon running the command as a remote peer.
 */
export function mergeKnownMachines(
  servers: readonly ServerInfoDto[],
  nodes: readonly NodeLike[],
): KnownMachine[] {
  const byAddress = new Map<string, KnownMachine>();
  const key = (host: string, port: number) => `${host}:${port}`;

  for (const s of servers) {
    byAddress.set(key(s.host, s.port), {
      name: s.alias,
      host: s.host,
      port: s.port,
      tags: s.tags ?? [],
      sources: ['servers.json'],
    });
  }

  for (const n of nodes) {
    if (n.isLocal) continue;
    const port = n.daemonPort ?? 9700;
    const k = key(n.host, port);
    const existing = byAddress.get(k);
    if (existing) {
      // One machine, registered twice. Its `servers.json` alias is what the
      // fleet commands have always called it, so that name stays — but the
      // node id travels, because acting on it needs the registry that holds
      // the credentials.
      byAddress.set(k, {
        ...existing,
        tags: [...new Set([...existing.tags, ...(n.tags ?? [])])],
        sources: [...existing.sources, 'nodes'],
        nodeId: n.id,
      });
      continue;
    }
    byAddress.set(k, {
      name: n.name,
      host: n.host,
      port,
      tags: n.tags ?? [],
      sources: ['nodes'],
      nodeId: n.id,
    });
  }

  return [...byAddress.values()];
}

/**
 * What to tell an operator when there are none.
 *
 * Both ways of adding one, because the product has two and saying only one is
 * how an operator ends up with machines in both.
 */
export const NO_MACHINES_MESSAGE =
  'No remote machines registered. Add one with `omnitron node add` (the console\'s Nodes page uses the same registry), ' +
  'or `omnitron remote add` for a daemon you only want to query.';
