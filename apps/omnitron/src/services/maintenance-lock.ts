/**
 * The deployer's maintenance lock on a stack's gateway.
 *
 * A deployment stops and starts every app, swaps the frontend and runs the
 * migrations — and it did all of that under whoever was using the platform.
 * Nothing told them: a request that landed mid-restart failed as an outage
 * would, a form sent into it was lost, and a tester's report described the
 * deployment rather than the product. The gateway is the one component that
 * stays up through all of it, so it holds the platform (daos
 * `infra/nginx/lua/maintenance_check.lua`) while a key it reads exists:
 *
 *   omnitron:maintenance:notice  the warning, `noticeSeconds` ahead: open
 *                                pages say «an update in N s»
 *   omnitron:maintenance:deploy  the lock: every page, call and socket gets
 *                                503 «being updated», administrators included
 *
 * It must never outlive the deployment by more than minutes. So the key is
 * written with an expiry and RENEWED while this process lives: a deployer that
 * dies — a laptop closed, a crash — stops renewing, and the gateway lets the
 * platform go within `ttlSeconds`. Past `capSeconds` it is lifted even while
 * the deployment runs: a stuck deployment is not a reason to keep everyone
 * out for hours.
 *
 * Before lifting, the platform is asked THROUGH the gateway — the path a
 * person's request takes — with a probe token only the lock's own key holds,
 * rotated on every renewal; the gateway lets that token past only from its own
 * loopback, only for GET `/` and `/api/<service>/health`. A platform that does
 * not answer there keeps the lock, which then expires by itself.
 *
 * Everything runs on the node by `docker exec` over the deployer's SSH: the
 * stack's Redis and gateway containers, named `<prefix>-redis` and
 * `<prefix>-gateway`. A node without them — a first deployment — has nobody
 * to hold, and the deployment goes on without the lock.
 */

import crypto from 'node:crypto';

import type { ILogger } from '@omnitron-dev/titan/module/logger';

import { shellEscape } from '../shared/shell-escape.js';

export const DEPLOY_KEY = 'omnitron:maintenance:deploy';
export const NOTICE_KEY = 'omnitron:maintenance:notice';

export interface MaintenanceTiming {
  /** The warning before the lock. 0 holds at once. */
  noticeSeconds: number;
  /** What the deployment is expected to take, for Retry-After and the page. */
  etaSeconds: number;
  /** The key's expiry: how long the lock outlives a dead deployer. */
  ttlSeconds: number;
  /** How often a live deployer renews it (and rotates the probe token). */
  renewSeconds: number;
  /** Never held longer than this, deployment or not. */
  capSeconds: number;
  /** How long to wait for the gateway to see a change (it caches 2 s). */
  seenWithinMs: number;
  /** How long a platform that does not answer through the gateway is asked again. */
  probeWithinMs: number;
}

export const DEFAULT_MAINTENANCE_TIMING: MaintenanceTiming = {
  noticeSeconds: 60,
  etaSeconds: 180,
  ttlSeconds: 600,
  renewSeconds: 60,
  capSeconds: 1800,
  seenWithinMs: 8_000,
  probeWithinMs: 60_000,
};

/** Runs a script on the node; resolves stdout, rejects on a non-zero exit. */
export type NodeRunner = (script: string) => Promise<string>;

export interface MaintenanceSite {
  run: NodeRunner;
  /** The stack's container prefix on the node, e.g. `daos-test`. */
  prefix: string;
  /** The gateway's Redis database (`gateway-redis-db.ts`). */
  db: number;
  /** What is being deployed, for the key and the log. */
  release: string;
}

export type LiftOutcome = 'deployed' | 'failed' | 'capped';

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const token = () => crypto.randomBytes(24).toString('hex');
const epoch = (ms: number) => Math.floor(ms / 1000);

/**
 * redis-cli in the stack's Redis container, in the gateway's database. A
 * password, when the container has one, is read INSIDE the container — never
 * put on a command line that `ps` on the node, or a log here, would show.
 */
