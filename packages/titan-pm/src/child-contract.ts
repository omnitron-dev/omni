/**
 * ChildContract — typed IPC protocol between supervisor and forked
 * child processes.
 *
 * Pre-this-module the fork-worker IPC was ad-hoc — both ends sent
 * arbitrary `process.send(anything)` payloads, parsed them by
 * structural duck-typing (`msg && msg.type === 'ready'`), and the
 * supervisor had no defined way to ask the child "are you still
 * alive?" or "what's your current state?". Three concrete pain
 * paths motivated formalising this:
 *
 *   1. The supervisor couldn't distinguish "child wedged but alive"
 *      from "child healthy". A child stuck in a sync infinite loop
 *      still answered `process.kill(pid, 0)` happily — the only
 *      signal was the absence of subsequent `ready` messages, which
 *      lifelong children never send anyway.
 *
 *   2. After a daemon hard-restart, re-adopted children had no way
 *      to resync state. They were either marked "starting" forever
 *      (waiting for a `ready` message that never came) or assumed
 *      online without verifying responsiveness.
 *
 *   3. Crash diagnosis. The child died without leaving structured
 *      reason metadata — the supervisor knew `code` + `signal` but
 *      nothing about WHY (E2E error tag, OOM hint, intentional
 *      shutdown).
 *
 * The contract is intentionally small. Every message has a `type`
 * + `seq` (monotonically increasing per direction) + typed payload.
 * Both ends use `isChildToParent` / `isParentToChild` guards
 * instead of structural duck-typing.
 */

// ---------------------------------------------------------------------------
// Child → Parent
// ---------------------------------------------------------------------------

export type ChildToParentMessage =
  | ChildReadyMessage
  | ChildHeartbeatMessage
  | ChildSnapshotResponseMessage
  | ChildShutdownIntentMessage
  | ChildErrorReportMessage;

/** Sent once after the child has finished bootstrap and is accepting RPCs. */
export interface ChildReadyMessage {
  type: 'ready';
  seq: number;
  /** Optional listening port if the child opened one. */
  port?: number;
  /** Optional service descriptors the child registered. */
  services?: ReadonlyArray<{ name: string; version: string }>;
  /** Wall-clock ms the bootstrap took. */
  bootstrapDurationMs?: number;
}

/**
 * Periodic liveness ping. The supervisor expects one within
 * `heartbeatTimeoutMs`; missing beats trigger "wedged child"
 * remediation (forced restart) instead of waiting for a kernel-
 * level kill to materialise.
 *
 * Carries cheap counters so the supervisor can plot "is the work
 * loop progressing?" without an RPC round-trip. Anything more
 * detailed goes through the metrics surface.
 */
export interface ChildHeartbeatMessage {
  type: 'heartbeat';
  seq: number;
  /** monotonic counter the child increments each heartbeat. */
  beat: number;
  /** Process.uptime() at send time — confirms the child wasn't replaced by a pid-reuse stranger. */
  uptimeSeconds: number;
  /** Optional `process.memoryUsage().rss` snapshot. */
  rssBytes?: number;
}

/**
 * Response to a parent `snapshot-request`. Lets a freshly-adopted
 * child (after daemon restart) advertise what state it already
 * holds, so the supervisor doesn't blindly re-bootstrap.
 */
export interface ChildSnapshotResponseMessage {
  type: 'snapshot-response';
  seq: number;
  /** Echo of the request's seq so the parent matches request↔response. */
  requestSeq: number;
  /** Opaque payload, schema owned by the child's bootstrap. */
  snapshot: unknown;
}

/**
 * Voluntary shutdown intent. Child sends this BEFORE a clean exit
 * (drain complete, restart requested, etc.) so the supervisor
 * treats the imminent close as "expected" rather than "crashed".
 * Has a `reason` tag for log clarity.
 */
export interface ChildShutdownIntentMessage {
  type: 'shutdown-intent';
  seq: number;
  reason: 'drain' | 'restart-requested' | 'config-reload' | 'self-stop';
  /** Optional grace window the child wants — supervisor may shorten. */
  graceMs?: number;
}

/**
 * Structured crash/error report. Sent JUST before exit on the
 * uncaughtException / unhandledRejection path so the supervisor
 * gets the typed reason instead of having to scrape stderr.
 */
export interface ChildErrorReportMessage {
  type: 'error-report';
  seq: number;
  /** Free-form tag — 'oom', 'db-connect', 'startup-timeout', etc. */
  category: string;
  message: string;
  stack?: string;
  /** True when the child's own classifier said this was operational (vs programming). */
  operational: boolean;
}

// ---------------------------------------------------------------------------
// Parent → Child
// ---------------------------------------------------------------------------

export type ParentToChildMessage =
  | ParentSnapshotRequestMessage
  | ParentDrainMessage
  | ParentConfigUpdateMessage;

/** Ask the child for its current snapshot. Used after daemon restart. */
export interface ParentSnapshotRequestMessage {
  type: 'snapshot-request';
  seq: number;
}

/** Ask the child to stop accepting new work and drain. Followed by a graceful kill. */
export interface ParentDrainMessage {
  type: 'drain';
  seq: number;
  graceMs: number;
}

/** Push a hot-reloadable config delta. Schema owned by the child. */
export interface ParentConfigUpdateMessage {
  type: 'config-update';
  seq: number;
  config: unknown;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isChildToParent(msg: unknown): msg is ChildToParentMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown; seq?: unknown };
  if (typeof m.seq !== 'number') return false;
  if (typeof m.type !== 'string') return false;
  return (
    m.type === 'ready' ||
    m.type === 'heartbeat' ||
    m.type === 'snapshot-response' ||
    m.type === 'shutdown-intent' ||
    m.type === 'error-report'
  );
}

export function isParentToChild(msg: unknown): msg is ParentToChildMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown; seq?: unknown };
  if (typeof m.seq !== 'number') return false;
  if (typeof m.type !== 'string') return false;
  return m.type === 'snapshot-request' || m.type === 'drain' || m.type === 'config-update';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default heartbeat cadence — child sends one every 5s. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** Supervisor waits this long for a heartbeat before marking the child wedged. */
export const HEARTBEAT_TIMEOUT_MS = 30_000;
