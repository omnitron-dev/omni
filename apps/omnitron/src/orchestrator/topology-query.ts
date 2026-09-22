/**
 * Ask the daemon for a sibling service's interface, allowing for the fact
 * that it may not be registered yet.
 *
 * An app's `http` process connects to the daemon and asks for its siblings'
 * interfaces the moment it is up; the pool that provides them registers a
 * beat later. Asking once turned that half-second into a logged failure —
 * «[topology] Failed to query service 'CollectorWorker' from daemon: Service
 * 'CollectorWorker' not found», six a day on the dev stand.
 *
 * Nothing broke, and the reason is worth stating precisely, because it is
 * not what the log suggests. The caller already registers
 * `createDeferredTopologyProxy` on failure — a proxy that connects and asks
 * again on first use — so no consumer is handed a null and no token is lost.
 * priceverse's two consumers re-resolve on their own as well
 * (`OhlcvSchedulerService` every tick, `HealthService.collectorStats` every poll);
 * measured there, «exchange state is observable» appears 3 times and «not
 * observable from this process» 0 times.
 *
 * So what the race actually costs is a WARN that describes a moment rather
 * than an outcome, and a deferred proxy built for a service that was about
 * to appear. This removes both: four asks a quarter-second apart cover the
 * window, and a service that is genuinely absent still ends as a failure
 * once the attempts are spent — where the line means what it says, and the
 * deferred proxy is the right answer rather than a spare one.
 */

/** The part of a Netron peer this needs. */
export interface TopologyPeer {
  queryInterface(serviceName: string): Promise<unknown>;
}

export interface TopologyQueryOptions {
  /** How many times to ask before giving up. Default 4. */
  attempts?: number;
  /** Pause between attempts. Default 250 ms. */
  delayMs?: number;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export type TopologyQueryResult =
  | { ok: true; proxy: unknown; attempts: number }
  | { ok: false; error: Error; attempts: number };

/**
 * Four asks 250 ms apart — a second in total, against a startup window the
 * stand measured in fractions of one. Long enough to cover the race, short
 * enough that an app whose sibling really is missing is not held up.
 */
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_DELAY_MS = 250;

export async function queryTopologyService(
  peer: TopologyPeer,
  serviceName: string,
  options: TopologyQueryOptions = {},
): Promise<TopologyQueryResult> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: Error = new Error(`Service '${serviceName}' was never asked for`);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const proxy = await peer.queryInterface(serviceName);
      return { ok: true, proxy, attempts: attempt };
    } catch (err) {
      lastError = err as Error;
      // The pause goes BETWEEN asks: one before the first would cost every
      // app that starts correctly the same delay as one that races.
      if (attempt < attempts) await sleep(delayMs);
    }
  }

  return { ok: false, error: lastError, attempts };
}
