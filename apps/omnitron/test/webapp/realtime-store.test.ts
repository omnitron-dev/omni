/**
 * The realtime store's shared WebSocket, and the deploy rows it keeps.
 *
 * The socket is a module-level singleton behind a refcount: several pages
 * mount at once, each calls `initialize()`, and only the last cleanup may
 * take the socket down. What is pinned here is mostly what must NOT happen —
 * a release counted twice, or a row whose lifetime is measured against the
 * wrong machine's clock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Handler = (event: unknown) => void;

/** A stand-in for the socket, recording what the store does to it. */
const socket = {
  handlers: new Map<string, Handler>(),
  connects: 0,
  disconnects: 0,
  on(channel: string, handler: Handler) {
    socket.handlers.set(channel, handler);
    return () => socket.handlers.delete(channel);
  },
  onConnection(_handler: (c: boolean) => void) {
    return () => {};
  },
  connect() {
    socket.connects += 1;
  },
  disconnect() {
    socket.disconnects += 1;
  },
};

vi.mock('../../webapp/src/netron/ws-client.js', () => ({
  getDaemonWsClient: () => socket,
}));

/** A fresh module instance, so the module-level refcount starts at zero. */
async function freshStore() {
  vi.resetModules();
  socket.handlers.clear();
  socket.connects = 0;
  socket.disconnects = 0;
  const mod = await import('../../webapp/src/stores/realtime.store.js');
  return mod.useRealtimeStore;
}

describe('realtime store — shared socket', () => {
  it('connects once however many consumers initialise', async () => {
    const store = await freshStore();

    const releaseA = store.getState().initialize();
    const releaseB = store.getState().initialize();

    expect(socket.connects).toBe(1);

    releaseA();
    // One consumer left: the socket must stay up. This is the regression the
    // refcount exists for — a page unmounting used to disconnect everyone.
    expect(socket.disconnects).toBe(0);

    releaseB();
    expect(socket.disconnects).toBe(1);
  });

  it('ignores a release that runs twice', async () => {
    // A cleanup called twice must not decrement twice: the second call would
    // drop the count below the number of live consumers and tear the socket
    // down under whoever is left. Clamping the count at zero hides that
    // rather than preventing it.
    const store = await freshStore();

    const releaseA = store.getState().initialize();
    const releaseB = store.getState().initialize();

    releaseA();
    releaseA();

    expect(socket.disconnects).toBe(0);

    releaseB();
    expect(socket.disconnects).toBe(1);
  });

  it('reconnects after the last consumer has gone', async () => {
    const store = await freshStore();

    store.getState().initialize()();
    expect(socket.disconnects).toBe(1);

    store.getState().initialize();
    expect(socket.connects).toBe(2);
  });
});

describe('realtime store — deploy progress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const progress = (over: Record<string, unknown> = {}) => ({
    channel: 'stack.deploy_progress',
    timestamp: 1_000, // the daemon's clock, deliberately unlike the browser's
    data: { node: 'n1', app: 'main', status: 'running', progress: 50, message: 'copying', ...over },
  });

  async function withDeployHandler() {
    const store = await freshStore();
    store.getState().initialize();
    const handler = socket.handlers.get('stack.*')!;
    return { store, handler };
  }

  it('keeps one row per node/app pair', async () => {
    const { store, handler } = await withDeployHandler();

    handler(progress());
    handler(progress({ progress: 80 }));
    handler(progress({ node: 'n2' }));

    const rows = store.getState().deployProgress;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.node === 'n1')!.progress).toBe(80);
  });

  it('measures the retention window against this browser, not the daemon', async () => {
    // `timestamp` is the daemon's clock. Measuring the window as
    // `Date.now() - timestamp` made every row from a daemon a minute behind
    // arrive already expired, and rows from one running ahead immortal —
    // and neither reads as a clock problem from the console.
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { store, handler } = await withDeployHandler();

    handler(progress({ status: 'success' }));
    expect(store.getState().activeDeployProgress()).toHaveLength(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:31Z'));
    expect(store.getState().activeDeployProgress()).toHaveLength(0);
  });

  it('keeps an unfinished row however old it is', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { store, handler } = await withDeployHandler();

    handler(progress({ status: 'running' }));

    vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
    expect(store.getState().activeDeployProgress()).toHaveLength(1);
  });

  it('drops a finished row on read, without waiting for another event', async () => {
    // The raw array is only pruned when the next event arrives, and a
    // deploy's LAST event is the terminal one — so a finished row would sit
    // there until something unrelated happened.
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { store, handler } = await withDeployHandler();

    handler(progress({ status: 'failed' }));
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));

    expect(store.getState().deployProgress).toHaveLength(1);
    expect(store.getState().activeDeployProgress()).toHaveLength(0);
  });
});
