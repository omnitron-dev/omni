/**
 * Unit coverage for WebSocketClient transparent service discovery.
 *
 * The integration suite that touches a real Netron server can't be loaded
 * in this workspace yet (legacy-decorator fixtures clash with the
 * tsconfig — pre-existing infrastructure issue, separate from the
 * discovery feature itself). To keep behavioural confidence without that
 * end-to-end path, we drive WebSocketClient directly against a hand-rolled
 * MockWebSocket and a tiny in-process "server" that decodes packets, mints
 * Definitions, and answers TYPE_TASK / TYPE_CALL the same shape the real
 * server does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { WebSocketClient } from '../../src/client/ws-client.js';
import {
  Packet,
  encodePacket,
  decodePacket,
  TYPE_CALL,
  TYPE_TASK,
} from '../../src/packet/index.js';
import { Definition } from '../../src/core/definition.js';

// ─── MockWebSocket + in-process server ──────────────────────────────────────

interface ServerCallShape {
  defId: string;
  method: string;
  args: any[];
}
interface ServerTaskShape {
  name: string;
  args: any[];
}

interface MockServerOptions {
  /** Mints (or reuses) a Definition for a given service name. */
  defineService(name: string): Definition | null;
  /** Optional handler for TYPE_CALL — return the response data, throw to error. */
  call?(req: ServerCallShape): unknown;
  /** Optional handler for non-`query_interface` tasks. */
  task?(req: ServerTaskShape): unknown;
  /**
   * Drop the Netron handshake on the first connection so test teardown can
   * still exercise both paths if it wants to.
   */
  skipHandshake?: boolean;
}

class MockServer {
  private opts: MockServerOptions;
  /** Returns the response payload (already encoded) or throws. */
  taskCalls: Array<ServerTaskShape> = [];
  callCalls: Array<ServerCallShape> = [];

  constructor(opts: MockServerOptions) {
    this.opts = opts;
  }

  /** Send the JSON handshake the real server emits before binary packets. */
  handshake(): string {
    // `type: 'id'` — what titan's `netron.ts` actually sends. This said
    // 'server-id', so the client never recognised the frame, never answered
    // `client-id`, and `handshakeComplete` stayed false for the life of every
    // test here. The file's own docblock claims this double answers "the same
    // shape the real server does"; it is the one frame where it did not, and
    // it is the frame that decides whether a connection can carry a request.
    return JSON.stringify({ id: 'mock-server', type: 'id' });
  }

  /**
   * Decode a binary packet from the client and produce the response packet
   * (also binary), or `null` for fire-and-forget messages.
   */
  respond(buffer: ArrayBuffer): ArrayBuffer | null {
    const packet = decodePacket(new Uint8Array(buffer));
    const type = packet.getType();

    if (type === TYPE_TASK) {
      const [name, ...args] = packet.data as [string, ...any[]];
      this.taskCalls.push({ name, args });
      let result: unknown;
      let isError = false;
      try {
        if (name === 'query_interface') {
          const def = this.opts.defineService(args[0] as string);
          if (!def) {
            isError = true;
            result = { code: 'NOT_FOUND', message: `Service '${args[0]}' not found` };
          } else {
            result = def;
          }
        } else if (this.opts.task) {
          result = this.opts.task({ name, args });
        } else {
          result = null;
        }
      } catch (err: any) {
        isError = true;
        result = { message: err?.message ?? 'task error' };
      }
      const resp = new Packet(packet.id);
      resp.setImpulse(0);
      resp.setType(TYPE_TASK);
      if (isError) resp.setError(1);
      resp.data = result;
      return new Uint8Array(encodePacket(resp)).buffer;
    }

    if (type === TYPE_CALL) {
      const [defId, method, ...args] = packet.data as [string, string, ...any[]];
      this.callCalls.push({ defId, method, args });
      let result: unknown;
      let isError = false;
      try {
        if (this.opts.call) {
          result = this.opts.call({ defId, method, args });
        } else {
          result = null;
        }
      } catch (err: any) {
        isError = true;
        result = { code: 'NOT_FOUND', message: err?.message ?? 'call error' };
      }
      const resp = new Packet(packet.id);
      resp.setImpulse(0);
      resp.setType(TYPE_CALL);
      if (isError) resp.setError(1);
      resp.data = result;
      return new Uint8Array(encodePacket(resp)).buffer;
    }

    return null;
  }
}

