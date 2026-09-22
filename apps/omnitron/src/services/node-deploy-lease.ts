/**
 * One writer per node.
 *
 * Any number of development machines may run `omnitron stack start daos test`,
 * and every one of them is a master that deploys to the SAME node over SSH.
 * Nothing stopped two of them — or two terminals on one of them — from
 * interleaving: one delivering artifacts while the other restarted the apps
 * onto half of them. There is one test server and one production
 * infrastructure, so the exclusion has to live where the contention is: on the
 * node.
 *
 * It is a LEASE, not a lock held open. A file on the node names the holder and
 * is renewed while the deployment runs; a deployment that finds it renewed
 * within the last `leaseSec` is refused and told who holds it; one that finds
 * it older takes it over, and says so. A laptop closed mid-deployment therefore
 * frees the only test server by itself, `leaseSec` after its last renewal,
 * instead of wedging it until someone logs in to delete a file.
 *
 * Every read-decide-write of that file runs under `flock` on the node, so two
 * masters deciding at the same instant cannot both win. A node that cannot
 * give that guarantee — no `flock(1)`, or the lock directory on a network
 * filesystem, where `flock` may exclude nothing — REFUSES the deployment
 * rather than proceeding unlocked: a lock that cannot run is not a lock that
 * passed.
 *
 * The scripts answer on stdout and exit 0 even when they refuse, so a refusal
 * arrives as words this module can name, not as an SSH exit status. Any
 * answer this module does not recognise is a refusal too — never a lease.
 */

import crypto from 'node:crypto';
import os from 'node:os';

import type { ILogger } from '@omnitron-dev/titan/module/logger';

import { shellEscape } from '../shared/shell-escape.js';

/** Who holds a node, as written in the lease file. */
export interface LeaseRecord {
  /** Random per deployment attempt; the only field compared. */
  token: string;
  /** Machine and process, for the operator who is told to wait. */
  holder: string;
  /** `project/stack` being deployed. */
  stack: string;
  /** ISO time the holder took the lease. */
  startedAt: string;
}

export interface LeaseTiming {
  /** Directory on the node holding the lease and its guard. */
  dir: string;
  /** A lease unrenewed for this long may be taken over. */
  leaseSec: number;
  /** How often a holder renews. Must be well inside `leaseSec`. */
  renewEveryMs: number;
}

export const DEFAULT_LEASE_TIMING: LeaseTiming = {
  dir: '/opt/omnitron/locks',
  leaseSec: 120,
  renewEveryMs: 30_000,
};

export type AcquireAnswer =
  | { kind: 'acquired'; lapsed: { idleSec: number; previous: LeaseRecord | null } | null }
  | { kind: 'held'; idleSec: number; holder: LeaseRecord | null };

export type RenewAnswer = { kind: 'renewed' } | { kind: 'lost'; holder: LeaseRecord | null };

export type ReleaseAnswer = { kind: 'released' } | { kind: 'not-held'; holder: LeaseRecord | null };

/** The node answered, and cannot provide exclusion. Refuse the deployment. */
export class LeaseUnavailableError extends Error {
  constructor(
    readonly node: string,
    readonly reason: string,
  ) {
    super(`Cannot lock ${node} for deployment: ${reason}. Refusing to deploy to it unlocked.`);
    this.name = 'LeaseUnavailableError';
  }
}

/** Another deployment holds the node. */
export class LeaseHeldError extends Error {
  constructor(
    readonly node: string,
    readonly holder: LeaseRecord | null,
    readonly idleSec: number,
    readonly leaseSec: number,
  ) {
    const who = holder
      ? `${holder.holder} (deploying ${holder.stack}, since ${holder.startedAt})`
      : 'a deployment whose lease file could not be read';
    super(
      `${node} is being deployed by ${who}; its lease was renewed ${idleSec}s ago. ` +
        `One writer per node: wait for it to finish. If that deployment is dead, ` +
        `its lease lapses ${Math.max(0, leaseSec - idleSec)}s from now and the next deployment takes it over.`,
    );
    this.name = 'LeaseHeldError';
  }
}

const LEASE_FILE = 'deploy.lease';
const GUARD_FILE = 'deploy.guard';

