/**
 * WIRE-1 (DoS) regression — the TCP/Unix length-prefix framing layer must
 * reject an oversized DECLARED packet length BEFORE buffering the body.
 *
 * `TcpConnection.processBuffer` reads a 4-byte big-endian length and then waits
 * for that many bytes. The `decodePacket` size cap only fires once a full frame
 * is assembled, so before this fix a peer could pin up to ~4 GiB of memory by
 * declaring a huge length (`readUInt32BE` is unbounded) and dribbling — or never
 * completing — the frame. The framing layer must enforce `maxPacketSize` itself.
 *
 * Self-contained on purpose: this file deliberately does NOT import the shared
 * transport test-utils (which transitively pull the extracted redis module and
 * are why `tcp-transport.spec.ts` is excluded from the suite). A minimal
 * in-memory socket stand-in drives `processBuffer` deterministically.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { TcpConnection } from '../../../src/netron/transport/tcp-transport.js';
import { DEFAULT_MAX_PACKET_SIZE } from '../../../src/netron/packet/index.js';
import { ErrorCode } from '../../../src/errors/index.js';

function makeMockSocket(): any {
  let destroyed = false;
  const sock: any = new EventEmitter();
  sock.readyState = 'open';
  sock.setNoDelay = () => {};
  sock.setKeepAlive = () => {};
  sock.setTimeout = () => {};
  sock.write = () => true;
  sock.destroy = () => {
    destroyed = true;
  };
  sock.remoteAddress = '127.0.0.1';
  sock.remotePort = 1234;
  sock.localAddress = '127.0.0.1';
  sock.localPort = 5678;
  Object.defineProperty(sock, 'destroyed', { get: () => destroyed });
  return sock;
}

describe('TCP framing — packet-size cap (WIRE-1 DoS)', () => {
  it('rejects + destroys on an oversized DECLARED length, without buffering the body', () => {
    const sock = makeMockSocket();
    const conn = new TcpConnection(sock, {}); // default 16 MiB cap
    const errors: any[] = [];
    conn.on('error', (e) => errors.push(e));

    // A 4-byte header declaring a body far larger than the cap — and NO body.
    // Before the fix this buffered indefinitely awaiting ~16 MiB+.
    const header = Buffer.alloc(4);
    header.writeUInt32BE(DEFAULT_MAX_PACKET_SIZE + 1, 0);
    sock.emit('data', header);

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    expect(sock.destroyed).toBe(true);
  });

  it('rejects the 0xFFFFFFFF (~4 GiB) declared-length attack', () => {
    const sock = makeMockSocket();
    const conn = new TcpConnection(sock, {});
    const errors: any[] = [];
    conn.on('error', (e) => errors.push(e));

    sock.emit('data', Buffer.from([0xff, 0xff, 0xff, 0xff]));

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    expect(sock.destroyed).toBe(true);
  });

  it('does NOT error on a within-cap declared length awaiting more data', () => {
    const sock = makeMockSocket();
    const conn = new TcpConnection(sock, {});
    const errors: any[] = [];
    conn.on('error', (e) => errors.push(e));

    const header = Buffer.alloc(4);
    header.writeUInt32BE(100, 0); // small, within cap
    sock.emit('data', header); // only the header; body still pending
    sock.emit('data', Buffer.alloc(50)); // partial body

    expect(errors).toHaveLength(0);
    expect(sock.destroyed).toBe(false);
  });

  it('honors a custom (smaller) maxPacketSize at the framing layer', () => {
    const sock = makeMockSocket();
    const conn = new TcpConnection(sock, { maxPacketSize: 1024 });
    const errors: any[] = [];
    conn.on('error', (e) => errors.push(e));

    const header = Buffer.alloc(4);
    header.writeUInt32BE(2048, 0); // exceeds the 1 KiB cap
    sock.emit('data', header);

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    expect(sock.destroyed).toBe(true);
  });
});
