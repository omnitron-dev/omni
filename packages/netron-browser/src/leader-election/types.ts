/**
 * Leader-election primitive — types.
 *
 * The election is parameterised over two injectable adapters so it
 * can run in three environments:
 *   1. Production browser — Web Locks + BroadcastChannel
 *      (`createBrowserAdapters()` returns the natives).
 *   2. SSR / Node — neither API exists; the consumer must inject
 *      a stub or accept that role will stay 'follower' forever.
 *   3. Tests — in-process stubs (one tab → one election instance)
 *      simulate cross-tab coordination via shared registries.
 *
 * This module is types-only. Behaviour lives in `election.ts` +
 * adapter modules.
 */

/**
 * Lifetime-bound lock used to elect ONE leader per `lockName`
 * across all participants sharing the same lock-registry.
 *
 * In the browser this maps to `navigator.locks.request(name, ...)`
 * — the lock is held for the duration of the callback's returned
 * promise, and the browser releases it automatically when the
 * holding context (tab) dies. Tests inject a queue-based stub.
 */
export interface ILeaderLock {
  /**
   * Request the lock named `name`. The implementation may queue
   * the request if another participant currently holds the lock.
   *
   * When granted, `onAcquired` is invoked. The lock stays held
   * until the returned promise resolves — election keeps this
   * promise pending for its full leader tenure.
   *
   * Returns a function that releases the lock if not yet released.
   * Idempotent.
   */
  acquire(
    name: string,
    onAcquired: (release: () => void) => Promise<void>,
  ): Promise<void>;
}

/**
 * Bidirectional pub/sub channel scoped to a single `channelName`.
 *
 * Browser-native maps to `BroadcastChannel`. Tests inject an
 * in-memory registry.
 *
 * Messages posted by a tab are NOT echoed back to the sender —
 * matches `BroadcastChannel` semantics. The election layer
 * normalises this so the leader sees its own emissions consistently
 * with followers (re-dispatching locally after `postMessage`).
 */
export interface ILeaderChannel {
  postMessage(data: unknown): void;
  onMessage(handler: (data: unknown) => void): () => void;
  close(): void;
}

/**
 * Role of the current participant. 'leader' tabs own the underlying
 * resource (e.g. the WebSocket connection); 'follower' tabs proxy
 * through the channel.
 */
export type LeaderRole = 'leader' | 'follower';

export interface LeaderElectionOptions {
  /**
   * Identifier shared across participants. Same `lockName` →
   * same election. Choose a stable string per logical resource
   * (e.g. `'chat-ws:user:abc123'`).
   */
  readonly lockName: string;
  /**
   * BroadcastChannel name — typically `lockName` with a suffix
   * (e.g. `${lockName}:bus`) so adjacent elections don't share
   * a bus.
   */
  readonly channelName: string;
  /**
   * Optional adapters. Defaults: `createWebLocksAdapter()` /
   * `createBroadcastChannelAdapter(channelName)`. The browser-
   * native defaults throw `LeaderElectionUnavailableError` on
   * construction when the underlying API is missing — inject a
   * stub to opt into a single-participant "always leader" mode.
   */
  readonly lock?: ILeaderLock;
  readonly channel?: ILeaderChannel;
}

export interface LeaderElectionHandle {
  /**
   * Current role. Read synchronously after construction; subscribe
   * to `onRoleChange` for transitions.
   */
  readonly role: LeaderRole;
  /**
   * Subscribe to role transitions. Returns an unsubscribe function.
   * Fires on every transition AFTER the handle is created — the
   * initial 'follower' state is observable via `.role` (don't
   * expect a synthetic transition event for it).
   */
  onRoleChange(handler: (role: LeaderRole) => void): () => void;
  /**
   * Send a message to all participants on the same channel —
   * leader AND followers (including self). Self-delivery is
   * synchronous via a local re-dispatch so the leader can apply
   * its own writes through the same pipeline as remote writes.
   */
  broadcast(data: unknown): void;
  /**
   * Subscribe to inbound messages. Returns an unsubscribe function.
   * Handlers fire for messages from other participants AND for
   * the local participant's own `broadcast(...)` calls.
   */
  onMessage(handler: (data: unknown) => void): () => void;
  /**
   * Tear down. Releases the lock (if leader), closes the channel,
   * and rejects any in-flight role transitions. Idempotent —
   * concurrent calls share the same teardown.
   */
  dispose(): Promise<void>;
}

/**
 * Thrown when `createLeaderElection` cannot find a usable lock or
 * channel API (no browser-native + no override). Callers handle by
 * either polyfilling, injecting their own adapter, or falling back
 * to "every tab opens its own WS" (the pre-election behaviour).
 */
export class LeaderElectionUnavailableError extends Error {
  override readonly name = 'LeaderElectionUnavailableError';
  constructor(missing: 'navigator.locks' | 'BroadcastChannel') {
    super(
      `Leader election cannot start: ${missing} is unavailable in this environment. ` +
        `Inject a custom adapter via { lock } or { channel } to override.`,
    );
  }
}
