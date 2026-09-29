/**
 * A close code that said nothing about what happens next.
 *
 * Every close code describes the past — the socket went away, the peer left,
 * the frame was bad. One describes the FUTURE: RFC 6455's 1012, «Service
 * Restart», which means «this server is coming back». It is the only code a
 * client can safely shorten its retry on, because it is the only one that
 * says the endpoint will answer again.
 *
 * This server was sending 1001, «Going Away» — the same code a BROWSER sends
 * when the page navigates. A client reading 1001 cannot tell a deployment
 * from an endpoint that is flapping, so it must assume the worse and back
 * off. Measured on the client that reads this
 * (`netron-browser`): the delay is a full-jitter draw from
 * `[1000, min(1000·2^(attempt−1), 30000)]`, so a restart of minutes leaves
 * the socket shut for up to thirty seconds after the server is answering.
 *
 * Held on the SERVER side, separately from the client's court, because
 * neither half is worth anything alone: a code nobody reads is a comment
 * with a number in it, and a client that shortened its retry unasked would
 * hammer every endpoint that ever dropped it. A plant on either side has to
 * redden SOMETHING, and only these two files together can say so.
 */
import { describe, it, expect, vi } from 'vitest';

// The class is `WebSocketServerAdapter`; `WebSocketServer` is the `ws`
// package's own, and importing that name from here yields `undefined` —
// which `Object.create` reports as «cannot read properties of undefined»,
// three frames away from the mistake.
import { WebSocketServerAdapter } from '../../../../src/netron/transport/websocket/server.js';

/** RFC 6455 §7.4.1. */
const SERVICE_RESTART = 1012;
const GOING_AWAY = 1001;

/** A socket that only records how it was closed. */
function socket() {
  return { close: vi.fn() };
}

function serverWith(clients: Array<{ close: ReturnType<typeof vi.fn> }>) {
  const srv = Object.create(WebSocketServerAdapter.prototype) as {
    close(): Promise<void>;
    wss: unknown;
  };
  Object.assign(srv, {
    wss: {
      clients: new Set(clients),
      close: (cb: (e?: Error) => void) => cb(),
    },
  });
  return srv;
}

describe('closing the websocket server', () => {
  it('tells every client the service is restarting', async () => {
    const clients = [socket(), socket(), socket()];

    await serverWith(clients).close();

    for (const c of clients) {
      expect(c.close).toHaveBeenCalledTimes(1);
      expect(c.close.mock.calls[0]![0], 'the code a client can act on').toBe(SERVICE_RESTART);
    }
  });

  it('does not send 1001, which a navigating browser also sends', async () => {
    const c = socket();

    await serverWith([c]).close();

    expect(c.close.mock.calls[0]![0]).not.toBe(GOING_AWAY);
  });

  it('carries a reason a human reads in a devtools panel', async () => {
    const c = socket();

    await serverWith([c]).close();

    expect(String(c.close.mock.calls[0]![1] ?? '')).toMatch(/restart/i);
  });

  it('closes the listener after the clients, not before', async () => {
    // Order matters: a listener closed first can drop the close frames, and
    // the client then sees 1006 — an abrupt drop — instead of the code this
    // whole change exists to deliver.
    const order: string[] = [];
    const c = { close: vi.fn(() => void order.push('client')) };
    const srv = Object.create(WebSocketServerAdapter.prototype) as { close(): Promise<void> };
    Object.assign(srv, {
      wss: {
        clients: new Set([c]),
        close: (cb: (e?: Error) => void) => {
          order.push('listener');
          cb();
        },
      },
    });

    await srv.close();

    expect(order).toEqual(['client', 'listener']);
  });
});
