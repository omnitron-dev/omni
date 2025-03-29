import { RemotePeer } from '../remote-peer';
import { ReadableStream } from '../readable-stream';

export function create_stream(peer: RemotePeer, streamId: number, isLive?: boolean) {
  return ReadableStream.create(peer, streamId, isLive);
}
