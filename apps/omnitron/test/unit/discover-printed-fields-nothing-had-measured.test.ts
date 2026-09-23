/**
 * `omnitron discover` printed fields nothing had measured.
 *
 * Measured 2026-09-23 on the master: all twelve containers `discovered` —
 * in red, in a TTY — with `PORT 0` and id `docker:daos-`; «SSH Nodes» listed
 * `127.0.0.1:9700`, the master itself, and not daos-test; the tables printed
 * before the box meant to hold them, under their own headers.
 *
 *   - discovery.service.ts mapped xec's docker scan with `status:
 *     'discovered'` and `port: t.port ?? 0` (the scan carries neither);
 *   - it probed port 9700 on the hosts of the control-plane table (one row:
 *     the master) and dropped every host that did not answer;
 *   - discover.ts coloured against `running` / `reachable`, values that never
 *     arrived, cut the synthetic id `docker:<name>` to twelve characters, and
 *     advised `omnitron remote add`, a registry it does not read.
 */

import net from 'node:net';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Everything printed, in order: log lines and tables alike. */
const out: Array<{ kind: 'log' | 'table'; level?: string; text?: string; rows?: Array<Record<string, unknown>> }> = [];
vi.mock('@xec-sh/kit', () => {
  const paint = (colour: string) => (s: string) => `<${colour}>${s}`;
  return {
    log: {
      info: (t: string) => out.push({ kind: 'log', level: 'info', text: t }),
      warn: (t: string) => out.push({ kind: 'log', level: 'warn', text: t }),
      error: (t: string) => out.push({ kind: 'log', level: 'error', text: t }),
      success: (t: string) => out.push({ kind: 'log', level: 'success', text: t }),
    },
    table: (opts: { data: Array<Record<string, unknown>> }) => out.push({ kind: 'table', rows: opts.data }),
    box: (text: string) => out.push({ kind: 'log', level: 'box', text }),
    prism: { green: paint('green'), red: paint('red'), yellow: paint('yellow'), dim: paint('dim'), bold: paint('bold'), cyan: paint('cyan') },
  };
});

const containers = [
  {
    name: 'daos-dev-postgres', image: 'imresamu/postgis:17-3.5-alpine', status: 'running', containerId: 'abc123def456',
    health: 'healthy', ports: { '5432/tcp': 5432 }, service: 'postgres', project: 'daos', stack: 'dev',
  },
  {
    name: 'daos-dev-tiles', image: 'nginx:alpine', status: 'exited', containerId: '0f0f0f0f0f0f',
    health: 'none', service: 'tiles', project: 'daos', stack: 'dev',
  },
];
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  listManagedContainers: async () => containers,
}));

const DAOS_TEST = '16f3dd5a-2727-49e5-90a2-d762b57073f6';
let absence: unknown = null;
let registered: unknown[] = [];
const nodesService = {
  listNodes: async () => registered,
  getMeshStatus: async () => [
    { nodeId: DAOS_TEST, inMesh: true, status: 'connected', via: 'ssh-tunnel', authenticated: true, lastHeartbeat: Date.now() - 5_000, lastError: null },
  ],
};
vi.mock('../../src/daemon/daemon-client.js', async () => {
  const { DiscoveryService } = await import('../../src/services/discovery.service.js');
  const discovery = new DiscoveryService({ listNodes: async () => [] } as never);
  return {
    createDaemonClient: () => ({
      whyUnreachable: async () => absence,
      service: async (name: string) => (name === 'OmnitronDiscovery' ? discovery : nodesService),
      disconnect: async () => {},
    }),
  };
});

const { discoverCommand } = await import('../../src/commands/discover.js');
const { DiscoveryService } = await import('../../src/services/discovery.service.js');

const node = (id: string, name: string, host: string, isLocal = false) => ({
  id, name, host, sshPort: 22, daemonPort: 9700, isLocal, tags: [],
  status: { omnitronConnected: true, omnitronVersion: '0.2.0', checkedAt: new Date().toISOString() },
});

const tables = () => out.filter((o) => o.kind === 'table').map((o) => o.rows!);
const lines = () => out.filter((o) => o.kind === 'log').map((o) => o.text!).join('\n');

beforeEach(() => {
  out.length = 0;
  absence = null;
  registered = [node('local', 'Local Machine', '127.0.0.1', true), node(DAOS_TEST, 'daos-test', '37.27.130.185')];
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('the containers', () => {
  it('carry their real state, health, published ports and container id', async () => {
    await discoverCommand();

    const [rows] = tables();
    expect(rows).toEqual([
      { name: 'daos-dev-postgres', stack: 'daos/dev', state: '<green>running', health: '<green>healthy', ports: '5432→5432/tcp', id: 'abc123def456' },
      { name: 'daos-dev-tiles', stack: 'daos/dev', state: '<red>exited', health: '<dim>-', ports: '-', id: '0f0f0f0f0f0f' },
    ]);
  });

  it('come from the service with the same fields', async () => {
    const [first] = await new DiscoveryService({ listNodes: async () => [] } as never).discoverContainers();

    expect(first).toMatchObject({ id: 'abc123def456', status: 'running', port: 5432, metadata: { ports: { '5432/tcp': 5432 }, health: 'healthy' } });
  });
});

describe('the nodes', () => {
  it('are the registered ones, with how the mesh reaches each', async () => {
    await discoverCommand();

    const [, rows] = tables();
    expect(rows).toEqual([
      expect.objectContaining({ name: 'daos-test', address: '37.27.130.185:9700', reached: '<green>mesh via ssh-tunnel, authenticated' }),
    ]);
    // The master is the machine doing the discovering, not a node it found.
    expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
  });

  it('point at the registry this command reads when there are none', async () => {
    registered = [node('local', 'Local Machine', '127.0.0.1', true)];

    await discoverCommand();

    expect(lines()).toContain('omnitron node add');
    expect(lines()).not.toContain('remote add');
  });
});

describe('the layout', () => {
  it('says what each table is before it, not after', async () => {
    await discoverCommand();

    const kinds = out.map((o) => (o.kind === 'table' ? 'TABLE' : o.text));
    const containersAt = kinds.findIndex((k) => typeof k === 'string' && k.includes('Containers on this machine (2)'));
    const nodesAt = kinds.findIndex((k) => typeof k === 'string' && k.includes('Registered nodes (1)'));
    expect(kinds[containersAt + 1]).toBe('TABLE');
    expect(kinds[nodesAt + 1]).toBe('TABLE');
    expect(out.some((o) => o.level === 'box')).toBe(false);
  });
});

describe('the control-plane probe', () => {
  it('reports a member that did not answer, instead of dropping it', async () => {
    // A port that was open a moment ago and is closed now: refused at once.
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const scan = await new DiscoveryService({
      listNodes: async () => [{ address: '127.0.0.1', port, hostname: 'gone', role: 'follower' }],
    } as never).scanAll();

    expect(scan.ssh).toEqual([
      expect.objectContaining({ name: 'gone', address: '127.0.0.1', port, status: 'unreachable' }),
    ]);
  });
});
