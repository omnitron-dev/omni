import { RemotePeer } from '../remote-peer';

export function unexpose_service(peer: RemotePeer, serviceName: string) {
  return peer.netron.peer.unexposeRemoteService(peer, serviceName);
}