let activeServer: MockServer | null = null;
/** Delays the server's id frame, so a test can look at the window between
 *  "socket open" and "server knows who we are". */
let handshakeDelayMs = 0;
/** The socket the last client opened, for asserting the client's reply. */
let lastSocket: MockWebSocket | null = null;

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  binaryType: 'blob' | 'arraybuffer' = 'arraybuffer';
  /** All client-id messages the client has emitted (for handshake assertions). */
  receivedClientHandshakes: Array<{ id: string }> = [];

  constructor(url: string) {
    super();
    this.url = url;
    lastSocket = this;
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      // Simulate the server sending its identity right after the socket opens.
      // The real one sends it on a 10ms timer, and registers its binary packet
      // handler only once we answer — so this gap is not decoration.
      const server = activeServer;
      if (!server) return;
      const emit = () =>
        this.dispatchEvent(new MessageEvent('message', { data: server.handshake() }));
      if (handshakeDelayMs > 0) setTimeout(emit, handshakeDelayMs);
      else emit();
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        this.receivedClientHandshakes.push(parsed);
      } catch {
        /* ignore */
      }
      return;
    }
    const server = activeServer;
    if (!server) return;
    const buf =
      data instanceof ArrayBuffer
        ? data
        : ArrayBuffer.isView(data)
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          : new ArrayBuffer(0);
    const reply = server.respond(buf);
    if (reply) {
      // Deliver asynchronously — production code never observes
      // synchronous responses and we want the same ordering guarantees.
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent('message', { data: reply }));
      });
    }
  }

  close(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent('close', { code, reason }));
    });
  }
}

(globalThis as any).WebSocket = MockWebSocket;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDefinition(name: string, defId: string): Definition {
  return new Definition(defId, 'mock-peer', {
    name,
    version: '1.0.0',
    methods: { add: { name: 'add' } },
  } as any);
}

