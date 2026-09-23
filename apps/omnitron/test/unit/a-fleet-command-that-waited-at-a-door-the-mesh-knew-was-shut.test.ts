/**
 * Every fleet command waited five seconds at a door the master knew was shut.
 *
 * Measured twice on 2026-09-23: `fleet status`, `fleet health` and `fleet
 * metrics` took 6.2–6.9 s for one node, and the direct dial to
 * `37.27.130.185:9700` failed at 5.0 s each time before the question went
 * over the mesh and was answered. The master's own mesh reached that node
 * `via: ssh-tunnel` — its finding that the port is closed to it — and
 * `askMachine` dialled first anyway, for every node, on every command.
 * (`RemoteDaemonClient` has no connect deadline of its own; the five seconds
 * are the transport's.)
 *
 * A node the mesh reaches through a tunnel is asked over the mesh first; the
 * dial stays first for everything else, and remains the last resort.
 */

import { describe, it, expect } from 'vitest';

import { MeshAsker, askMachine } from '../../src/commands/fleet-asking.js';

const STATUS = { apps: [{ name: 'main' }], totalCpu: 1, totalMemory: 2 };
const NODE = '16f3dd5a-2727-49e5-90a2-d762b57073f6';

/** A daemon port that answers — or holds the caller for as long as it takes to say no. */
const dialer = (behaviour: 'answers' | 'times out', seen: string[]) =>
  ((host: string, port: number) => ({
    async service() {
      seen.push(`${host}:${port}`);
      if (behaviour === 'times out') throw new Error(`Connection timeout to tcp://${host}:${port} via tcp`);
      return { status: async () => STATUS };
    },
    async disconnect() {},
  })) as never;

/** The local daemon: the mesh as it stands, and a relay that answers or not. */
function localDaemon(
  via: 'direct' | 'ssh-tunnel' | null,
  relay: 'answers' | 'fails',
  calls: string[],
  status: 'connected' | 'connecting' = 'connected',
) {
  return (() => ({
    async isReachable() {
      return true;
    },
    async service() {
      return {
        async getMeshStatus() {
          calls.push('getMeshStatus');
          return [{ nodeId: NODE, inMesh: true, status, via, authenticated: true, lastHeartbeat: 1, lastError: null }];
        },
        async getNodeDaemonStatus({ nodeId }: { nodeId: string }) {
          calls.push(`relay:${nodeId}`);
          return relay === 'answers'
            ? { nodeId, reachable: true, error: null, answer: STATUS }
            : { nodeId, reachable: false, error: 'Slave 37.27.130.185:9700 not connected', answer: null };
        },
      };
    },
    async disconnect() {},
  })) as never;
}

const machine = { host: '37.27.130.185', port: 9700, nodeId: NODE };

describe('a node the mesh reaches through a tunnel', () => {
  it('is asked over the mesh, and its shut port is not dialled', async () => {
    const dials: string[] = [];
    const calls: string[] = [];

    const r = await askMachine(machine, 'status', new MeshAsker(localDaemon('ssh-tunnel', 'answers', calls)), dialer('times out', dials));

    expect(r.via).toBe('mesh');
    expect(r.value).toEqual(STATUS);
    expect(dials).toEqual([]);
  });

  it('is dialled as the last resort when the mesh cannot answer, and the mesh is not asked twice', async () => {
    const dials: string[] = [];
    const calls: string[] = [];

    const r = await askMachine(machine, 'status', new MeshAsker(localDaemon('ssh-tunnel', 'fails', calls)), dialer('times out', dials));

    expect(dials).toEqual(['37.27.130.185:9700']);
    expect(calls.filter((c) => c.startsWith('relay:'))).toHaveLength(1);
    expect(r.via).toBeNull();
    expect(r.error).toMatch(/not connected/);
  });

  it('is answered directly if the port did open, after the mesh could not', async () => {
    const dials: string[] = [];

    const r = await askMachine(machine, 'status', new MeshAsker(localDaemon('ssh-tunnel', 'fails', [])), dialer('answers', dials));

    expect(r.via).toBe('direct');
  });
});

describe('everything else keeps the dial first', () => {
  it('a node the mesh reaches directly', async () => {
    const dials: string[] = [];
    const calls: string[] = [];

    const r = await askMachine(machine, 'status', new MeshAsker(localDaemon('direct', 'answers', calls)), dialer('answers', dials));

    expect(r.via).toBe('direct');
    expect(dials).toEqual(['37.27.130.185:9700']);
    expect(calls).not.toContain(`relay:${NODE}`);
  });

  it('a node whose tunnel is still connecting', async () => {
    const dials: string[] = [];

    await askMachine(machine, 'status', new MeshAsker(localDaemon('ssh-tunnel', 'answers', [], 'connecting')), dialer('answers', dials));

    expect(dials).toEqual(['37.27.130.185:9700']);
  });
});

describe('the mesh as it stands', () => {
  it('is read once per command, for every machine', async () => {
    const calls: string[] = [];
    const mesh = new MeshAsker(localDaemon('ssh-tunnel', 'answers', calls));

    for (let i = 0; i < 3; i++) await askMachine(machine, 'status', mesh, dialer('times out', []));
    await mesh.close();

    expect(calls.filter((c) => c === 'getMeshStatus')).toHaveLength(1);
  });
});
