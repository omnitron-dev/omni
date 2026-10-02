/**
 * A handshake the client heard before it listened.
 *
 * Netron's server sends its `{type:'id'}` frame 10 ms after it accepts a
 * socket, and `Netron.connect()` resolves only once that frame arrives. On
 * WebSocket the frame could be delivered before anyone was listening for it:
 *
 *   - `ws` gives the bytes that arrived in the SAME read as the
 *     `101 Switching Protocols` response back to the socket with `unshift`,
 *     and the socket replays them on `process.nextTick`;
 *   - `WebSocketTransport.connect()` resolved its promise in the `open`
 *     handler, so the caller's continuation — where `Netron.connect()`
 *     attaches the handshake listener — is a microtask queued behind that
 *     tick;
 *   - the connection re-emitted the frame to no listener and it was gone.
 *
 * Two writes 10 ms apart share one read whenever the client does not read for
 * 10 ms: a GC pause, a descheduled worker, a busy neighbour. Measured on
 * 2026-10-02 with no injection at all, on a machine running 200 busy loops:
 * 4, 5 and 4 of 2400 connects hung in three runs (0 of 2400 idle); with this
 * fix, 0 of 7200.
 *
 * And because `Netron.connect()` cleared its deadline as soon as the TRANSPORT
 * was up, the lost frame left it pending forever. One 15 ms stall injected
 * into the first connect of `wire-level-decorator-authz.spec.ts` turns that
 * case red as «Test timed out in 120000ms» after 120 419 ms while the other
 * two stay green — the shape of
 * the one red of 2026-09-29 whose text was not kept, in a run that took 152 s
 * against 60 s for the run after it. The authorization gate was never reached:
 * that spec's flow, driven 1600 times under the same load with admin and
 * non-admin alternating on one client id, refused the non-admin 797 times of
 * the 797 that connected, admitted it 0 times, and lost 3 handshakes.
 *
 * The court does not depend on load. Its endpoint answers the upgrade with ONE
 * write holding the 101 response and the handshake frame together, so the
 * client receives them in one read by construction — the limit case of the
 * machine's race, made a certainty. Two earlier drafts did not manage that:
 * Netron's own server with a 20 ms busy wait after the accept, and a `ws`
 * server sending from its 'connection' callback. Against the unfixed code the
 * first went red in 4 runs of 5 and the second in 9 of 10 — and a court that is
 * sometimes green on the defect is a smaller copy of the flake it was written
 * to explain.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Netron } from '../../../../src/netron/netron.js';
import { WebSocketTransport } from '../../../../src/netron/transport/websocket/index.js';
import { ErrorCode } from '../../../../src/errors/index.js';
import { createMockLogger } from '../../test-utils.js';
import { getFreePort } from '../../../utils/index.js';
import { createServer as createNetServer, type Socket } from 'node:net';
import { createHash } from 'node:crypto';

/** What Netron's server says first — `netron.ts` writes exactly this. */
const HANDSHAKE = JSON.stringify({ type: 'id', id: 'handshake-server' });

/** RFC 6455 §1.3. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** An unmasked, final text frame — what a server sends (RFC 6455 §5.2). */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length > 125) throw new Error('the court only needs a short frame');
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

/**
 * A WebSocket endpoint built from a bare TCP server, so that what the client
 * reads is decided here and not by a scheduler. `firstWrite` is what follows
 * the 101 response IN THE SAME `write()`.
 */
async function wsEndpoint(stops: Array<() => Promise<unknown>>, firstWrite: Buffer): Promise<{ port: number; closed: Promise<void> }> {
  const port = await getFreePort('127.0.0.1');
  const sockets = new Set<Socket>();
  let markClosed!: () => void;
  const closed = new Promise<void>((resolve) => (markClosed = resolve));
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('end', () => markClosed());
    socket.once('close', () => markClosed());
    let request = '';
    const onData = (chunk: Buffer) => {
      request += chunk.toString('latin1');
      if (!request.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      const key = /sec-websocket-key:\s*(\S+)/i.exec(request)?.[1] ?? '';
      const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
      const response =
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`;
      socket.write(Buffer.concat([Buffer.from(response, 'latin1'), firstWrite]));
      // What the client says next is ignored, except a close frame (opcode
      // 0x8): that, or the socket ending, is the client letting go.
      socket.on('data', (frame: Buffer) => {
        if (frame.length > 0 && (frame[0]! & 0x0f) === 0x8) markClosed();
      });
    };
    socket.on('data', onData);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  stops.push(
    () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  );
  return { port, closed };
}

/** Settles with what happened, or says it did not settle. Never hangs the court. */
async function within<T>(ms: number, p: Promise<T>): Promise<{ settled: 'resolved' | 'rejected' | 'pending'; value?: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<{ settled: 'pending' }>((r) => {
    timer = setTimeout(() => r({ settled: 'pending' }), ms);
  });
  try {
    return await Promise.race([
      p.then(
        (value) => ({ settled: 'resolved' as const, value }),
        (value: unknown) => ({ settled: 'rejected' as const, value }),
      ),
      pending,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('a handshake the client heard before it listened', () => {
  const stops: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    while (stops.length) await stops.pop()!().catch(() => {});
  });

  it('connects when the server frame shares a read with the 101 response', async () => {
    const { port } = await wsEndpoint(stops, textFrame(HANDSHAKE));

    const client = new Netron(createMockLogger(), { id: 'handshake-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
    stops.push(() => client.stop());

    const outcome = await within(2000, client.connect(`ws://127.0.0.1:${port}`));

    expect(outcome.settled).toBe('resolved');
    expect((outcome.value as { id?: string }).id).toBe('handshake-server');
  });

  it('gives up at its deadline when the handshake never comes, and closes the socket', async () => {
    // An endpoint that accepts WebSockets and never speaks Netron. Before, the
    // deadline was cleared once the TRANSPORT was up, so this waited forever.
    const { port, closed } = await wsEndpoint(stops, Buffer.alloc(0));

    const client = new Netron(createMockLogger(), { id: 'deadline-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
    // Keyed by the transport's own name, which is what `connect()` reads.
    (client as any).transportRegistry.setOptions(new WebSocketTransport().name, { connectTimeout: 300 });
    stops.push(() => client.stop());

    const outcome = await within(2000, client.connect(`ws://127.0.0.1:${port}`));

    expect(outcome.settled).toBe('rejected');
    expect(outcome.value).toMatchObject({ code: ErrorCode.REQUEST_TIMEOUT });
    // The socket the deadline abandoned is closed, not left half-open.
    expect((await within(1000, closed)).settled).toBe('resolved');
  });
});