export function redisCommand(site: Pick<MaintenanceSite, 'prefix' | 'db'>, args: readonly string[]): string {
  const inner =
    '[ -n "${REDIS_PASSWORD:-}" ] && export REDISCLI_AUTH="$REDIS_PASSWORD"; ' +
    `exec redis-cli --no-auth-warning -n ${site.db} ${args.map(shellEscape).join(' ')}`;
  return `docker exec ${shellEscape(`${site.prefix}-redis`)} sh -c ${shellEscape(inner)}`;
}

/**
 * A GET through the gateway, from inside its own container — the gateway's
 * loopback, which is not the onion's socket, so a probe token is honoured;
 * busybox wget exits non-zero on anything but 2xx.
 */
export function gatewayCommand(site: Pick<MaintenanceSite, 'prefix'>, path: string, probe?: string): string {
  const header = probe ? ` --header ${shellEscape(`X-Maintenance-Probe: ${probe}`)}` : '';
  return `docker exec ${shellEscape(`${site.prefix}-gateway`)} wget -q -T 10 -O -${header} ${shellEscape(`http://127.0.0.1${path}`)}`;
}

export class MaintenanceLock {
  private probeToken = token();
  private timer: NodeJS.Timeout | null = null;
  private lifted = false;
  private readonly heldSince: number;

  private constructor(
    private readonly site: MaintenanceSite,
    private readonly timing: MaintenanceTiming,
    private readonly logger: ILogger,
    private readonly sleep: (ms: number) => Promise<void>,
    now: number,
  ) {
    this.heldSince = now;
  }

  /**
   * Warn, then hold. `null` when the node has no running gateway and Redis —
   * nothing to hold, and nobody to warn — or when the lock could not be
   * written; either way the deployment goes on, and the reason is logged.
   */
  static async open(
    site: MaintenanceSite,
    logger: ILogger,
    timing: MaintenanceTiming = DEFAULT_MAINTENANCE_TIMING,
    sleep: (ms: number) => Promise<void> = sleepFor,
  ): Promise<MaintenanceLock | null> {
    const running = await site
      .run(
        `docker inspect -f '{{.Name}} {{.State.Running}}' ${shellEscape(`${site.prefix}-gateway`)} ${shellEscape(`${site.prefix}-redis`)} 2>/dev/null || true`,
      )
      .catch(() => '');
    if (!/-gateway true\b/.test(running) || !/-redis true\b/.test(running)) {
      logger.info({ prefix: site.prefix }, 'No running gateway and Redis on this node — deploying without a maintenance lock');
      return null;
    }

    try {
      if (timing.noticeSeconds > 0) {
        const startsAt = epoch(Date.now()) + timing.noticeSeconds;
        await site.run(
          redisCommand(site, [
            'SET',
            NOTICE_KEY,
            JSON.stringify({ startsAt, release: site.release }),
            'EX',
            String(timing.noticeSeconds + 120),
          ]),
        );
        logger.info({ release: site.release, inSeconds: timing.noticeSeconds }, 'Maintenance announced to the platform');
        await sleep(timing.noticeSeconds * 1000);
      }
      const lock = new MaintenanceLock(site, timing, logger, sleep, Date.now());
      await lock.write();
      await site.run(redisCommand(site, ['DEL', NOTICE_KEY]));
      if (!(await lock.seen(true))) {
        // The deployment goes on: refusing it over the lock would be worse
        // than deploying without one. But it is said, because this is exactly
        // how the lock failed before — written where the gateway did not look.
        logger.error(
          { prefix: site.prefix, db: site.db },
          'The gateway does not see the maintenance lock — is its REDIS_DB the one written? Deploying unheld',
        );
      } else {
        logger.info({ release: site.release, db: site.db }, 'Maintenance: the platform is held');
      }
      lock.timer = setInterval(() => void lock.renew(), timing.renewSeconds * 1000);
      lock.timer.unref?.();
      return lock;
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Could not set the maintenance lock — deploying without it');
      await site.run(redisCommand(site, ['DEL', NOTICE_KEY, DEPLOY_KEY])).catch(() => undefined);
      return null;
    }
  }

