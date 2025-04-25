import { Writable, Readable, WritableOptions } from 'stream';

import { Uid } from './uid';
import { RemotePeer } from './remote-peer';
import { Packet, createPacket, TYPE_STREAM_ERROR } from './packet';

const uid = new Uid();

export interface NetronWritableStreamOptions extends WritableOptions {
  peer: RemotePeer;
  streamId?: number;
  isLive?: boolean;
}

export class NetronWritableStream extends Writable {
  public readonly id: number;
  public readonly peer: RemotePeer;
  private index: number = 0;
  public isLive: boolean;
  private isClosed: boolean = false; // переименованное свойство во избежание конфликта

  constructor({ peer, streamId, isLive = false, ...opts }: NetronWritableStreamOptions) {
    super({ ...opts, objectMode: true });

    this.peer = peer;
    this.isLive = isLive;
    this.id = streamId ?? uid.next();

    this.peer.writableStreams.set(this.id, this);

    this.once('close', this.cleanup);
    this.once('error', this.handleError);
  }

  /**
   * Pipes data from an AsyncIterable or Readable stream directly into this stream.
   */
  public async pipeFrom(source: AsyncIterable<any> | Readable): Promise<void> {
    try {
      for await (const chunk of source) {
        if (!this.write(chunk)) {
          await new Promise((resolve) => this.once('drain', resolve));
        }
      }
      this.end();
    } catch (error) {
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Writable _write implementation.
   */
  override _write(chunk: any, _: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      callback(new Error('Stream is already closed'));
      return;
    }

    this.peer.sendStreamChunk(this.id, chunk, this.index++, false, this.isLive)
      .then(() => callback())
      .catch((err: Error) => {
        this.peer.sendPacket(createPacket(Packet.nextId(), 1, TYPE_STREAM_ERROR, {
          streamId: this.id,
          message: err.message,
        })).finally(() => {
          callback(err);
          this.destroy(err);
        });
      });
  }

  /**
   * Writable _final implementation.
   */
  override _final(callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      callback(new Error('Stream is already closed'));
      return;
    }

    this.peer.sendStreamChunk(this.id, null, this.index, true, this.isLive)
      .then(() => callback())
      .catch((err: Error) => {
        callback(err);
        this.destroy(err);
      })
      .finally(() => this.closeStream());
  }

  /**
   * Cleanly closes the stream.
   */
  public closeStream(): void {
    if (this.isClosed) return;

    this.isClosed = true;
    this.end();
    this.cleanup();
  }

  /**
   * Overrides destroy method to handle forced closure.
   */
  public override destroy(error?: Error): this {
    if (this.isClosed) return this;

    this.isClosed = true;

    this.peer.sendStreamChunk(this.id, null, this.index, true, this.isLive)
      .catch((sendError) => {
        console.error(`Failed to send final stream chunk:`, sendError);
      })
      .finally(() => {
        super.destroy(error);
        this.cleanup();
      });

    return this;
  }

  /**
   * Removes stream references from peer.
   */
  private cleanup = () => {
    this.peer.writableStreams.delete(this.id);
  };

  /**
   * Error handling.
   */
  private handleError = (err: Error) => {
    console.error(`NetronWritableStream (id: ${this.id}) error:`, err.message);
    this.cleanup();
  };

  /**
   * Factory method for creating a NetronWritableStream with optional source.
   */
  public static create(peer: RemotePeer, source?: AsyncIterable<any> | Readable, isLive: boolean = false, streamId?: number): NetronWritableStream {
    const stream = new NetronWritableStream({ peer, streamId, isLive });

    if (source) {
      stream.pipeFrom(source);
    }

    return stream;
  }
}
