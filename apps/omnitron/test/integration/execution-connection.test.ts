import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { Netron, Public, Service } from '@omnitron-dev/titan/netron';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionClient } from '../../src/daemon/execution-client.js';
import { runtimeDiagnostics } from '../../src/monitoring/runtime-diagnostics.js';

@Service({ name: 'OmnitronExecution' })
class Owner {
  snapshots: unknown[] = [];
  acknowledgments = 0;
  mutations = 0;
  unavailable = false;
  rejectAck = false;
  revision = 0;
  constructor(readonly id: string) {}

  @Public()
  async snapshot(input?: { afterEvent?: number }) {
    this.snapshots.push(input);
    if (this.unavailable) throw new Error('Owner observation fixture is unavailable');
    return { protocol: 1, revision: ++this.revision,
      status: { owner: { id: this.id, pid: process.pid, startedAt: new Date().toISOString() },
        controller: { ownerId: this.id, controllerId: 'test', epoch: 1 }, phase: 'active' },
      apps: [], workers: [], events: [], acknowledgedEvent: 0, lastEvent: 0, droppedEvents: 0,
      inventoryDigest: 'fixture', devMode: false, watchedApps: [], watchEnabled: false };
  }

  @Public()
  async acknowledge() {
    this.acknowledgments++;
    if (this.rejectAck) throw new Error('Controller acknowledgment was refused');
  }

  @Public()
  async mutate() { this.mutations++; return { value: null, snapshot: await this.snapshot() }; }
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  runtimeDiagnostics.resolve('execution.observation-unavailable');
  runtimeDiagnostics.resolve('execution.acknowledgment-unavailable');
});

async function fixture() {
  const directory = await fs.mkdtemp('/tmp/omni-owner-rpc-');
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const socket = path.join(directory, 'owner.sock');
  const serve = async () => {
    const owner = new Owner(randomUUID());
    const server = new Netron(createNullLogger());
    server.registerTransportServer('unix', { name: 'owner', options: { path: socket, mode: 0o600 } });
    await server.peer.exposeService(owner);
    await server.start();
    cleanup.push(() => server.stop());
    return { owner, server };
  };
  const first = await serve();
  const client = new ExecutionClient(socket, createNullLogger());
  cleanup.push(() => client.close());
  await client.connect();
  // White-box access is confined to the fixture: no diagnostic API can drop
  // a production channel or manufacture a controller grant.
  const internals = client as unknown as {
    refresh(): Promise<void>;
    grant: { ownerId: string; controllerId: string; epoch: number };
    connection: { disconnect(): Promise<void> };
    observations: { disconnect(): Promise<void> };
  };
  internals.grant = { ownerId: first.owner.id, controllerId: 'test', epoch: 1 };
  return { ...first, client, internals, serve, socket };
}

it('recovers observation failures without changing controller ownership and distinguishes failed acknowledgments', async () => {
  const { owner, client, internals } = await fixture();
  await client.activateObservations();
  const before = client.state();
  owner.unavailable = true;
  await internals.refresh();
  expect(client.state()?.connection).toMatchObject({ status: 'unavailable', error: expect.stringContaining('unavailable') });
  owner.unavailable = false;
  owner.rejectAck = true;
  await internals.refresh();
  expect(client.state()?.connection).toMatchObject({ status: 'connected', error: null });
  expect(runtimeDiagnostics.snapshot().active.map(item => item.event.id)).toContain('execution.acknowledgment-unavailable');
  expect(runtimeDiagnostics.snapshot().active.map(item => item.event.id)).not.toContain('execution.observation-unavailable');
  owner.rejectAck = false;
  await internals.connection.disconnect();
  await internals.observations.disconnect();
  await internals.refresh();
  expect(client.state()?.owner.id).toBe(before?.owner.id);
  expect(client.state()?.epoch).toBe(before?.epoch);
  expect(runtimeDiagnostics.snapshot().active.map(item => item.event.id)).not.toContain('execution.acknowledgment-unavailable');
});

it('rejects another owner at the same address before sending an old cursor, acknowledgment or mutation', async () => {
  const { server, client, internals, serve } = await fixture();
  await client.activateObservations();
  await Promise.all([internals.connection.disconnect(), internals.observations.disconnect()]);
  await server.stop();
  const replacement = await serve();
  await internals.refresh();
  expect(client.state()?.connection.status).toBe('owner-changed');
  expect(replacement.owner.snapshots).toEqual([undefined]);
  expect(replacement.owner.acknowledgments).toBe(0);
  await expect(client.shutdownOwner()).rejects.toThrow('identity changed');
  expect(replacement.owner.mutations).toBe(0);
  expect(() => client.orchestrator.list()).toThrow('inventory is stale');
});

it('revalidates socket permissions on reconnect before making an RPC', async () => {
  const { owner, client, internals, socket } = await fixture();
  await Promise.all([internals.connection.disconnect(), internals.observations.disconnect()]);
  const before = owner.snapshots.length;
  await fs.chmod(socket, 0o666);
  await internals.refresh();
  expect(client.state()?.connection.status).toBe('unavailable');
  expect(owner.snapshots).toHaveLength(before);
  await fs.chmod(socket, 0o600);
  await internals.refresh();
  expect(client.state()?.connection.status).toBe('connected');
});
