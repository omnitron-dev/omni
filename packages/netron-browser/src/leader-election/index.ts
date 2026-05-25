/**
 * Leader-election primitive for multi-tab WS consolidation.
 *
 * One tab holds the leadership lock + owns the WebSocket; other
 * tabs follow over a BroadcastChannel. Leader teardown (tab close
 * or explicit dispose) auto-promotes the next waiter.
 *
 * Browser-native by default; injectable adapters for tests and
 * non-browser environments.
 *
 * Quickstart:
 * ```ts
 * import { createLeaderElection } from '@omnitron-dev/netron-browser';
 *
 * const election = createLeaderElection({
 *   lockName: 'chat-ws:user:abc123',
 *   channelName: 'chat-ws:user:abc123:bus',
 * });
 *
 * election.onRoleChange((role) => {
 *   if (role === 'leader') openWebSocket();
 *   else closeWebSocketIfOpen();
 * });
 *
 * election.onMessage((data) => applyDeltaToStore(data));
 *
 * // From a follower: send the message; leader forwards to WS.
 * // From the leader: same code path — it's locally re-dispatched.
 * election.broadcast({ kind: 'send', payload: ... });
 * ```
 */

export { createLeaderElection } from './election.js';
export { createWebLocksAdapter } from './web-locks-lock.js';
export { createBroadcastChannelAdapter } from './broadcast-channel.js';
export {
  LeaderElectionUnavailableError,
} from './types.js';
export type {
  ILeaderLock,
  ILeaderChannel,
  LeaderElectionHandle,
  LeaderElectionOptions,
  LeaderRole,
} from './types.js';
