/**
 * WIRE-11: NetronWritableStream single guarded teardown.
 *
 * The EOS final-chunk (graceful `_final`) and the STREAM_CLOSE packet (`destroy`)
 * are mutually exclusive wire signals. Previously `_final` set `isClosed` only
 * AFTER its async final-chunk send completed, so a `destroy()` racing that
 * in-flight send also emitted a STREAM_CLOSE — the peer saw a double teardown.
 */

import { describe, it, expect, vi } from 'vitest';
import { NetronWritableStream } from '../../src/netron/streams/writable-stream.js';

function makePeer() {
  return {
    writableStreams: new Map<number, unknown>(),
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    sendStreamChunk: vi.fn(() => Promise.resolve()),
    sendPacket: vi.fn(() => Promise.resolve()),
    id: 'peer-1',
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('WIRE-11: WritableStream single guarded teardown', () => {
  it('destroy() racing _final does NOT emit both an EOS chunk and a STREAM_CLOSE', async () => {
    const peer = makePeer();
    const stream = new NetronWritableStream({ peer: peer as any, streamId: 5 });
    stream.on('error', () => {}); // swallow

    // Graceful finalization claims teardown (isClosed) before the async send.
    stream._final(() => {});
    // Abrupt destroy races the in-flight final-chunk send.
    stream.destroy(new Error('boom'));
    await tick();

    expect(peer.sendStreamChunk).toHaveBeenCalledTimes(1); // the EOS chunk went out
    expect(peer.sendPacket).not.toHaveBeenCalled(); // ...and NO STREAM_CLOSE alongside it
  });

  it('destroy() alone emits exactly one STREAM_CLOSE and is idempotent', async () => {
    const peer = makePeer();
    const stream = new NetronWritableStream({ peer: peer as any, streamId: 6 });
    stream.on('error', () => {});

    stream.destroy(new Error('x'));
    await tick();
    expect(peer.sendPacket).toHaveBeenCalledTimes(1);
    expect(peer.sendStreamChunk).not.toHaveBeenCalled();

    // A second destroy is a guarded no-op — no second close packet.
    stream.destroy();
    await tick();
    expect(peer.sendPacket).toHaveBeenCalledTimes(1);
  });

  it('graceful _final alone emits the EOS chunk and no STREAM_CLOSE', async () => {
    const peer = makePeer();
    const stream = new NetronWritableStream({ peer: peer as any, streamId: 7 });
    stream.on('error', () => {});

    stream._final(() => {});
    await tick();

    expect(peer.sendStreamChunk).toHaveBeenCalledTimes(1);
    expect(peer.sendPacket).not.toHaveBeenCalled();
  });
});
