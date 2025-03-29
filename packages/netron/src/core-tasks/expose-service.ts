import { ServiceMetadata } from '../types';
import { RemotePeer } from '../remote-peer';

export function expose_service(peer: RemotePeer, meta: ServiceMetadata) {
  return peer.netron.peer.exposeRemoteService(peer, meta);
}