/** Everything that decides runs after this: exclusion, or a named refusal. */
function prelude(dir: string): string[] {
  const d = shellEscape(dir);
  return [
    `command -v flock >/dev/null 2>&1 || { echo 'NO-FLOCK'; exit 0; }`,
    `mkdir -p ${d} 2>/dev/null || { echo 'NO-DIR'; exit 0; }`,
    `fs=$(stat -f -c %T ${d} 2>/dev/null || echo unknown)`,
    `case "$fs" in nfs*|cifs|smb*|fuse*|9p|ceph) echo "NETWORK-FS $fs"; exit 0;; esac`,
    `exec 9>${shellEscape(`${dir}/${GUARD_FILE}`)} || { echo 'NO-GUARD'; exit 0; }`,
    `flock -w 10 9 || { echo 'GUARD-TIMEOUT'; exit 0; }`,
    `L=${shellEscape(`${dir}/${LEASE_FILE}`)}`,
  ];
}

function tokenNeedle(token: string): string {
  return shellEscape(`"token":"${token}"`);
}

export function acquireScript(timing: LeaseTiming, record: LeaseRecord): string {
  return [
    ...prelude(timing.dir),
    `now=$(date +%s)`,
    `if [ -s "$L" ]; then`,
    `  m=$(stat -c %Y "$L" 2>/dev/null || stat -f %m "$L")`,
    `  idle=$((now - m))`,
    // Our own token: a retry of this same attempt. Renew and say so.
    `  if grep -qF ${tokenNeedle(record.token)} "$L"; then touch "$L"; echo 'ACQUIRED'; exit 0; fi`,
    // Renewed within the lease — including ZERO seconds ago — is held.
    `  if [ "$idle" -lt ${timing.leaseSec} ]; then printf 'HELD %s\\t' "$idle"; cat "$L"; echo; exit 0; fi`,
    `  printf 'LAPSED %s\\t' "$idle"; cat "$L"; echo`,
    `fi`,
    `printf '%s' ${shellEscape(JSON.stringify(record))} > "$L.tmp" && mv "$L.tmp" "$L" && echo 'ACQUIRED'`,
  ].join('\n');
}

export function renewScript(timing: LeaseTiming, token: string): string {
  return [
    ...prelude(timing.dir),
    `if [ -s "$L" ] && grep -qF ${tokenNeedle(token)} "$L"; then touch "$L"; echo 'RENEWED'; ` +
      `else printf 'LOST\\t'; cat "$L" 2>/dev/null; echo; fi`,
  ].join('\n');
}

export function releaseScript(timing: LeaseTiming, token: string): string {
  return [
    ...prelude(timing.dir),
    `if [ -s "$L" ] && grep -qF ${tokenNeedle(token)} "$L"; then rm -f "$L"; echo 'RELEASED'; ` +
      `else printf 'NOT-HELD\\t'; cat "$L" 2>/dev/null; echo; fi`,
  ].join('\n');
}

const REFUSALS: Record<string, string> = {
  'NO-FLOCK': 'the node has no flock(1) (util-linux)',
  'NO-DIR': 'the lock directory could not be created',
  'NO-GUARD': 'the guard file could not be opened',
  'GUARD-TIMEOUT': 'the guard stayed locked for 10s — a lease operation on the node is stuck',
};

function lines(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '');
}

function refusalIn(node: string, ls: string[]): void {
  for (const l of ls) {
    const code = l.trim();
    if (REFUSALS[code]) throw new LeaseUnavailableError(node, REFUSALS[code]);
    if (code.startsWith('NETWORK-FS ')) {
      throw new LeaseUnavailableError(
        node,
        `the lock directory is on a network filesystem (${code.slice(11)}), where flock may exclude nothing`,
      );
    }
  }
}

/** `<WORD> <n>\t<json>` → the number and the record. */
function tagged(line: string, word: string): { n: number; record: LeaseRecord | null } {
  const tab = line.indexOf('\t');
  const head = tab === -1 ? line : line.slice(0, tab);
  const n = Number.parseInt(head.slice(word.length).trim(), 10);
  return { n: Number.isFinite(n) ? n : 0, record: tab === -1 ? null : parseRecord(line.slice(tab + 1)) };
}

function parseRecord(text: string): LeaseRecord | null {
  try {
    const o = JSON.parse(text.trim()) as Partial<LeaseRecord> | null;
    return o && typeof o.token === 'string' && typeof o.holder === 'string'
      ? { token: o.token, holder: o.holder, stack: String(o.stack ?? ''), startedAt: String(o.startedAt ?? '') }
      : null;
  } catch {
    return null;
  }
}

function unrecognised(node: string, what: string, out: string): never {
  throw new LeaseUnavailableError(node, `the ${what} answer was not recognised: ${JSON.stringify(out.slice(0, 200))}`);
}

