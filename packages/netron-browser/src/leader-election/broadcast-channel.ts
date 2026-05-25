/**
 * Browser-native channel adapter via `BroadcastChannel`.
 *
 * BroadcastChannel posts to every other listener with the same
 * channel name on the same origin — but NOT to the sender's own
 * listeners (unlike `MessageChannel`). The election layer needs
 * uniform "every broadcast is delivered to every consumer"
 * semantics, so it re-dispatches the message locally after each
 * `postMessage`. This adapter is just a thin wrapper that surfaces
 * the missing-API condition early.
 */

import type { ILeaderChannel } from './types.js';
import { LeaderElectionUnavailableError } from './types.js';

interface BroadcastChannelCtor {
  new (name: string): {
    postMessage: (data: unknown) => void;
    addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void;
    removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void;
    close: () => void;
  };
}

export function createBroadcastChannelAdapter(channelName: string): ILeaderChannel {
  const Ctor = (globalThis as { BroadcastChannel?: BroadcastChannelCtor }).BroadcastChannel;
  if (!Ctor) {
    throw new LeaderElectionUnavailableError('BroadcastChannel');
  }
  const channel = new Ctor(channelName);
  const listeners = new Set<(event: { data: unknown }) => void>();
  return {
    postMessage(data) {
      channel.postMessage(data);
    },
    onMessage(handler) {
      const listener = (event: { data: unknown }) => handler(event.data);
      listeners.add(listener);
      channel.addEventListener('message', listener);
      return () => {
        if (!listeners.delete(listener)) return;
        channel.removeEventListener('message', listener);
      };
    },
    close() {
      for (const listener of listeners) channel.removeEventListener('message', listener);
      listeners.clear();
      channel.close();
    },
  };
}