  private value(): string {
    return JSON.stringify({
      reason: 'deploy',
      release: this.site.release,
      since: epoch(this.heldSince),
      eta: epoch(this.heldSince) + this.timing.etaSeconds,
      probe: this.probeToken,
    });
  }

  private async write(): Promise<void> {
    await this.site.run(redisCommand(this.site, ['SET', DEPLOY_KEY, this.value(), 'EX', String(this.timing.ttlSeconds)]));
  }

  /**
   * Keep holding while the deployment lives — with a new probe token — up to
   * the cap. For up to 2 s after a renewal the gateway still holds the old
   * key in its cache, so a probe then carries a token it has not read yet and
   * is refused; `liftWhenAnswering` asks again, which is why it asks in a loop.
   */
  async renew(): Promise<void> {
    if (this.lifted) return;
    if (Date.now() - this.heldSince >= this.timing.capSeconds * 1000) {
      this.logger.error(
        { heldSeconds: Math.round((Date.now() - this.heldSince) / 1000) },
        'Maintenance held past its cap — lifting it while the deployment runs',
      );
      await this.lift('capped');
      return;
    }
    this.probeToken = token();
    try {
      await this.write();
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Could not renew the maintenance lock — it expires by itself');
    }
  }

  /** Does the gateway say what we expect? Polled, since it caches for 2 s. */
  private async seen(active: boolean): Promise<boolean> {
    const deadline = Date.now() + this.timing.seenWithinMs;
    for (;;) {
      try {
        const state = JSON.parse(await this.site.run(gatewayCommand(this.site, '/_/maintenance'))) as {
          active?: boolean;
          reason?: string;
        };
        if (state.active === active && (!active || state.reason === 'deploy')) return true;
      } catch {
        // A gateway mid-recreation answers nothing for a moment.
      }
      if (Date.now() >= deadline) return false;
      await this.sleep(500);
    }
  }

  /** Paths that did not answer 2xx through the gateway, asked with this lock's probe token. */
  async probe(paths: readonly string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const path of paths) {
      try {
        await this.site.run(gatewayCommand(this.site, path, this.probeToken));
      } catch {
        failed.push(path);
      }
    }
    return failed;
  }

  /**
   * Lift when the platform answers through the gateway. A platform that does
   * not, within `probeWithinMs`, KEEPS the lock — it stops being renewed and
   * expires by itself within `ttlSeconds`, and the caller is told why.
   */
  async liftWhenAnswering(paths: readonly string[]): Promise<{ lifted: boolean; heldMs: number; failed: string[] }> {
    const deadline = Date.now() + this.timing.probeWithinMs;
    let failed = await this.probe(paths);
    while (failed.length > 0 && Date.now() < deadline) {
      await this.sleep(3_000);
      failed = await this.probe(paths);
    }
    if (failed.length === 0) {
      const heldMs = await this.lift('deployed');
      return { lifted: true, heldMs, failed };
    }
    this.stopRenewing();
    this.logger.error(
      { failed, expiresWithinSeconds: this.timing.ttlSeconds },
      'The platform does not answer through the gateway — the maintenance lock stays and expires by itself',
    );
    return { lifted: false, heldMs: Date.now() - this.heldSince, failed };
  }

  private stopRenewing(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Let the platform go. Idempotent; a failed DEL is left to the expiry. */
  async lift(outcome: LiftOutcome): Promise<number> {
    const heldMs = Date.now() - this.heldSince;
    if (this.lifted) return heldMs;
    this.lifted = true;
    this.stopRenewing();
    try {
      await this.site.run(redisCommand(this.site, ['DEL', DEPLOY_KEY, NOTICE_KEY]));
    } catch (err) {
      this.logger.error(
        { err: (err as Error).message, expiresWithinSeconds: this.timing.ttlSeconds },
        'Could not lift the maintenance lock — it expires by itself',
      );
      return heldMs;
    }
    const seen = await this.seen(false);
    this.logger.info(
      { outcome, heldSeconds: Math.round(heldMs / 1000), seenByGateway: seen },
      'Maintenance lifted',
    );
    return heldMs;
  }
}

