import { RemotePeer } from "./remote-peer";
import { NetronReadableStream } from "./readable-stream";
import { NetronWritableStream } from "./writable-stream";

export type StreamType = 'readable' | 'writable';

export class StreamReference {
  constructor(
    public readonly streamId: number,
    public readonly type: StreamType,
    public readonly isLive: boolean,
    public readonly peerId: string,
  ) { }

  static from(stream: NetronReadableStream | NetronWritableStream): StreamReference {
    return new StreamReference(
      stream.id,
      stream instanceof NetronWritableStream ? 'writable' : 'readable',
      stream.isLive,
      stream.peer.id
    );
  }

  static to(ref: StreamReference, peer: RemotePeer): NetronReadableStream | NetronWritableStream {
    if (ref.type === 'writable') {
      return NetronReadableStream.create(peer, ref.streamId, ref.isLive);
    } else {
      return NetronWritableStream.create(peer, undefined, ref.isLive, ref.streamId);
    }
  }
}
