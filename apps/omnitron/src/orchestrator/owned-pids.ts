/**
 * Which OS processes the orchestrator considers its own.
 *
 * This exists as its own unit because the answer feeds `ProcessJanitor`,
 * which kills every fork-worker the set omits. The janitor was thoroughly
 * tested — owned pids are never reaped, unowned ones with a dead ppid are,
 * cold start reaps the previous daemon's leftovers — but every one of those
 * tests supplied the owned set as a fixture. Nothing tested how the set is
 * BUILT, so when it turned out to be missing a whole class of process the
 * janitor did exactly what it was tested to do, to processes that were ours.
 *
 * The omission: an app owns processes through two channels. Topology entries
 * with a single instance run as supervisor children; entries declaring
 * `instances > 1` run in a pool the supervisor knows nothing about. Only the
 * first was collected, so pool workers were orphans by construction — reaped
 * on a thirty-second cycle for as long as the daemon ran, and silently
 * replaced by a pool that then grew by one worker per sweep.
 *
 * Being generous here is the safe direction: a pid wrongly included survives
 * one more sweep, while a pid wrongly omitted is a live worker killed.
 */

/** Just enough of a supervisor to enumerate its children. */
export interface OwnedPidSupervisor {
  getChildNames(): readonly string[];
  getChildProcessId(childName: string): string | null | undefined;
}

/** Just enough of a pool to enumerate its workers. */
export interface OwnedPidPool {
  getWorkerIds(): readonly string[];
}

/** Just enough of an app handle to enumerate everything it owns. */
export interface OwnedPidHandle {
  readonly supervisor: OwnedPidSupervisor | null;
  readonly topologyPools: ReadonlyMap<string, OwnedPidPool>;
}

/**
 * Collect the OS pids owned by the given handles.
 *
 * @param handles every app the orchestrator is currently supervising
 * @param resolvePid maps a process-manager worker id to its OS pid; returns
 *   undefined when the worker has no pid of its own (a worker thread shares
 *   the daemon's), which must NOT be substituted for a real one
 */
export function collectOwnedPids(
  handles: Iterable<OwnedPidHandle>,
  resolvePid: (workerId: string) => number | undefined
): Set<number> {
  const owned = new Set<number>();

  for (const handle of handles) {
    for (const childName of handle.supervisor?.getChildNames() ?? []) {
      const processId = handle.supervisor?.getChildProcessId(childName);
      if (!processId) continue;
      const pid = resolvePid(processId);
      if (typeof pid === 'number') owned.add(pid);
    }

    for (const pool of handle.topologyPools.values()) {
      for (const workerId of pool.getWorkerIds()) {
        const pid = resolvePid(workerId);
        if (typeof pid === 'number') owned.add(pid);
      }
    }
  }

  return owned;
}
