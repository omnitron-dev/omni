/**
 * One writer per node.
 *
 * Any number of development machines may run `omnitron stack start sample test`,
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
 * provided its remote command completed. A killed host worker leaves durable
 * unresolved intent and requires inspected recovery instead of an unsafe takeover.
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

export type ReleaseAnswer = { kind: 'released' } | { kind: 'not-held'; holder: LeaseRecord | null } | { kind: 'busy' };

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
        `its lease becomes eligible for takeover ${Math.max(0, leaseSec - idleSec)}s from now, once remote execution has cleared.`,
    );
    this.name = 'LeaseHeldError';
  }
}

const LEASE_FILE = 'deploy.lease';
const GUARD_FILE = 'deploy.guard';
const EXECUTION_GUARD_FILE = 'deploy.execution.guard';
const EXECUTION_RECORD_FILE = 'deploy.execution.json';

/** Everything that decides runs after this: exclusion, or a named refusal. */
function prelude(dir: string, refusalExit = 0): string[] {
  const d = shellEscape(dir);
  return [
    `command -v flock >/dev/null 2>&1 || { echo 'NO-FLOCK'; exit ${refusalExit}; }`,
    `mkdir -p ${d} 2>/dev/null || { echo 'NO-DIR'; exit ${refusalExit}; }`,
    `fs=$(stat -f -c %T ${d} 2>/dev/null || echo unknown)`,
    `case "$fs" in nfs*|cifs|smb*|fuse*|9p|ceph) echo "NETWORK-FS $fs"; exit ${refusalExit};; esac`,
    `exec 9>${shellEscape(`${dir}/${GUARD_FILE}`)} || { echo 'NO-GUARD'; exit ${refusalExit}; }`,
    `flock -w 10 9 || { echo 'GUARD-TIMEOUT'; exit ${refusalExit}; }`,
    `L=${shellEscape(`${dir}/${LEASE_FILE}`)}`,
  ];
}

function tokenNeedle(token: string): string {
  return shellEscape(`"token":"${token}"`);
}

/** Called under the metadata lock; never waits for a command that needs that lock. */
function executionIdle(timing: LeaseTiming): string[] {
  return [
    `exec 8>${shellEscape(`${timing.dir}/${EXECUTION_GUARD_FILE}`)} || { echo 'NO-GUARD'; exit 0; }`,
    `flock -n 8 || { echo 'EXECUTION-BUSY'; exit 0; }`,
    `if [ -e ${shellEscape(`${timing.dir}/${EXECUTION_RECORD_FILE}`)} ]; then echo 'EXECUTION-UNRESOLVED'; exit 0; fi`,
  ];
}

/**
 * Keep host mutations exclusive for the entire remote command, not just the
 * controller's pre-step check. The child does not inherit the lock descriptor.
 * A durable intent survives SIGKILL of the lock holder: it is never treated as
 * completed merely because a lease or timeout elapsed. Ordinary disconnects
 * leave the host worker to finish and clear its own record. An unresolved
 * record requires inspected recovery before another writer can take over.
 * Commands must synchronously finish their mutations; managed daemon startup
 * may detach the daemon, but must not detach delayed deployment writes.
 */
export function guardScript(timing: LeaseTiming, token: string, command: string, timeoutMs = 600_000): string {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 86_400_000) throw new Error('Invalid guarded command timeout');
  const id = crypto.randomUUID();
  const file = `${timing.dir}/${EXECUTION_RECORD_FILE}`;
  const temporary = `${file}.${id}.part`;
  const record = JSON.stringify({ schema: 1, id, token, timeoutMs });
  const body = [
    ...prelude(timing.dir, 73),
    `command -v timeout >/dev/null 2>&1 && command -v sync >/dev/null 2>&1 || { echo 'Execution fencing requires timeout and sync' >&2; exit 73; }`,
    `if [ -e ${shellEscape(file)} ]; then echo 'Unresolved remote deployment command; inspected recovery is required' >&2; exit 73; fi`,
    `if ! [ -s "$L" ] || ! grep -qF ${tokenNeedle(token)} "$L"; then echo 'Deployment lease was lost before remote execution' >&2; exit 73; fi`,
    `umask 077`,
    `printf '%s\\n' ${shellEscape(record)} > ${shellEscape(temporary)} && sync -f ${shellEscape(temporary)} && mv -f ${shellEscape(temporary)} ${shellEscape(file)} && sync -f ${shellEscape(timing.dir)} || exit 73`,
    `touch "$L" || exit 73`,
    `flock -u 9; exec 9>&-`,
    `timeout --signal=TERM --kill-after=5s ${Math.ceil(timeoutMs / 1000)}s sh -c ${shellEscape(command)}`,
    `result=$?`,
    // A timeout or killed supervisor does not prove all descendant writers
    // stopped. Retain intent; a new writer needs inspected recovery.
    `if [ "$result" -ge 124 ]; then echo 'Remote command termination needs inspected recovery' >&2; exit "$result"; fi`,
    // Retake metadata only after the bounded command has returned. If cleanup
    // cannot be proved, the unresolved record remains and future work refuses.
    `exec 9>${shellEscape(`${timing.dir}/${GUARD_FILE}`)} || exit 73`,
    `flock -w 10 9 || exit 73`,
    `if ! [ -f ${shellEscape(file)} ] || ! grep -qF ${shellEscape(`"id":"${id}"`)} ${shellEscape(file)}; then echo 'Remote execution record changed' >&2; exit 73; fi`,
    `rm -f ${shellEscape(file)} && sync -f ${shellEscape(timing.dir)} || exit 73`,
    `exit "$result"`,
  ].join('\n');
  return [
    `command -v flock >/dev/null 2>&1 || { echo 'Execution fencing requires flock' >&2; exit 73; }`,
    `mkdir -p ${shellEscape(timing.dir)} || exit 73`,
    // --close prevents a launched service/background process from retaining
    // the kernel lock forever. The durable record handles lock-holder death.
    `flock --exclusive --timeout 30 --close ${shellEscape(`${timing.dir}/${EXECUTION_GUARD_FILE}`)} sh -c ${shellEscape(body)}`,
  ].join('\n');
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
    ...executionIdle(timing),
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
    ...executionIdle(timing),
    `if [ -s "$L" ] && grep -qF ${tokenNeedle(token)} "$L"; then rm -f "$L"; echo 'RELEASED'; ` +
      `else printf 'NOT-HELD\\t'; cat "$L" 2>/dev/null; echo; fi`,
  ].join('\n');
}