/** What the gateway says at `/_/maintenance` — the state its readers see. */
export interface MaintenanceState {
  active: boolean;
  reason: string | null;
  message: string | null;
  endsAt: number | null;
  retryAfter: number | null;
  notice: { startsAt: number; startsIn: number; reason: string; message: string | null } | null;
}

/** Ask the gateway itself: the lock as it is enforced, not as it was written. */
export async function readMaintenanceState(site: Pick<MaintenanceSite, 'run' | 'prefix'>): Promise<MaintenanceState> {
  const raw = JSON.parse(await site.run(gatewayCommand(site, '/_/maintenance'))) as Partial<MaintenanceState>;
  return {
    active: raw.active === true,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    message: typeof raw.message === 'string' ? raw.message : null,
    endsAt: typeof raw.endsAt === 'number' ? raw.endsAt : null,
    retryAfter: typeof raw.retryAfter === 'number' ? raw.retryAfter : null,
    notice: raw.notice && typeof raw.notice === 'object' ? (raw.notice as MaintenanceState['notice']) : null,
  };
}

/** The longest an operator can hold the platform by hand in one go. */
export const MANUAL_HOLD_MAX_MINUTES = 60;

/**
 * Hold by hand for `minutes`: the deployer's lock, written once with its
 * expiry — no renewal and no process to die, so it ends by itself. Bounded,
 * because «on» typed and forgotten must not keep everyone out for a day.
 */
export async function holdByHand(site: MaintenanceSite, minutes: number): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MANUAL_HOLD_MAX_MINUTES) {
    throw new Error(`Hold for 1–${MANUAL_HOLD_MAX_MINUTES} minutes, not ${String(minutes)}`);
  }
  const now = epoch(Date.now());
  const value = JSON.stringify({ reason: 'deploy', release: site.release, since: now, eta: now + minutes * 60, probe: token() });
  await site.run(redisCommand(site, ['SET', DEPLOY_KEY, value, 'EX', String(minutes * 60)]));
  await site.run(redisCommand(site, ['DEL', NOTICE_KEY]));
}

/**
 * Let go by hand — a lock a deployment left as much as one set by hand. Only
 * omnitron's keys: the administrators' mode is main's, switched in /admin.
 */
export async function releaseByHand(site: Pick<MaintenanceSite, 'run' | 'prefix' | 'db'>): Promise<void> {
  await site.run(redisCommand(site, ['DEL', DEPLOY_KEY, NOTICE_KEY]));
}

/**
 * Where the RUNNING gateway reads its lock: the stack's `<prefix>-gateway`
 * container and the REDIS_DB it was given — asked of the container, so a lock
 * written by hand or around a fleet upgrade goes where this gateway looks, not
 * where a rule says it should. Only the REDIS_DB line crosses the wire; the
 * container's other variables (a Redis password among them) stay on the node.
 * `null` when the node has no such gateway.
 */
export async function runningGatewaySite(run: NodeRunner, prefix: string, release: string): Promise<MaintenanceSite | null> {
  const gateway = shellEscape(`${prefix}-gateway`);
  const line = await run(
    `docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${gateway} 2>/dev/null | grep '^REDIS_DB=' || true`,
  ).catch(() => '');
  const db = Number(/^REDIS_DB=(\d+)\s*$/m.exec(line)?.[1] ?? NaN);
  return Number.isInteger(db) && db >= 0 ? { run, prefix, db, release } : null;
}

/** Every stack gateway on a node (omnitron labels them), each where it reads. */
export async function runningGatewaySites(run: NodeRunner, release: string): Promise<MaintenanceSite[]> {
  const names = await run(
    `docker ps --filter label=omnitron.service=gateway --format '{{.Names}}' 2>/dev/null || true`,
  ).catch(() => '');
  const sites: MaintenanceSite[] = [];
  for (const name of names.split('\n').map((n) => n.trim())) {
    if (!name.endsWith('-gateway')) continue;
    const site = await runningGatewaySite(run, name.slice(0, -'-gateway'.length), release);
    if (site) sites.push(site);
  }
  return sites;
}
