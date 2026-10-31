import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { Public, Service } from '../../src/decorators/index.js';
import { createNullLogger } from '../../src/modules/logger/index.js';
import { TransportLostError } from '../../src/errors/index.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';
import type { ITransportConnection } from '../../src/netron/transport/types.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
async function bounded<T>(promise: Promise<T>, ms = 1000): Promise<T | 'pending'> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<'pending'>(r => { timer = setTimeout(() => r('pending'), ms); })]); }
  finally { clearTimeout(timer); }
}

@Service({ name: 'HandoffProbe' })
class Probe {
  writes = 0;
  entered = deferred();
  release = deferred();
  @Public()
  async write() { this.writes++; this.entered.resolve(); await this.release.promise; return this.writes; }
}

async function pair(transport: 'unix' | 'tcp') {
  const server = new Netron(createNullLogger(), { id: 'handoff-server' });
  const socket = `/tmp/netron-handoff-${randomUUID()}.sock`;
  server.registerTransportServer(transport, {name: transport, options: transport === 'unix' ? {path: socket} : {host: '127.0.0.1', port: 0}});
  await server.start();
  cleanup.push(() => server.stop());
  const address = transport === 'unix' ? `unix://${socket}` : `tcp://127.0.0.1:${(server.transportServers.get('tcp') as { port: number }).port}`;
  const client = new Netron(createNullLogger(), { id: 'handoff-client' });
  client.setTransportOptions(transport, { requestTimeout: 30_000 });
  cleanup.push(() => client.stop());
  const peer = await client.connect(address, false) as RemotePeer;
  return {server, client, peer};
}

describe.each(['unix', 'tcp'] as const)('RPC delivery during %s handoff', transport => {
  it('settles a lost reply immediately without replaying the accepted mutation', async () => {
    const {server, peer} = await pair(transport);
    const probe = new Probe();
    cleanup.push(async () => { probe.release.resolve(); });
    await server.peer.exposeService(probe);
    const service = await peer.queryInterface<Probe>('HandoffProbe');
    const outcome = service.write().then(value => value, error => error);
    await probe.entered.promise;
    await server.stop();
    const error = await bounded(outcome);
    expect(error).toBeInstanceOf(TransportLostError);
    expect(probe.writes).toBe(1);
    probe.release.resolve();
  });

  it('drains accepted tasks through their replies and explicitly refuses new work', async () => {
    const {server, peer} = await pair(transport);
    const entered = deferred(), release = deferred();
    cleanup.push(async () => { release.resolve(); });
    let calls = 0;
    server.addTask(async function checkpoint() {
      calls++; entered.resolve(); await release.promise; return {committed: calls};
    });
    const reply = peer.runTask('checkpoint');
    await entered.promise;
    let drained = false;
    const drain = server.inbound.drain(5000).then(result => { drained = result.drained; return result; });
    await Promise.resolve();
    expect(server.inbound.inflight).toBe(1);
    expect(drained).toBe(false);
    await expect(peer.runTask('checkpoint')).rejects.toMatchObject({details: {errorCode: 'SHUTTING_DOWN'}});
    expect(calls).toBe(1);
    release.resolve();
    expect(await reply).toEqual({committed: 1});
    expect(await drain).toEqual({drained: true, left: 0});
    await server.stop();
  });
});

async function handshakeEndpoint(onConnection: (socket: net.Socket) => void) {
  const sockets = new Set<net.Socket>();
  const accepted = deferred();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    accepted.resolve(); onConnection(socket);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise<void>(r => { for (const socket of sockets) socket.destroy(); server.close(() => r()); }));
  const client = new Netron(createNullLogger());
  client.setTransportOptions('tcp', {connectTimeout: 5000});
  cleanup.push(() => client.stop());
  const address = `tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  return {client, address, accepted};
}

describe('unfinished handshakes', () => {
  it('cancels the server greeting when a probe closes before the greeting is sent', async () => {
    const server = new Netron(createNullLogger());
    server.registerTransportServer('tcp', {name: 'tcp', options: {host: '127.0.0.1', port: 0}});
    await server.start(); cleanup.push(() => server.stop());
    const accepted = deferred<ReturnType<typeof vi.spyOn>>();
    const listener = server.transportServers.get('tcp')!;
    listener.on('connection', (connection: ITransportConnection) => {
      const send = vi.spyOn(connection, 'send');
      void connection.close().then(() => accepted.resolve(send));
    });
    const socket = net.connect({host: '127.0.0.1', port: (listener as {port: number}).port});
    socket.on('error', () => {});
    cleanup.push(async () => { socket.destroy(); });
    const send = await accepted.promise;
    // The production greeting timer has now either been cancelled or fired.
    await new Promise(r => setTimeout(r, 25));
    expect(send).not.toHaveBeenCalled();
    expect(server.peers.size).toBe(0);
  });

  it('reports a peer that closed before its greeting without waiting for the deadline', async () => {
    const {client, address} = await handshakeEndpoint(socket => socket.end());
    const result = client.connect(address, false).then(value => value, error => error);
    expect(await bounded(result)).toBeInstanceOf(TransportLostError);
    expect(client.peers.size).toBe(0);
  });

  it('cancels an in-progress handshake when its Netron is stopped', async () => {
    const {client, address, accepted} = await handshakeEndpoint(() => {});
    const result = client.connect(address, false).then(value => value, error => error);
    await accepted.promise;
    await client.stop();
    expect(await bounded(result)).toBeInstanceOf(TransportLostError);
    expect(client.peers.size).toBe(0);
  });

  it('keeps a replacement peer with the same identity when the old connection closes', async () => {
    const {server: previous, client} = await pair('tcp');
    const next = new Netron(createNullLogger(), {id: previous.id});
    next.registerTransportServer('tcp', {name: 'tcp', options: {host: '127.0.0.1', port: 0}});
    await next.start(); cleanup.push(() => next.stop());
    const port = (next.transportServers.get('tcp') as {port: number}).port;
    const replacement = await client.connect(`tcp://127.0.0.1:${port}`, false);
    const disconnected = vi.fn();
    client.on('peer:disconnect', disconnected);
    await previous.stop();
    await new Promise(r => setImmediate(r));
    expect(client.peers.get(previous.id)).toBe(replacement);
    expect(disconnected).not.toHaveBeenCalled();
    const probe = new Probe(); probe.release.resolve();
    await next.peer.exposeService(probe);
    expect(await (await replacement.queryInterface<Probe>('HandoffProbe')).write()).toBe(1);
  });

  it('does not reconnect after its owning Netron stops', async () => {
    const server = new Netron(createNullLogger());
    server.registerTransportServer('tcp', {name: 'tcp', options: {host: '127.0.0.1', port: 0}});
    await server.start(); cleanup.push(() => server.stop());
    const port = (server.transportServers.get('tcp') as {port: number}).port;
    const client = new Netron(createNullLogger()); cleanup.push(() => client.stop());
    await client.connect(`tcp://127.0.0.1:${port}`);
    await server.stop();
    await expect.poll(() => client.peers.size).toBe(0);
    await client.stop();
    // Restart the endpoint so an orphaned reconnect would be observable.
    server.registerTransportServer('tcp', {name: 'tcp', options: {host: '127.0.0.1', port}});
    await server.start();
    const connections = vi.fn(); server.transportServers.get('tcp')!.on('connection', connections);
    await new Promise(r => setTimeout(r, 1300));
    expect(connections).not.toHaveBeenCalled();
    expect(client.peers.size).toBe(0);
  });
});
