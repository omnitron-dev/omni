/**
 * WIRE-7: BinaryTransportAdapter maps a connection's 'disconnect' to a
 * socket-style 'close'. The IConnection contract is (reason?: string), but the
 * HTTP connection emits a richer { code, reason } object. HTTP never flows
 * through this adapter, but the disconnect→close mapping must coerce any
 * non-string reason defensively so it can NEVER throw inside Buffer.from()
 * (which rejects plain objects).
 *
 * Network-free: a minimal EventEmitter mock stands in for the connection, so
 * this lives outside the excluded transport-adapter*.spec networking suite.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { BinaryTransportAdapter } from '../../../src/netron/transport/transport-adapter.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import type { ITransportConnection } from '../../../src/netron/transport/types.js';

function mockConnection(): ITransportConnection {
  const conn = new EventEmitter() as unknown as ITransportConnection & EventEmitter;
  (conn as { state: ConnectionState }).state = ConnectionState.CONNECTED;
  return conn;
}

function captureClose(adapter: BinaryTransportAdapter): Promise<[number, Buffer]> {
  return new Promise((resolve) => {
    adapter.on('close', (code: number, data: Buffer) => resolve([code, data]));
  });
}

describe('BinaryTransportAdapter disconnect→close reason coercion (WIRE-7)', () => {
  it('passes a string reason through unchanged', async () => {
    const conn = mockConnection();
    const adapter = new BinaryTransportAdapter(conn);
    const closed = captureClose(adapter);

    (conn as unknown as EventEmitter).emit('disconnect', 'bye');

    const [code, data] = await closed;
    expect(code).toBe(1000);
    expect(data.toString()).toBe('bye');
  });

  it('coerces an object {code, reason} reason without throwing (HTTP-shaped payload)', async () => {
    const conn = mockConnection();
    const adapter = new BinaryTransportAdapter(conn);
    const closed = captureClose(adapter);

    // The HTTP connection emits this shape; Buffer.from({...}) would throw.
    (conn as unknown as EventEmitter).emit('disconnect', { code: 1000, reason: 'Normal closure' });

    const [code, data] = await closed;
    expect(code).toBe(1000);
    expect(data.toString()).toBe('Normal closure');
  });

  it('coerces a missing / non-string reason to an empty buffer', async () => {
    const conn = mockConnection();
    const adapter = new BinaryTransportAdapter(conn);
    const closed = captureClose(adapter);

    (conn as unknown as EventEmitter).emit('disconnect', undefined);

    const [, data] = await closed;
    expect(data.length).toBe(0);
  });
});
