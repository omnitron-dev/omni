import { RemotePeer } from '../remote-peer';

export function emit(peer: RemotePeer, eventName: string, ...args: any[]) {
  const handlers = peer.eventSubscribers.get(eventName);
  if (handlers) {
    for (const handler of handlers) {
      handler(...args);
    }
  }
}
