/**
 * Phantom-endpoint janitor (T#75).
 *
 * Docker networks accumulate "phantom endpoint" records when a
 * container is removed while the dockerd daemon is restarting,
 * during host suspend/resume cycles, or when a `docker rm -f`
 * arrives mid-network-disconnect. The network's internal endpoint
 * table keeps a stale row pointing at a container that no longer
 * exists. The visible symptom is a recreation failure with:
 *
 *     Error response from daemon: endpoint with name X
 *     already exists in network managed-net
 *
 * The existing T#58 work avoids the bridge default to sidestep the
 * worst class of this. The managed network is still susceptible
 * after dockerd / host restarts, just less frequently. T#75 is the
 * active cleanup: every interval, list the endpoints in each
 * managed network, look each one up as a container, and force-
 * disconnect every endpoint whose container has vanished.
 *
 * Implementation notes:
 *   - We shell out to `docker network inspect` / `docker network
 *     disconnect` rather than the engine adapter — the adapter
 *     doesn't expose network APIs and this code path is rare
 *     (one sweep per `intervalMs`).
 *   - The whole loop is wrapped in a single in-flight guard so
 *     two overlapping sweeps can't both try to disconnect the
 *     same endpoint and produce noisy errors.
 *   - All errors are caught and logged — a docker-daemon hiccup
 *     during one sweep must NOT prevent the next one from running.
 */

import { spawn } from 'node:child_process';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

export interface PhantomEndpointJanitorOptions {
  /** Network name(s) the daemon manages and should sweep. */
  networks: string[];
  /** Sweep interval in ms. Default: 60_000 (every minute). */
  intervalMs?: number;
  /** Logger for cleanup events. */
  logger: ILogger;
  /**
   * Optional sink for "phantoms found" / "phantoms cleaned" so an
   * observability bridge can wire it to a counter. Called with the
   * number of phantoms acted on in the just-completed sweep.
   */
  onCleanup?: (network: string, cleaned: number) => void;
}

export class PhantomEndpointJanitor {
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(private readonly opts: PhantomEndpointJanitorOptions) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.opts.intervalMs ?? 60_000;
    this.timer = setInterval(() => {
      void this.sweepAll().catch((err) => {
        this.opts.logger.error({ err }, 'phantom-endpoint janitor: sweep loop crashed');
      });
    }, intervalMs);
    this.timer.unref();
    this.opts.logger.info(
      { networks: this.opts.networks, intervalMs },
      'phantom-endpoint janitor: started (T#75)',
    );
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Run a single sweep across every managed network. Public for tests + ops triggers. */
  async sweepAll(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let totalCleaned = 0;
    try {
      for (const net of this.opts.networks) {
        try {
          const cleaned = await this.sweepNetwork(net);
          totalCleaned += cleaned;
          this.opts.onCleanup?.(net, cleaned);
        } catch (err) {
          this.opts.logger.warn(
            { err, network: net },
            'phantom-endpoint janitor: per-network sweep failed (continuing)',
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
    return totalCleaned;
  }

  private async sweepNetwork(network: string): Promise<number> {
    const inspect = await this.runDocker(['network', 'inspect', network]);
    if (!inspect.ok) {
      // Network doesn't exist or docker daemon unreachable. Either
      // way, nothing to clean.
      return 0;
    }
    let networks: Array<{ Containers?: Record<string, { Name?: string }> }> = [];
    try {
      networks = JSON.parse(inspect.stdout) as typeof networks;
    } catch {
      return 0;
    }
    const endpoints = Object.entries(networks[0]?.Containers ?? {});
    if (endpoints.length === 0) return 0;

    // One authoritative listing instead of an inspect per endpoint: it is
    // a single docker round-trip (this loop used to make N), and it gives
    // the sweep a positive fact — "these containers exist" — to reason
    // from. If the listing itself fails we know nothing about anything, so
    // the only safe move is to skip the sweep entirely and retry next tick.
    const listing = await this.runDocker(['ps', '-aq', '--no-trunc']);
    if (!listing.ok) {
      this.opts.logger.warn(
        { network, stderr: listing.stderr },
        'phantom-endpoint janitor: could not list containers — skipping sweep (nothing disconnected)',
      );
      return 0;
    }
    const liveContainerIds = new Set(
      listing.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );

    let cleaned = 0;
    for (const [containerId, info] of endpoints) {
      if (liveContainerIds.has(containerId)) continue;

      // Absent from the listing is not yet proof: the container may have
      // been created between the listing and now. Confirm per-endpoint,
      // and require docker to SAY the object is gone.
      const verdict = await this.containerVerdict(containerId);
      if (verdict !== 'absent') {
        this.opts.logger.warn(
          { network, containerId, name: info?.Name, verdict },
          'phantom-endpoint janitor: could not confirm container is gone — leaving endpoint alone',
        );
        continue;
      }

      // Phantom — force-disconnect.
      const disconnect = await this.runDocker(['network', 'disconnect', network, containerId, '--force']);
      if (disconnect.ok) {
        cleaned++;
        this.opts.logger.info(
          { network, containerId, name: info?.Name },
          'phantom-endpoint janitor: disconnected phantom endpoint (T#75)',
        );
      } else {
        this.opts.logger.warn(
          { network, containerId, stderr: disconnect.stderr },
          'phantom-endpoint janitor: failed to disconnect phantom — will retry next sweep',
        );
      }
    }
    return cleaned;
  }

  /**
   * Decide whether a container exists, is definitively gone, or cannot be
   * determined right now.
   *
   * This distinction is the whole point of the module's safety. The
   * original code asked `docker inspect` and treated ANY non-zero exit as
   * "gone" — so a 10s timeout (trivially reachable when the host disk is
   * full and dockerd crawls), a spawn failure, or an unreachable daemon
   * all read as "phantom". On 2026-09-04 that fired nine times in six
   * minutes against RUNNING containers: the janitor force-disconnected
   * daos-dev-pg, -redis, -postgres, -minio, -tor, -tiles, -nominatim and
   * both monero containers from the managed network, which drops their
   * host port publication until the container is recreated. The container
   * IDs in those log lines matched the live containers exactly — they were
   * never phantoms.
   *
   * `disconnect --force` is destructive and unrecoverable without a
   * recreate, so 'unknown' must never be treated as 'absent'.
   */
  private async containerVerdict(containerId: string): Promise<'exists' | 'absent' | 'unknown'> {
    const result = await this.runDocker(['inspect', '--type=container', '--format', '{{.Id}}', containerId]);
    if (result.ok) return 'exists';
    // Docker answered, and its answer was "there is no such object".
    if (/no such (object|container)/i.test(result.stderr)) return 'absent';
    // Timeout, spawn error, daemon unreachable, permission problem, …
    return 'unknown';
  }

  /**
   * Run `docker <args>` and return stdout/stderr/exit-code. Never throws —
   * a missing docker binary or a hung daemon shouldn't crash the daemon.
   *
   * Visible for testing via subclassing — overrides go through this
   * single seam so tests can drive deterministic responses without
   * needing a real Docker daemon. Production callers should not
   * subclass.
   */
  protected runDocker(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* */ }
        resolve({ ok: false, stdout, stderr: stderr + '\n[janitor: timeout]' });
      }, 10_000);
      child.stdout?.on('data', (c) => { stdout += c.toString(); });
      child.stderr?.on('data', (c) => { stderr += c.toString(); });
      child.on('error', () => {
        clearTimeout(timeout);
        resolve({ ok: false, stdout, stderr: stderr + '\n[janitor: spawn error]' });
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ ok: code === 0, stdout, stderr });
      });
    });
  }
}
