import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Netron } from '../../src/netron/netron.js';
import type { NetronOptions } from '../../src/netron/types.js';
import { createNullLogger } from '../../src/modules/logger/index.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

function client(id?: string, options: NetronOptions = {}) {
  const result = new Netron(createNullLogger(), { ...options, ...(id ? { id } : {}) });
  result.setTransportOptions('websocket', { connectTimeout: 1000 });
  cleanup.push(() => result.stop());
  return result;
}

async function server(options: NetronOptions = {}, connectTimeout = 1000) {
  const netron = client('admission-server', options);
  netron.registerTransportServer('websocket', { name: 'websocket', options: { host: '127.0.0.1', port: 0, connectTimeout } });
  await netron.start();
  const listener = netron.transportServers.get('websocket')! as unknown as { port: number };
  const address = `ws://127.0.0.1:${listener.port}`;
  netron.addTask(async function echo(_peer: unknown, value: string) { return value; });
  return { netron, address };
}

async function raw(address: string) {
  const socket = new WebSocket(address);
  cleanup.push(async () => { socket.terminate(); });
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, closed };
}

describe('Netron connection admission', () => {
  it('enforces real global limits and releases capacity on disconnect', async () => {
    const { netron, address } = await server({ maxTotalConnections: 2 });
    const first = client(), second = client(), third = client();
    await first.connect(address, false); await second.connect(address, false);
    expect(netron.connectionManager.getStats().totalConnections).toBe(2);
    await expect(third.connect(address, false)).rejects.toThrow();
    await first.stop();
    await expect.poll(() => netron.connectionManager.getStats().totalConnections).toBe(1);
    const replacement = await third.connect(address, false);
    expect(await replacement.runTask('echo', 'admitted')).toBe('admitted');
    expect(netron.connectionManager.getStats().activeConnections).toBe(2);
    await netron.stop();
    expect(netron.connectionManager.getStats().totalConnections).toBe(0);
  });

  it('counts unfinished greetings and expires them without leaking capacity', async () => {
    const { netron, address } = await server({ maxTotalConnections: 1 }, 150);
    const pending = await raw(address);
    expect(netron.connectionManager.getStats().totalConnections).toBe(1);
    expect(netron.peers.size).toBe(0);
    const legitimate = client();
    await expect(legitimate.connect(address, false)).rejects.toThrow();
    await pending.closed;
    await expect.poll(() => netron.connectionManager.getStats().totalConnections).toBe(0);
    expect(await (await legitimate.connect(address, false)).runTask('echo', 'after-timeout')).toBe('after-timeout');
  });

  it.each([null, {}, '', 'a'.repeat(257), 'bad\nidentity', 'admission-server'])('refuses malformed or reserved identity %j', async id => {
    const { netron, address } = await server();
    const { socket, closed } = await raw(address);
    socket.send(JSON.stringify({ type: 'client-id', id }));
    await closed;
    expect(netron.peers.size).toBe(0);
    await expect.poll(() => netron.connectionManager.getStats().totalConnections).toBe(0);
  });

  it('does not allow a second connection to take an existing peer identity', async () => {
    const { netron, address } = await server();
    const existing = client('existing');
    const peer = await existing.connect(address, false);
    await expect.poll(() => netron.peers.has('existing')).toBe(true);
    const original = netron.peers.get('existing');
    const { socket, closed } = await raw(address);
    socket.send(JSON.stringify({ type: 'client-id', id: 'existing' }));
    await closed;
    expect(netron.peers.get('existing')).toBe(original);
    expect(await peer.runTask('echo', 'original')).toBe('original');
    expect(netron.connectionManager.getStats().totalConnections).toBe(1);
  });

  it('checks per-peer limits for outbound handles and disposes clients that never started a server', async () => {
    const first = await server();
    const second = await server(); // a replacement endpoint advertising the same identity
    const connection = client(undefined, { maxConnectionsPerPeer: 1 });
    await connection.connect(first.address, false);
    await expect(connection.connect(second.address, false)).rejects.toThrow(/limit/);
    await expect.poll(() => connection.connectionManager.getStats().totalConnections).toBe(1);
    await connection.stop();
    expect(connection.connectionManager.getStats().totalConnections).toBe(0);
  });

  it('preserves transport headers and URL parameters, with one reconnect owner', async () => {
    const { address } = await server();
    const connection = client();
    const transport = new WebSocketTransport();
    let receivedAddress: string | undefined, receivedOptions: Parameters<typeof transport.connect>[1];
    const connect = transport.connect.bind(transport);
    transport.connect = (target, options) => { receivedAddress = target; receivedOptions = options; return connect(target, options); };
    connection.registerTransport('websocket', () => transport);
    connection.setTransportOptions('websocket', { headers: { 'x-probe': 'preserved' }, reconnect: { enabled: true } });
    const target = `${address}?channel=a`;
    await connection.connect(target, false);
    expect(receivedAddress).toBe(target);
    expect(receivedOptions?.headers).toMatchObject({ 'x-probe': 'preserved', 'x-netron-id': connection.id });
    expect(receivedOptions?.reconnect?.enabled).toBe(false);
  });
});
