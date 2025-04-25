import { RemotePeer } from '../remote-peer';
import { NetronReadableStream } from '../readable-stream';

export function create_stream(peer: RemotePeer, streamId: number, isLive?: boolean) {
  return NetronReadableStream.create(peer, streamId, isLive);
}
