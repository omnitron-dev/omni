/**
 * The id `node list` prints was accepted by no command, and every failure
 * exited 0.
 *
 * Measured 2026-09-23 on the live master:
 *
 *     $ omnitron node list
 *     │ 16f3dd5a  │ daos-test │ 37.27.130.185:22 │ ● up │ ● v0.2.0+l... │
 *     $ omnitron node check 16f3dd5a
 *     Failed: Node not found: 16f3dd5a            (exit 0)
 *     $ omnitron node check daos-test
 *     Failed: Node not found: daos-test           (exit 0)
 *
 * `node list` cuts each id to eight characters; `check`, `update` and
 * `remove` passed the argument through as typed. The same commands printed
 * a status whose node had been removed as a bare id — `126457d0-…: SSH ●
 * Omnitron ●` — with no age, and printed `○ offline` for a daemon no path
 * had reached. The `node list` comment sent the reader to `omnitron node
 * show` for the daemon port; there is no such command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const said: Array<{ level: string; text: string }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: {
    info: (t: string) => said.push({ level: 'info', text: t }),
    warn: (t: string) => said.push({ level: 'warn', text: t }),
    error: (t: string) => said.push({ level: 'error', text: t }),
    success: (t: string) => said.push({ level: 'success', text: t }),
    step: (t: string) => said.push({ level: 'step', text: t }),
  },
  table: (opts: { data: unknown[] }) => said.push({ level: 'table', text: JSON.stringify(opts.data) }),
}));

const DAOS_TEST = '16f3dd5a-2727-49e5-90a2-d762b57073f6';
const REMOVED = '126457d0-e6d3-4366-92f4-b149b3b6864c';

const node = (id: string, name: string, host: string, over: Record<string, unknown> = {}) => ({
  id, name, host, sshPort: 22, sshUser: 'root', sshAuthMethod: 'key', runtime: 'node',
  daemonPort: 9700, tags: [], isLocal: id === 'local', createdAt: '', updatedAt: '', status: null, ...over,
});

let registry: ReturnType<typeof node>[] = [];
let absence: unknown = null;
const nodes = {
  listNodes: vi.fn(async () => registry),
  getNode: vi.fn(async ({ id }: { id: string }) => registry.find((n) => n.id === id) ?? null),
  checkNodeStatus: vi.fn(async ({ id }: { id: string }) => ({
    nodeId: id, pingReachable: true, pingLatencyMs: 40, sshConnected: null, sshLatencyMs: null,
    omnitronConnected: true as boolean | null, omnitronVersion: '0.2.0', checkedAt: new Date().toISOString(),
  })),
  checkAllNodes: vi.fn(async () => [] as unknown[]),
  removeNode: vi.fn(async () => {}),
  updateNode: vi.fn(async (data: { id: string }) => registry.find((n) => n.id === data.id)),
  addNode: vi.fn(),
  listSshKeys: vi.fn(async () => []),
};

vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    whyUnreachable: async () => absence,
    service: async () => nodes,
    disconnect: async () => {},
  }),
}));

const { nodeCheckCommand, nodeRemoveCommand, nodeUpdateCommand, resolveNodeArgument } = await import(
  '../../src/commands/node.js'
);

const text = () => said.map((s) => s.text).join('\n');

beforeEach(() => {
  said.length = 0;
  absence = null;
  registry = [
    node('local', 'Local Machine', '127.0.0.1'),
    node(DAOS_TEST, 'daos-test', '37.27.130.185'),
  ];
  for (const fn of Object.values(nodes)) fn.mockClear();
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('the id node list prints', () => {
  it('is accepted by node check', async () => {
    await nodeCheckCommand('16f3dd5a');

    expect(nodes.checkNodeStatus).toHaveBeenCalledWith({ id: DAOS_TEST });
    expect(process.exitCode).not.toBe(1);
  });

  it('and so is the name, in any case', async () => {
    await nodeCheckCommand('daos-test');
    await nodeCheckCommand('DAOS-Test');

    expect(nodes.checkNodeStatus.mock.calls).toEqual([[{ id: DAOS_TEST }], [{ id: DAOS_TEST }]]);
  });

  it('is accepted by node remove, which names the row it deleted', async () => {
    await nodeRemoveCommand('16f3dd5a');

    expect(nodes.removeNode).toHaveBeenCalledWith({ id: DAOS_TEST });
    expect(text()).toContain(`"daos-test" (${DAOS_TEST}, 37.27.130.185) removed`);
  });

  it('is accepted by node update', async () => {
    await nodeUpdateCommand('16f3dd5a', { name: 'daos-test-2' });

    expect(nodes.updateNode).toHaveBeenCalledWith(expect.objectContaining({ id: DAOS_TEST, name: 'daos-test-2' }));
  });
});

describe('an argument that names no single node', () => {
  it('lists the candidates and fails, rather than guessing', async () => {
    registry.push(node('16f3ffff-0000-4000-8000-000000000000', 'daos-test-b', '203.0.113.9'));

    await nodeCheckCommand('16f3');

    expect(nodes.checkNodeStatus).not.toHaveBeenCalled();
    expect(text()).toContain('names 2 nodes');
    expect(text()).toContain(DAOS_TEST);
    expect(process.exitCode).toBe(1);
  });

  it('fails when it names nothing, and lists what is registered', async () => {
    await nodeRemoveCommand('nope');

    expect(nodes.removeNode).not.toHaveBeenCalled();
    expect(text()).toMatch(/No node 'nope'/);
    expect(text()).toContain('daos-test (16f3dd5a)');
    expect(process.exitCode).toBe(1);
  });

  it('prefers an exact id to a prefix of another', () => {
    const r = resolveNodeArgument('local', [
      { id: 'local', name: 'Local Machine' },
      { id: 'localbox-0001', name: 'x' },
    ]);
    expect(r).toMatchObject({ kind: 'found', node: { id: 'local' } });
  });
});

describe('what node check prints', () => {
  it('the daemon port, which nothing else prints', async () => {
    await nodeCheckCommand('16f3dd5a');

    expect(text()).toContain('37.27.130.185, SSH port 22, daemon port 9700');
  });

  it('«unknown», not «offline», when no path reached the daemon', async () => {
    nodes.checkNodeStatus.mockResolvedValueOnce({
      nodeId: DAOS_TEST, pingReachable: true, pingLatencyMs: 40, sshConnected: null, sshLatencyMs: null,
      omnitronConnected: null, omnitronVersion: undefined as never, checkedAt: new Date().toISOString(),
      omnitronError: 'Neither path reached the daemon — mesh: …; direct dial to 37.27.130.185:9700: …',
    } as never);

    await nodeCheckCommand('16f3dd5a');

    expect(text()).toContain('Omnitron: ? unknown');
    expect(text()).not.toContain('offline');
  });

  it('only registered nodes when checking all, each with the age of its reading', async () => {
    const checkedAt = new Date(Date.now() - 82 * 60_000).toISOString();
    nodes.checkAllNodes.mockResolvedValueOnce([
      { nodeId: DAOS_TEST, pingReachable: true, sshConnected: true, omnitronConnected: true, checkedAt },
      { nodeId: REMOVED, pingReachable: true, sshConnected: true, omnitronConnected: true, checkedAt },
    ]);

    await nodeCheckCommand();

    expect(text()).toContain('daos-test: SSH ●  Omnitron ●  checked 1h ago');
    expect(text()).not.toMatch(new RegExp(`^${REMOVED}:`, 'm'));
  });
});

describe('a node command that fails', () => {
  it('exits 1 when the daemon refuses the call', async () => {
    nodes.checkNodeStatus.mockRejectedValueOnce(new Error('RPC request timed out after 60000ms'));

    await nodeCheckCommand('16f3dd5a');

    expect(text()).toContain('Failed: RPC request timed out');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when there is no daemon to ask', async () => {
    absence = { kind: 'stopped' };

    await nodeCheckCommand('16f3dd5a');

    expect(nodes.listNodes).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