function makeClient(opts: ConstructorParameters<typeof WebSocketClient>[0]): WebSocketClient {
  return new WebSocketClient({ url: 'ws://mock', reconnect: false, timeout: 200, ...opts });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('WebSocketClient — transparent service discovery', () => {
  beforeEach(() => {
    activeServer = null;
    handshakeDelayMs = 0;
    lastSocket = null;
  });

  afterEach(() => {
    activeServer = null;
    handshakeDelayMs = 0;
  });

  it('connect() waits for the handshake, not merely for the socket to open', async () => {
    // titan's `netron.ts` registers the peer's BINARY PACKET HANDLER inside the
    // listener for our `client-id` reply — `peer.init()` runs there. So until
    // the handshake completes there is nothing on the far side listening for
    // packets, and a request sent into that window waits out its full timeout
    // for an answer nobody is in a position to send.
    //
    // `connect()` used to resolve in the socket's `open` listener, one exchange
    // early. Five integration suites did the obvious thing — await connect,
    // then invoke — and timed out; the one suite that passed had
    // `await new Promise((r) => setTimeout(r, 100))` after connect, commented
    // "wait for the connection to stabilize".
    activeServer = new MockServer({ defineService: () => null });
    handshakeDelayMs = 40;

    const client = makeClient({ timeout: 2000 });
    let resolved = false;
    const connecting = client.connect().then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 15));
    expect(resolved, 'connect() resolved before the server knew who we were').toBe(false);

    await connecting;
    expect(resolved).toBe(true);
    // And the reply the server is waiting for actually went out.
    expect(lastSocket?.receivedClientHandshakes).toHaveLength(1);

    await client.disconnect();
  });

  it('is off by default — sends the bare service name as the wire defId', async () => {
    activeServer = new MockServer({
      defineService: () => null, // would fail; test asserts it is never called
      call: ({ defId }) => ({ defId }),
    });

    const client = makeClient({});
    await client.connect();
    const result = await client.invoke('calculator@1.0.0', 'add', [1, 2]);

    expect(result).toEqual({ defId: 'calculator@1.0.0' });
    expect(activeServer.taskCalls).toHaveLength(0);
    expect(activeServer.callCalls[0]?.defId).toBe('calculator@1.0.0');
    await client.disconnect();
  });

  it('explicit serviceDefinitions override discovery', async () => {
    activeServer = new MockServer({
      defineService: () => null,
      call: ({ defId }) => ({ defId }),
    });
    const explicit = new Map<string, string>([['calculator@1.0.0', 'manual-defid']]);

    const client = makeClient({
      enableServiceDiscovery: true,
      serviceDefinitions: explicit,
    });
    await client.connect();
    const result = await client.invoke('calculator@1.0.0', 'add', [1, 2]);

    expect(result).toEqual({ defId: 'manual-defid' });
    expect(activeServer.taskCalls).toHaveLength(0);
    await client.disconnect();
  });

  it('opt-in discovery resolves service@version → defId via query_interface', async () => {
    const def = makeDefinition('calculator@1.0.0', 'srv-defid-1');
    activeServer = new MockServer({
      defineService: (name) => (name === 'calculator@1.0.0' ? def : null),
      call: ({ defId }) => ({ defId }),
    });

    const client = makeClient({ enableServiceDiscovery: true });
    await client.connect();

    const result = await client.invoke('calculator@1.0.0', 'add', [1, 2]);

    expect(result).toEqual({ defId: 'srv-defid-1' });
    expect(activeServer.taskCalls).toEqual([{ name: 'query_interface', args: ['calculator@1.0.0'] }]);
    expect(activeServer.callCalls[0]?.defId).toBe('srv-defid-1');
    await client.disconnect();
  });

  it('caches the resolved defId — subsequent invokes skip query_interface', async () => {
    const def = makeDefinition('echo@1.0.0', 'srv-defid-echo');
    activeServer = new MockServer({
      defineService: () => def,
      call: ({ defId, method }) => ({ defId, method }),
    });

    const client = makeClient({ enableServiceDiscovery: true });
    await client.connect();

    await client.invoke('echo@1.0.0', 'a', []);
    await client.invoke('echo@1.0.0', 'b', []);
    await client.invoke('echo@1.0.0', 'c', []);

    expect(activeServer.taskCalls).toHaveLength(1);
    expect(activeServer.callCalls.map((c) => c.method)).toEqual(['a', 'b', 'c']);
    await client.disconnect();
  });

  it('coalesces concurrent invokes into one query_interface round-trip', async () => {
    const def = makeDefinition('user@1.0.0', 'srv-defid-user');
    activeServer = new MockServer({
      defineService: () => def,
      call: ({ defId }) => ({ defId }),
    });

    const client = makeClient({ enableServiceDiscovery: true });
    await client.connect();

    const results = await Promise.all(
      [0, 0, 0].map(() => client.invoke('user@1.0.0', 'get', []))
    );

    expect(results).toEqual([
      { defId: 'srv-defid-user' },
      { defId: 'srv-defid-user' },
      { defId: 'srv-defid-user' },
    ]);
    expect(activeServer.taskCalls).toHaveLength(1);
    await client.disconnect();
  });

  it('discoverServices() prefetches multiple defIds eagerly', async () => {
    const a = makeDefinition('a@1', 'def-a');
    const b = makeDefinition('b@1', 'def-b');
    activeServer = new MockServer({
      defineService: (name) => (name === 'a@1' ? a : name === 'b@1' ? b : null),
      call: ({ defId }) => ({ defId }),
    });

    // Note: works even with discovery off — the explicit prefetch is the
    // documented escape hatch.
    const client = makeClient({});
    await client.connect();

    const map = await client.discoverServices(['a@1', 'b@1']);

    expect(map.get('a@1')).toBe('def-a');
    expect(map.get('b@1')).toBe('def-b');
    expect(activeServer.taskCalls.map((t) => t.args[0])).toEqual(['a@1', 'b@1']);

    // Subsequent invoke should hit the populated cache, no extra task.
    activeServer.taskCalls.length = 0;
    const r = await client.invoke('a@1', 'm', []);
    expect(r).toEqual({ defId: 'def-a' });
    expect(activeServer.taskCalls).toHaveLength(0);
    await client.disconnect();
  });

  it('rejects from invoke when the server says the service is unknown (discovery on)', async () => {
    activeServer = new MockServer({ defineService: () => null });
    const client = makeClient({ enableServiceDiscovery: true });
    await client.connect();

    await expect(client.invoke('ghost@1', 'm', [])).rejects.toMatchObject({
      message: expect.stringContaining('not found'),
    });
    await client.disconnect();
  });

  it('clearDiscoveryCache() forces re-resolution on next invoke', async () => {
    let nextDefId = 'def-v1';
    const opts: MockServerOptions = {
      defineService: (name) => (name === 'svc@1' ? makeDefinition('svc@1', nextDefId) : null),
      call: ({ defId }) => ({ defId }),
    };
    activeServer = new MockServer(opts);

    const client = makeClient({ enableServiceDiscovery: true });
    await client.connect();

    expect((await client.invoke('svc@1', 'm', [])) as any).toEqual({ defId: 'def-v1' });
    expect(activeServer.taskCalls).toHaveLength(1);

    nextDefId = 'def-v2';
    client.clearDiscoveryCache();

    expect((await client.invoke('svc@1', 'm', [])) as any).toEqual({ defId: 'def-v2' });
    expect(activeServer.taskCalls).toHaveLength(2);
    await client.disconnect();
  });

  it('runTask() exposes the task primitive for non-discovery uses', async () => {
    activeServer = new MockServer({
      defineService: () => null,
      task: ({ name, args }) => ({ ack: name, count: args.length }),
    });

    const client = makeClient({});
    await client.connect();
    const out = await client.runTask('subscribe', 'topic.a', { qos: 1 });
    expect(out).toEqual({ ack: 'subscribe', count: 2 });
    await client.disconnect();
  });

  it('runTask() rejects fast when not connected', async () => {
    activeServer = new MockServer({ defineService: () => null });
    const client = makeClient({});
    // Match by message rather than identity to side-step the duplicate-class
    // hazard from cross-bundle imports inside vitest (we end up with two
    // ConnectionError classes that share a name but differ by reference).
    await expect(client.runTask('whatever')).rejects.toMatchObject({
      name: 'ConnectionError',
      message: expect.stringContaining('not connected'),
    });
  });

  it('refreshes a stale defId on Definition-not-found and retries once', async () => {
    let live = 'def-stale';
    activeServer = new MockServer({
      defineService: () => makeDefinition('svc@1', live),
      call: ({ defId }) => {
        if (defId !== live) {
          throw new Error("Definition 'old' not found");
        }
        return { defId };
      },
    });
    const client = makeClient({ enableServiceDiscovery: true });
    await client.connect();

    // First invoke populates the cache with def-stale.
    expect((await client.invoke('svc@1', 'm', [])) as any).toEqual({ defId: 'def-stale' });
    expect(activeServer.taskCalls).toHaveLength(1);

    // Server "rotates" the definition out of band; the cache still has
    // def-stale. The next call must hit the retry path and succeed.
    live = 'def-fresh';
    expect((await client.invoke('svc@1', 'm', [])) as any).toEqual({ defId: 'def-fresh' });
    // One initial + one re-discovery.
    expect(activeServer.taskCalls).toHaveLength(2);
    await client.disconnect();
  });
});
