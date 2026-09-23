/**
 * `omnitron remote` denied a machine the product already knew.
 *
 * Measured 2026-09-23 on the live master:
 *
 *     $ omnitron remote list
 *     No remote servers registered                        (exit 0)
 *     $ omnitron remote status daos-test
 *     Server 'daos-test' not found                        (exit 0)
 *
 * while daos-test sat in the node registry running six apps. `remote` read
 * `servers.json` alone — absent on this installation — though the merge of
 * both registries (`known-machines.ts`) was already what `fleet` used. And
 * `remote status` for a name it did know WROTE `servers.json` with the
 * result and asked only by dialling the daemon port directly, never over
 * the master's mesh, so a hardened node always read «offline».
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const said: Array<{ level: string; text: string }> = [];
const tables: unknown[][] = [];
vi.mock('@xec-sh/kit', () => ({
  log: {
    info: (t: string) => said.push({ level: 'info', text: t }),
    warn: (t: string) => said.push({ level: 'warn', text: t }),
    error: (t: string) => said.push({ level: 'error', text: t }),
    success: (t: string) => said.push({ level: 'success', text: t }),
    step: (t: string) => said.push({ level: 'step', text: t }),
  },
  table: (opts: { data: unknown[] }) => tables.push(opts.data),
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

/** `servers.json`: what it holds, and every write made to it. */
let servers: Array<Record<string, unknown>> = [];
const writes: unknown[] = [];
vi.mock('../../src/infrastructure/server-registry.js', () => ({
  ServerRegistry: class {
    list() {
      return servers;
    }
    get(alias: string) {
      return servers.find((s) => s.alias === alias) ?? null;
    }
    add(server: unknown) {
      writes.push(server);
    }
    remove() {
      return false;
    }
  },
}));

const DAOS_TEST = '16f3dd5a-2727-49e5-90a2-d762b57073f6';
const SIX_APPS = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'].map((name) => ({ name, status: 'online' }));

const nodesService = {
  listNodes: vi.fn(async () => [
    { id: 'local', name: 'Local Machine', host: '127.0.0.1', daemonPort: 9700, tags: [], isLocal: true, status: null },
    {
      id: DAOS_TEST, name: 'daos-test', host: '37.27.130.185', daemonPort: 9700, tags: ['test'], isLocal: false,
      status: { omnitronConnected: true, omnitronVersion: '0.2.0', checkedAt: new Date().toISOString() },
    },
  ]),
  getMeshStatus: vi.fn(async () => [
    { nodeId: DAOS_TEST, inMesh: true, status: 'connected', via: 'ssh-tunnel', authenticated: true, lastHeartbeat: 1, lastError: null },
  ]),
  getNodeDaemonStatus: vi.fn(async ({ nodeId }: { nodeId: string }) => ({
    nodeId, reachable: true, error: null,
    answer: { version: '0.2.0', pid: 1186017, uptime: 3_000_000, apps: SIX_APPS, totalCpu: 1, totalMemory: 1 },
  })),
};

/** Every direct dial, and what the far end does with it. */
const dials: string[] = [];
let directAnswers = false;

vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    isReachable: async () => true,
    whyUnreachable: async () => null,
    service: async () => nodesService,
    disconnect: async () => {},
  }),
  createRemoteDaemonClient: (host: string, port: number) => ({
    async service() {
      dials.push(`${host}:${port}`);
      if (!directAnswers) throw new Error(`Connection timeout to tcp://${host}:${port} via tcp`);
      return {
        status: async () => ({ version: '0.2.0', pid: 42, uptime: 1000, apps: [], totalCpu: 0, totalMemory: 0 }),
      };
    },
    async disconnect() {},
  }),
}));

const { remoteListCommand, remoteStatusCommand, remoteRemoveCommand } = await import('../../src/commands/remote.js');

const text = () => said.map((s) => s.text).join('\n');

beforeEach(() => {
  said.length = 0;
  tables.length = 0;
  writes.length = 0;
  dials.length = 0;
  servers = [];
  directAnswers = false;
  for (const fn of Object.values(nodesService)) fn.mockClear();
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('remote list', () => {
  it('lists a machine only the node registry holds', async () => {
    await remoteListCommand();

    expect(text()).not.toMatch(/No remote/);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toEqual([
      expect.objectContaining({ alias: 'daos-test', host: '37.27.130.185:9700', registry: 'nodes', status: '● v0.2.0' }),
    ]);
  });
});

describe('remote status', () => {
  it('answers for a node-registry machine, through the mesh', async () => {
    await remoteStatusCommand('daos-test');

    expect(nodesService.getNodeDaemonStatus).toHaveBeenCalledWith({ nodeId: DAOS_TEST });
    expect(text()).toContain('daos-test (37.27.130.185:9700) — online');
    expect(text()).toContain('main(online), storage(online), priceverse(online), paysys(online), messaging(online), geo(online)');
    expect(process.exitCode).not.toBe(1);
  });

  it('does not write servers.json — a status is a read', async () => {
    servers = [{ alias: 'prod-1', host: '198.51.100.4', port: 9700, tags: [], status: 'unknown', lastSeen: 0 }];
    directAnswers = true;

    await remoteStatusCommand('prod-1');

    expect(dials).toEqual(['198.51.100.4:9700']);
    expect(writes).toEqual([]);
  });

  it('fails, naming what is known, for a name nothing holds', async () => {
    await remoteStatusCommand('nope');

    expect(text()).toMatch(/No machine 'nope'/);
    expect(text()).toContain('daos-test (37.27.130.185:9700)');
    expect(process.exitCode).toBe(1);
  });

  it('fails when the machine does not answer', async () => {
    servers = [{ alias: 'prod-1', host: '198.51.100.4', port: 9700, tags: [], status: 'unknown', lastSeen: 0 }];

    await remoteStatusCommand('prod-1');

    expect(text()).toMatch(/no answer: Connection timeout/);
    expect(process.exitCode).toBe(1);
  });
});

describe('remote remove', () => {
  it('points a node-registry name at the command that removes it, and fails', async () => {
    await remoteRemoveCommand('daos-test');

    expect(text()).toContain(`omnitron node remove ${DAOS_TEST}`);
    expect(process.exitCode).toBe(1);
  });
});
