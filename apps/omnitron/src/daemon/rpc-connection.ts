import { randomUUID } from 'node:crypto';
import { Interface, Netron, NETRON_EVENT_PEER_DISCONNECT, type RemotePeer } from '@omnitron-dev/titan/netron';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const CONNECT_TIMEOUT = 15_000;
const CLOSE_TIMEOUT = 1_000;

function deadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    work.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

interface Session {
  netron: Netron;
  ready: Promise<RemotePeer>;
  peer?: RemotePeer;
  closing?: Promise<void>;
  interfaces: Map<string, Promise<Interface>>;
}

/**
 * Omnitron's client lifetime is longer than a backend connection. Netron
 * owns transport, serialization and interface discovery; this adapter only
 * binds a retained service handle to the current connection on each call.
 * No invocation is retried: a lost reply may follow a committed mutation.
 */
export class RpcConnection {
  private session: Session | undefined;
  private readonly handles = new Map<string, Interface>();

  constructor(
    private readonly address: string,
    private readonly configure: (netron: Netron) => void,
  ) {}

  private async close(session: Session): Promise<void> {
    // A session owns its own Netron. Late completion/teardown can never close
    // a newer connection, even when disconnect's deadline has already expired.
    session.closing ??= deadline(session.netron.stop(), CLOSE_TIMEOUT, 'the transport did not close in time')
      .catch(() => undefined);
    await session.closing;
  }

  private current(): Session {
    const previous = this.session;
    if (previous && (!previous.peer || previous.netron.peers.get(previous.peer.id) === previous.peer)) {
      return previous;
    }
    if (previous) void this.close(previous);

    const netron = new Netron(createNullLogger(), { id: `omnitron-${process.pid}-${randomUUID()}` });
    this.configure(netron);
    const session: Session = { netron, ready: undefined!, interfaces: new Map() };
    this.session = session;
    netron.on(NETRON_EVENT_PEER_DISCONNECT, ({ peerId }: { peerId: string }) => {
      if (session.peer?.id !== peerId) return;
      // Netron removes the peer from discovery before emitting this event.
      // Settle its outstanding requests now, with transport loss rather than
      // a misleading request timeout. This never resubmits an invocation.
      session.peer.handleTransportLost('daemon connection closed');
      if (this.session === session) this.session = undefined;
      void this.close(session);
    });
    session.ready = deadline(
      netron.connect(this.address, false).then(async peer => {
        const remote = peer as RemotePeer;
        if (this.session !== session) {
          await remote.disconnect();
          throw new Error('RPC connection was closed before it became ready');
        }
        session.peer = remote;
        return remote;
      }),
      CONNECT_TIMEOUT,
      `the daemon did not complete a connection within ${CONNECT_TIMEOUT / 1000}s`,
    ).catch(error => {
      if (this.session === session) this.session = undefined;
      void this.close(session);
      throw error;
    });
    return session;
  }

  private async resolve(name: string): Promise<Interface> {
    const session = this.current();
    const peer = await session.ready;
    if (this.session !== session) throw new Error('RPC connection was closed');
    let pending = session.interfaces.get(name);
    if (!pending) {
      pending = peer.queryInterface<Interface>(name).catch(error => {
        session.interfaces.delete(name);
        throw error;
      });
      session.interfaces.set(name, pending);
    }
    const resolved = await pending;
    if (this.session !== session) throw new Error('RPC connection was closed');
    return resolved;
  }

  async service<T>(name: string): Promise<T> {
    const initial = await this.resolve(name);
    let handle = this.handles.get(name);
    if (!handle) {
      if (!initial.$def || !initial.$peer) throw new Error(`Invalid RPC interface: ${name}`);
      // Keep Netron's Interface, including properties, waitForAssigned,
      // references and stream serialization. Only the destination changes.
      const route = (operation: 'call' | 'get' | 'set') => async (_id: string, ...args: unknown[]) => {
        const current = await this.resolve(name);
        if (!current.$def || !current.$peer) throw new Error(`Invalid RPC interface: ${name}`);
        return Reflect.apply(current.$peer[operation], current.$peer, [current.$def.id, ...args]);
      };
      const operations = { call: route('call'), get: route('get'), set: route('set') };
      const peer = new Proxy(initial.$peer, {
        get: (target, property) => {
          if (property === 'call' || property === 'get' || property === 'set') return operations[property];
          return Reflect.get(target, property, target);
        },
      });
      handle = Interface.create(initial.$def, peer);
      this.handles.set(name, handle);
    }
    return handle as T;
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    // Fence first, then wait a bounded time for the handshake and teardown.
    // Retained handles remain usable for a later, explicit call.
    await deadline(session.ready, CLOSE_TIMEOUT, 'connection did not settle').catch(() => undefined);
    await this.close(session);
  }
}
