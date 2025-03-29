import { RemotePeer } from '../remote-peer';

export function subscribe(peer: RemotePeer, eventName: string) {
  const fn = (...args: any[]) => peer.runTask('emit', eventName, ...args);
  peer.remoteSubscriptions.set(eventName, fn);
  peer.netron.peer.subscribe(eventName, fn);
}