export function parseAcquire(node: string, out: string): AcquireAnswer {
  const ls = lines(out);
  refusalIn(node, ls);
  const held = ls.find((l) => l.startsWith('HELD '));
  if (held) {
    const { n, record } = tagged(held, 'HELD');
    return { kind: 'held', idleSec: n, holder: record };
  }
  if (ls.some((l) => l.trim() === 'ACQUIRED')) {
    const lapsed = ls.find((l) => l.startsWith('LAPSED '));
    if (!lapsed) return { kind: 'acquired', lapsed: null };
    const { n, record } = tagged(lapsed, 'LAPSED');
    return { kind: 'acquired', lapsed: { idleSec: n, previous: record } };
  }
  return unrecognised(node, 'acquire', out);
}

export function parseRenew(node: string, out: string): RenewAnswer {
  const ls = lines(out);
  refusalIn(node, ls);
  if (ls.some((l) => l.trim() === 'RENEWED')) return { kind: 'renewed' };
  const lost = ls.find((l) => l.startsWith('LOST'));
  if (lost) return { kind: 'lost', holder: tagged(lost, 'LOST').record };
  return unrecognised(node, 'renew', out);
}

export function parseRelease(node: string, out: string): ReleaseAnswer {
  const ls = lines(out);
  refusalIn(node, ls);
  if (ls.some((l) => l.trim() === 'RELEASED')) return { kind: 'released' };
  const notHeld = ls.find((l) => l.startsWith('NOT-HELD'));
  if (notHeld) return { kind: 'not-held', holder: tagged(notHeld, 'NOT-HELD').record };
  return unrecognised(node, 'release', out);
}

/** A timing that could hand the node to a second writer is refused outright. */
export function assertTiming(timing: LeaseTiming): void {
  if (!Number.isInteger(timing.leaseSec) || timing.leaseSec <= 0) {
    throw new Error(`leaseSec must be a positive whole number of seconds, not ${String(timing.leaseSec)}`);
  }
  if (!(timing.renewEveryMs > 0) || timing.renewEveryMs * 2 > timing.leaseSec * 1000) {
    throw new Error(
      `renewEveryMs (${String(timing.renewEveryMs)}) must be positive and at most half of leaseSec ` +
        `(${timing.leaseSec}s): one missed renewal must not be enough to lose the node`,
    );
  }
  if (!timing.dir.startsWith('/')) throw new Error(`the lease directory must be absolute, not '${timing.dir}'`);
}

function describeHolder(record: LeaseRecord | null): string {
  return record ? `${record.holder} (deploying ${record.stack}, since ${record.startedAt})` : 'an unreadable lease';
}

/** Runs one lease script on the node and returns its stdout. */
export type LeaseRunner = (script: string) => Promise<string>;

export class NodeLease {
  readonly record: LeaseRecord;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lost: string | null = null;
  private renewing = false;

  constructor(
    readonly node: string,
    private readonly run: LeaseRunner,
    stack: string,
    private readonly timing: LeaseTiming = DEFAULT_LEASE_TIMING,
    now: () => number = Date.now,
  ) {
    assertTiming(timing);
    this.record = {
      token: crypto.randomUUID(),
      holder: `${os.hostname()} pid ${process.pid}`,
      stack,
      startedAt: new Date(now()).toISOString(),
    };
  }

  async acquire(): Promise<AcquireAnswer> {
    return parseAcquire(this.node, await this.run(acquireScript(this.timing, this.record)));
  }

  /**
   * Renew until released. A renewal that finds another holder marks the lease
   * lost; one that cannot reach the node is logged and retried — the next
   * `confirm` asks the node directly before anything else is changed on it.
   */
  startRenewing(logger?: ILogger): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.renewOnce().catch((err: unknown) => {
        logger?.warn(
          { node: this.node, error: (err as Error).message },
          'Could not renew the deploy lease — will ask the node again before the next step',
        );
      });
    }, this.timing.renewEveryMs);
    this.timer.unref?.();
  }

  private async renewOnce(): Promise<void> {
    if (this.lost || this.renewing) return;
    this.renewing = true;
    try {
      const answer = parseRenew(this.node, await this.run(renewScript(this.timing, this.record.token)));
      if (answer.kind === 'lost') this.lost = `it was taken over by ${describeHolder(answer.holder)}`;
    } finally {
      this.renewing = false;
    }
  }

  /**
   * Ask the node whether the lease is still this deployment's, before a step
   * that changes the node. Throws when it is not — or when the node cannot
   * say, which is not a yes.
   */
  async confirm(step: string): Promise<void> {
    if (!this.lost) {
      let answer: RenewAnswer;
      try {
        answer = parseRenew(this.node, await this.run(renewScript(this.timing, this.record.token)));
      } catch (err) {
        throw new Error(`Stopped before ${step} on ${this.node}: could not confirm the deploy lease — ${(err as Error).message}`, {
          cause: err,
        });
      }
      if (answer.kind === 'renewed') return;
      this.lost = `it was taken over by ${describeHolder(answer.holder)}`;
    }
    throw new Error(
      `Stopped before ${step} on ${this.node}: the deploy lease is no longer this deployment's — ${this.lost}. ` +
        `Was this machine asleep for more than ${this.timing.leaseSec}s?`,
    );
  }

  async release(): Promise<ReleaseAnswer> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return parseRelease(this.node, await this.run(releaseScript(this.timing, this.record.token)));
  }
}

