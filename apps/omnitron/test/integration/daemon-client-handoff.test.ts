import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Interface, Netron, Public, Service } from '@omnitron-dev/titan/netron';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { createDaemonClient, createRemoteDaemonClient } from '../../src/daemon/daemon-client.js';

@Service({ name: 'OmnitronDaemon' })
class Probe {
  writes = 0;
  entered: (() => void) | undefined;
  finish: (() => void) | undefined;
  constructor(readonly generation: number) {}

  @Public()
  async ping() { return { uptime: 1, version: 'test', pid: this.generation }; }

  @Public()
  value = 0;

  @Public()
  async writeWithoutReply(): Promise<void> {
    this.writes++;
    this.entered?.();
    await new Promise<void>(resolve => { this.finish = resolve; });
  }
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe.each(['unix', 'tcp'] as const)('retained daemon service over %s', transport => {
  it('rediscovers a replaced service and retains methods and properties on the same handle', async () => {
    const socketPath = `/tmp/omni-rpc-${randomUUID()}.sock`;
    let port = 0;
    const serve = async (generation: number) => {
      const server = new Netron(createNullLogger(), { id: 'replaceable-daemon' });
      server.registerTransportServer(transport, { name: transport, options: transport === 'unix'
        ? { path: socketPath }
        : { host: '127.0.0.1', port } });
      await server.start();
      if (transport === 'tcp') port = (server.transportServers.get('tcp') as { port: number }).port;
      const probe = new Probe(generation);
      await server.peer.exposeService(probe);
      cleanup.push(async () => { probe.finish?.(); await server.stop(); });
      return { server, probe };
    };
    const first = await serve(1);
    const client = transport === 'unix' ? createDaemonClient(socketPath) : createRemoteDaemonClient('127.0.0.1', port);
    cleanup.push(() => client.disconnect());
    const service = await client.service<Probe & Interface>('OmnitronDaemon');
    const retainedPing = service.ping;
    expect((await retainedPing()).pid).toBe(1);
    service.value = 7;
    await service.waitForAssigned('value');
    expect(await service.value).toBe(7);
    await first.server.stop();
    const second = await serve(2);
    // Closing the server and observing its disconnect can land on separate
    // event-loop turns. A rejected call is acceptable; a stuck handle is not.
    await expect.poll(async () => (await retainedPing()).pid).toBe(2);
    expect(await client.service('OmnitronDaemon')).toBe(service);
    const replies = await Promise.all(Array.from({ length: 12 }, () => retainedPing()));
    expect(replies.every(reply => reply.pid === 2)).toBe(true);
    expect(second.server.peers.size).toBe(1);
    expect(await service.value).toBe(0);
    service.value = 9;
    await service.waitForAssigned('value');
    expect(second.probe.value).toBe(9);
    await client.disconnect();
    expect((await service.ping()).pid).toBe(2);
  });

  it('never replays an accepted mutation whose reply was lost', async () => {
    const socketPath = `/tmp/omni-rpc-${randomUUID()}.sock`;
    const server = new Netron(createNullLogger());
    server.registerTransportServer(transport, { name: transport, options: transport === 'unix'
      ? { path: socketPath }
      : { host: '127.0.0.1', port: 0 } });
    await server.start();
    const port = transport === 'tcp' ? (server.transportServers.get('tcp') as { port: number }).port : 0;
    const probe = new Probe(1);
    await server.peer.exposeService(probe);
    cleanup.push(async () => { probe.finish?.(); await server.stop(); });
    const client = transport === 'unix' ? createDaemonClient(socketPath) : createRemoteDaemonClient('127.0.0.1', port);
    cleanup.push(() => client.disconnect());
    const handle = await client.service<Probe>('OmnitronDaemon');
    const entered = new Promise<void>(resolve => { probe.entered = resolve; });
    const outcome = handle.writeWithoutReply().then(() => null, error => error);
    await entered;
    await server.stop();
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('daemon connection closed');
    expect(probe.writes).toBe(1);
    probe.finish?.();
    // There is no retry timer or queued write waiting for the next daemon.
    expect(await client.isReachable()).toBe(false);
    expect(probe.writes).toBe(1);
  });
});
