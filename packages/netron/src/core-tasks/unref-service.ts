import { RemotePeer } from '../remote-peer';

export function unref_service(peer: RemotePeer, defId: string) {
  peer.netron.peer.unrefService(defId);
}