export interface LeaseCandidate {
  /** `host:daemonPort`, the key the deployment already uses. */
  node: string;
  run: LeaseRunner;
}

export interface HeldLeases {
  /** Nodes whose lease this deployment holds. Nothing else may be touched. */
  has(node: string): boolean;
  /** Confirm with the node before a step that changes it; throws if not ours. */
  confirm(node: string, step: string): Promise<void>;
  /** Nodes that could not be reached to lease them, with the reason. */
  readonly unreachable: ReadonlyMap<string, string>;
}

/**
 * Take the lease on every node, run the deployment, give them back.
 *
 * All nodes before any is touched, in a fixed order, so a multi-node stack is
 * never half-deployed and then found blocked on its last machine. A node that
 * cannot be REACHED is left out and reported, as an unprovisionable node was
 * before — the caller skips it. A node that is HELD, or that answers and
 * cannot lock, refuses the whole deployment: what was taken is given back
 * first.
 */
export async function withNodeLeases<T>(
  candidates: readonly LeaseCandidate[],
  stack: string,
  logger: ILogger,
  deploy: (leases: HeldLeases) => Promise<T>,
  timing: LeaseTiming = DEFAULT_LEASE_TIMING,
): Promise<T> {
  const ordered = [...candidates].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
  const held = new Map<string, NodeLease>();
  const unreachable = new Map<string, string>();

  try {
    for (const candidate of ordered) {
      const lease = new NodeLease(candidate.node, candidate.run, stack, timing);
      let answer: AcquireAnswer;
      try {
        answer = await lease.acquire();
      } catch (err) {
        if (err instanceof LeaseUnavailableError) throw err;
        unreachable.set(candidate.node, (err as Error).message);
        logger.warn(
          { node: candidate.node, stack, error: (err as Error).message },
          'Could not reach this node to lease it — it will not be deployed to',
        );
        continue;
      }
      if (answer.kind === 'held') {
        throw new LeaseHeldError(candidate.node, answer.holder, answer.idleSec, timing.leaseSec);
      }
      if (answer.lapsed) {
        logger.warn(
          { node: candidate.node, stack, previous: answer.lapsed.previous, idleSec: answer.lapsed.idleSec },
          'Took over a lapsed deploy lease — its holder stopped renewing it',
        );
      }
      held.set(candidate.node, lease);
      lease.startRenewing(logger);
      logger.info({ node: candidate.node, stack, token: lease.record.token }, 'Deploy lease taken');
    }
  } catch (err) {
    await releaseAll(held, stack, logger);
    throw err;
  }

  try {
    return await deploy({
      has: (node) => held.has(node),
      confirm: async (node, step) => {
        const lease = held.get(node);
        if (!lease) throw new Error(`Refusing ${step} on ${node}: this deployment does not hold its lease`);
        await lease.confirm(step);
      },
      unreachable,
    });
  } finally {
    await releaseAll(held, stack, logger);
  }
}

async function releaseAll(held: ReadonlyMap<string, NodeLease>, stack: string, logger: ILogger): Promise<void> {
  for (const lease of held.values()) {
    try {
      const answer = await lease.release();
      if (answer.kind === 'not-held') {
        logger.warn(
          { node: lease.node, stack, holder: answer.holder },
          'The deploy lease was no longer ours to give back — another deployment took it over',
        );
      } else {
        logger.info({ node: lease.node, stack }, 'Deploy lease released');
      }
    } catch (err) {
      logger.warn(
        { node: lease.node, stack, error: (err as Error).message },
        'Could not release the deploy lease — it lapses by itself once it goes unrenewed',
      );
    }
  }
}
