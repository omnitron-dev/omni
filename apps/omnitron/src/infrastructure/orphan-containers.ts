/**
 * Which managed containers, if any, this daemon may remove.
 *
 * A daemon sweeps containers labelled `omnitron.managed=true` that belong to
 * no stack it knows about. The reasoning is sound and the cost of getting it
 * wrong is not symmetric, which its own guard says: "Leaving a real orphan
 * running costs an idle container; the other way costs the platform."
 *
 * It has now cost the platform twice.
 *
 * **2026-09-12** — `listStacks` reads a cache that the per-project load
 * populates, and the sweep ran before that load. `expectedPrefixes` was
 * empty, every container looked like an orphan, and ten RUNNING containers
 * went in fourteen seconds: postgres, redis, bitcoin, monero (daemon and
 * wallet), nominatim, tor, tiles, minio, gateway. Fixed by loading first and
 * refusing when any project's stacks could not be read.
 *
 * **2026-09-20** — the same six-container sweep on the test NODE, moments
 * after a daemon upgrade:
 *
 *     Removing orphan container (not part of any registered stack)  daos-test-pg
 *     Removing orphan container (not part of any registered stack)  daos-test-redis
 *     Removing orphan container (not part of any registered stack)  daos-test-tor
 *     Removing orphan container (not part of any registered stack)  daos-test-postgres
 *     Removing orphan container (not part of any registered stack)  daos-test-minio
 *     Removing orphan container (not part of any registered stack)  daos-test-gateway
 *     Orphan container cleanup complete
 *
 * — the onion went dark and the stack it was serving went with it. The guard
 * did not fire, and the reason is one line: it sets `expectationsComplete`
 * to false inside a `for (const project of projects)` loop, and a SLAVE NODE
 * has no registered projects at all. It learns what to run from its master.
 * The loop body never ran, so nothing ever lowered the flag, and an empty
 * set of expectations authorised removing everything.
 *
 * An empty list is not a complete list of nothing. That is the whole
 * correction, and it is the same distinction the process janitor had to
 * learn between a parent that is foreign and a parent that is dead.
 *
 * Volumes survived both times — `docker rm -f` without `-v` — so the price
 * was a cold restart of every service rather than the data. That is luck,
 * not design, and it is not a reason to rely on the sweep being right.
 */

/** What the sweep needs to know about a container, and nothing more. */
export interface SweepCandidate {
  readonly name: string;
  readonly status: string;
  /** From the `omnitron.project` label, written at creation. */
  readonly project?: string | undefined;
  /** From the `omnitron.stack` label. */
  readonly stack?: string | undefined;
}

export interface SweepInput {
  readonly managed: readonly SweepCandidate[];
  /** Projects this daemon has in its own registry. */
  readonly projects: readonly string[];
  /** `project-stack-` prefixes this daemon expects, built from loaded configs. */
  readonly expectedPrefixes: readonly string[];
  /**
   * Whether every project's stacks were read successfully. False when any
   * config failed to load or returned no stacks.
   */
  readonly expectationsComplete: boolean;
  /** Containers omnitron owns outside any stack — `omnitron-pg`, `omnitron-nginx`. */
  readonly internalNames: readonly string[];
}

export type SweepDecision =
  | { readonly action: 'skip'; readonly because: string }
  | { readonly action: 'remove'; readonly containers: readonly string[] };

/**
 * Decide what the sweep may remove.
 *
 * Pure, because every mistake this has made was a mistake about what the
 * inputs MEANT, and that is the part worth pinning in a test rather than
 * discovering on a host.
 */
export function decideOrphans(input: SweepInput): SweepDecision {
  if (input.managed.length === 0) {
    return { action: 'skip', because: 'nothing is managed on this host' };
  }

  // A daemon with no projects of its own knows nothing about what should be
  // running — it is not a daemon that knows nothing should be. Every slave
  // node is in this state permanently: it runs what a master deploys and its
  // own registry stays empty.
  if (input.projects.length === 0) {
    return {
      action: 'skip',
      because:
        'this daemon has no projects of its own, so it cannot know which containers are expected — ' +
        'a node runs what its master deploys',
    };
  }

  if (!input.expectationsComplete) {
    return { action: 'skip', because: 'the set of expected stacks is incomplete' };
  }

  if (input.expectedPrefixes.length === 0) {
    return {
      action: 'skip',
      because: 'no stack prefixes were resolved, so every container would look like an orphan',
    };
  }

  const internal = new Set(input.internalNames);
  const known = new Set(input.projects);
  const containers: string[] = [];

  for (const container of input.managed) {
    if (internal.has(container.name)) continue;
    if (input.expectedPrefixes.some((prefix) => container.name.startsWith(prefix))) continue;

    // The container's own account of itself. A container labelled for a
    // project this daemon does not have in its registry belongs to somebody
    // else's bookkeeping — most often a master's — and removing it is
    // deciding a question this daemon was not asked.
    if (container.project && !known.has(container.project)) continue;

    containers.push(container.name);
  }

  if (containers.length === 0) {
    return { action: 'skip', because: 'every managed container is accounted for' };
  }
  return { action: 'remove', containers };
}