const REFUSALS: Record<string, string> = {
  'NO-FLOCK': 'the node has no flock(1) (util-linux)',
  'EXECUTION-BUSY': 'a remote deployment command is still executing; the lease cannot be replaced',
  'EXECUTION-UNRESOLVED': 'a remote deployment command has unresolved durable intent; inspected recovery is required',
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
  if (ls.some((l) => l.trim() === 'EXECUTION-BUSY' || l.trim() === 'EXECUTION-UNRESOLVED')) return { kind: 'busy' };
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

  guard(command: string, timeoutMs?: number): string { return guardScript(this.timing, this.record.token, command, timeoutMs); }

  async release(): Promise<ReleaseAnswer> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return parseRelease(this.node, await this.run(releaseScript(this.timing, this.record.token)));
  }
}

export interface LeaseCandidate {
  /** `host:daemonPort`, the key the deployment already uses. */
  node: string;
  /**
   * The machine the lease file lives on — `host:sshPort`. Candidates on one
   * machine share one lease: two names for one server within one deployment
   * are one writer, and two leases there would refuse each other. Defaults
   * to `node`.
   */
  machine?: string;
  run: LeaseRunner;
}

export interface HeldLeases {
  /** Nodes whose lease this deployment holds. Nothing else may be touched. */
  has(node: string): boolean;
  /** Confirm with the node before a step that changes it; throws if not ours. */
  confirm(node: string, step: string): Promise<void>;
  /** Host-side exclusion and token validation for the entire remote command. */
  guard(node: string, command: string, timeoutMs?: number): string;
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
  const machineOf = (c: LeaseCandidate) => c.machine ?? c.node;
  const order = (c: LeaseCandidate) => `${machineOf(c)}\u0000${c.node}`;
  const ordered = [...candidates].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  const held = new Map<string, NodeLease>();
  const byMachine = new Map<string, NodeLease>();
  const unreachable = new Map<string, string>();
  const unreachableMachines = new Map<string, string>();

  try {
    for (const candidate of ordered) {
      const machine = machineOf(candidate);
      const shared = byMachine.get(machine);
      if (shared) {
        held.set(candidate.node, shared);
        continue;
      }
      const lost = unreachableMachines.get(machine);
      if (lost !== undefined) {
        unreachable.set(candidate.node, lost);
        continue;
      }
      const lease = new NodeLease(candidate.node, candidate.run, stack, timing);
      let answer: AcquireAnswer;
      try {
        answer = await lease.acquire();
      } catch (err) {
        if (err instanceof LeaseUnavailableError) throw err;
        unreachable.set(candidate.node, (err as Error).message);
        unreachableMachines.set(machine, (err as Error).message);
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
      byMachine.set(machine, lease);
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
      guard: (node, command, timeoutMs) => {
        const lease = held.get(node);
        if (!lease) throw new Error(`Refusing remote command on ${node}: this deployment does not hold its lease`);
        return lease.guard(command, timeoutMs);
      },
      unreachable,
    });
  } finally {
    await releaseAll(held, stack, logger);
  }
}

async function releaseAll(held: ReadonlyMap<string, NodeLease>, stack: string, logger: ILogger): Promise<void> {
  // Once per lease: several names may share one machine's.
  for (const lease of new Set(held.values())) {
    try {
      const answer = await lease.release();
      if (answer.kind === 'not-held') {
        logger.warn(
          { node: lease.node, stack, holder: answer.holder },
          'The deploy lease was no longer ours to give back — another deployment took it over',
        );
      } else if (answer.kind === 'busy') {
        logger.warn({ node: lease.node, stack }, 'Deploy lease retained: remote command is active or requires inspected recovery');
      } else {
        logger.info({ node: lease.node, stack }, 'Deploy lease released');
      }
    } catch (err) {
      logger.warn(
        { node: lease.node, stack, error: (err as Error).message },
        'Could not release the deploy lease — takeover also requires remote execution to be clear',
      );
    }
  }
}
