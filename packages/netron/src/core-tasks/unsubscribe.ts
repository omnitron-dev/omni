import { RemotePeer } from '../remote-peer';

export function unsubscribe(peer: RemotePeer, eventName: string) {
  const fn = peer.remoteSubscriptions.get(eventName);
  if (fn) {
    peer.netron.peer.unsubscribe(eventName, fn);
    peer.remoteSubscriptions.delete(eventName);
  }
}
