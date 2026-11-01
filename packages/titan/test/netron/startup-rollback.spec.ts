import { afterEach, describe, expect, it, vi } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { createNullLogger } from '../../src/modules/logger/index.js';
import type { ITransport } from '../../src/netron/transport/types.js';

const instances: Netron[] = [];
afterEach(async () => { for (const instance of instances.splice(0)) await instance.stop(); });
function instance() {
  const netron = new Netron(createNullLogger());
  instances.push(netron);
  return netron;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function transport(netron: Netron, name: string, create = Promise.resolve()) {
  const server = { on: vi.fn(), listen: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  const implementation = {
    name, protocols: [name], capabilities: { client: true, server: true },
    createServer: vi.fn(async () => { await create; return server; }),
  };
  netron.registerTransport(name, () => implementation as unknown as ITransport);
  netron.registerTransportServer(name, { name, options: {} });
  return { server, implementation };
}

describe('Netron startup rollback', () => {
  it('waits for a late sibling and closes every listener before rejecting startup', async () => {
    const n = instance(), gate = deferred();
    const broken = transport(n, 'broken');
    const late = transport(n, 'late', gate.promise);
    broken.server.listen.mockRejectedValueOnce(new Error('bind failed'));
    const starting = n.start();
    const rejection = expect(starting).rejects.toThrow('bind failed');
    await vi.waitFor(() => expect(broken.server.listen).toHaveBeenCalled());
    gate.resolve();
    await rejection;
    expect(broken.server.close).toHaveBeenCalledOnce();
    expect(late.server.close).toHaveBeenCalledOnce();
    expect(n.transportServers.size).toBe(0);
    expect(n.inbound.isDraining).toBe(true);
    // The same configuration can be retried after its transient failure.
    await n.start();
    expect(n.transportServers.size).toBe(2);
    expect(n.inbound.isDraining).toBe(false);
  });

  it('rolls back a failed start overlapping stop without deadlocking or double-closing', async () => {
    const n = instance(), gate = deferred();
    const listener = transport(n, 'late', gate.promise);
    listener.server.listen.mockRejectedValueOnce(new Error('bind failed'));
    const rejection = expect(n.start()).rejects.toThrow('bind failed');
    const stopping = n.stop();
    gate.resolve();
    await Promise.all([rejection, stopping]);
    expect(listener.server.close).toHaveBeenCalledOnce();
    expect(n.transportServers.size).toBe(0);
  });

  it('rejects a new start until a previous stop has released its listener', async () => {
    const n = instance(), gate = deferred();
    const listener = transport(n, 'listener');
    listener.server.close.mockImplementationOnce(() => gate.promise);
    await n.start();
    const stopping = n.stop();
    await expect(n.start()).rejects.toThrow(/stopp|already started/i);
    gate.resolve();
    await stopping;
    await n.start();
  });

  it('fails when a registered server transport becomes unavailable instead of claiming readiness', async () => {
    const n = instance();
    transport(n, 'unavailable');
    n.registerTransport('unavailable', () => { throw new Error('factory failed'); });
    await expect(n.start()).rejects.toThrow(/unavailable/);
    expect(n.transportServers.size).toBe(0);
  });

  it('rejects a server configuration whose transport was replaced with a client-only implementation', async () => {
    const n = instance();
    const listener = transport(n, 'client-only');
    listener.implementation.capabilities.server = false;
    await expect(n.start()).rejects.toThrow(/server/);
    expect(listener.implementation.createServer).not.toHaveBeenCalled();
  });

  it('keeps a failed close visible and retryable while releasing other listeners', async () => {
    const n = instance();
    const broken = transport(n, 'broken'), healthy = transport(n, 'healthy');
    broken.server.listen.mockRejectedValueOnce(new Error('bind failed'));
    broken.server.close.mockRejectedValueOnce(new Error('close failed'));
    await expect(n.start()).rejects.toThrow(/cleanup was incomplete/);
    expect(healthy.server.close).toHaveBeenCalledOnce();
    expect([...n.transportServers.keys()]).toEqual(['broken']);
    await expect(n.start()).rejects.toThrow();
    await n.stop();
    expect(broken.server.close).toHaveBeenCalledTimes(2);
    expect(n.transportServers.size).toBe(0);
    await n.start();
  });

  it('refuses starts and connections while an unstarted client is being disposed', async () => {
    const n = instance(), gate = deferred();
    vi.spyOn(n.connectionManager, 'stop').mockImplementationOnce(() => gate.promise);
    const stopping = n.stop();
    await expect(n.start()).rejects.toThrow(/stopping/i);
    await expect(n.connect('ws://127.0.0.1:1')).rejects.toThrow(/stopping/i);
    gate.resolve();
    await stopping;
    await n.start();
  });
});
