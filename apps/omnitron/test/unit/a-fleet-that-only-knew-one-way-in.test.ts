/**
 * A machine running six apps was listed as running none.
 *
 * `fleet status`, `fleet health` and `fleet metrics` dial `host:9700` from
 * the CLI and ask `OmnitronDaemon`. A node whose daemon port is not open to
 * this master answers nothing — which is the normal state of a hardened
 * server, and the whole reason the mesh tunnels over SSH. Measured while the
 * master was deploying to that node through the tunnel:
 *
 *     SERVER     HOST                 STATUS   APPS  CPU  MEMORY
 *     daos-test  37.27.130.185:9700   offline  0     -    -
 *
 * against a node answering `appsTotal: 6, appsOnline: 6` with 3001–3007
 * listening. The fleet view is where an operator looks to find out whether
 * the fleet is alive, and for the only remote machine in it, it could not
 * say.
 *
 * The direct dial stays first — one hop, and it is what answers for the
 * local daemon and for a node whose port IS open. The mesh is the fallback,
 * and only for machines the node registry knows, because reaching one is the
 * daemon's business and it takes a node id to do it.
 */

import { describe, it, expect } from 'vitest';

import { MeshAsker, askMachine } from '../../src/commands/fleet-asking.js';

const STATUS = { apps: [{ name: 'a' }], totalCpu: 4.5, totalMemory: 1024 };

/** A daemon on the far end of a direct dial. */
const dialer = (behaviour: 'answers' | 'refuses', seen: string[] = []) =>
  ((host: string, port: number) => {
    seen.push(`${host}:${port}`);
    return {
      async service() {
        if (behaviour === 'refuses') throw new Error('connect ECONNREFUSED');
        return { status: async () => STATUS, getHealth: async () => ({ overall: 'healthy', apps: {} }), getMetrics: async () => ({ totals: { cpu: 1, memory: 2 }, apps: {} }) };
      },
      async disconnect() {},
    };
  }) as never;

/** The local daemon, which can reach a node over the mesh. */
const localDaemon = (answer: unknown, reachable = true, calls: string[] = []) =>
  (() => ({
    async isReachable() {
      return reachable;
    },
    async service() {
      return {
        async getNodeDaemonStatus({ nodeId }: { nodeId: string }) {
          calls.push(`status:${nodeId}`);
          return answer;
        },
        async getNodeDaemonHealth() {
          return answer;
        },
        async getNodeDaemonMetrics() {
          return answer;
        },
      };
    },
    async disconnect() {},
  })) as never;

describe('a machine is asked the way it can be reached', () => {
  it('uses the direct dial when it answers', async () => {
    const seen: string[] = [];
    const r = await askMachine(
      { host: '10.0.0.1', port: 9700 },
      'status',
      new MeshAsker(localDaemon(null)),
      dialer('answers', seen),
    );

    expect(r.via).toBe('direct');
    expect(r.value).toEqual(STATUS);
    expect(seen).toEqual(['10.0.0.1:9700']);
  });

  it('falls back to the mesh for a registered node', async () => {
    const calls: string[] = [];
    const r = await askMachine(
      { host: '37.27.130.185', port: 9700, nodeId: '16f3dd5a' },
      'status',
      new MeshAsker(localDaemon({ nodeId: '16f3dd5a', reachable: true, error: null, answer: STATUS }, true, calls)),
      dialer('refuses'),
    );

    expect(r.via).toBe('mesh');
    expect(r.value).toEqual(STATUS);
    expect(calls).toEqual(['status:16f3dd5a']);
  });

  it('does not reach for the mesh when the dial worked', async () => {
    // One hop where one hop suffices: the relay costs the master a call per
    // machine, on a command people run in a loop.
    const calls: string[] = [];
    const r = await askMachine(
      { host: '10.0.0.1', port: 9700, nodeId: 'known' },
      'status',
      new MeshAsker(localDaemon({ reachable: true, answer: STATUS }, true, calls)),
      dialer('answers'),
    );

    expect(r.via).toBe('direct');
    expect(calls).toEqual([]);
  });

  it('reports the machine unreachable when neither way works', async () => {
    const r = await askMachine(
      { host: '10.0.0.2', port: 9700, nodeId: 'gone' },
      'status',
      new MeshAsker(localDaemon({ nodeId: 'gone', reachable: false, error: 'no route to that node', answer: null })),
      dialer('refuses'),
    );

    expect(r.via).toBeNull();
    expect(r.value).toBeNull();
    expect(r.error).toBe('no route to that node');
  });

  it('keeps the dial\'s own error for a machine that is not a node', async () => {
    // `servers.json` holds machines the node registry has never heard of.
    // There is no id to relay by, and the reason must still be the real one.
    const r = await askMachine(
      { host: '10.0.0.3', port: 9700 },
      'status',
      new MeshAsker(localDaemon(null)),
      dialer('refuses'),
    );

    expect(r.via).toBeNull();
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it('says so when the local daemon is the one that is down', async () => {
    // Without it there is no mesh at all, and "unreachable" would name the
    // wrong machine.
    const r = await askMachine(
      { host: '37.27.130.185', port: 9700, nodeId: '16f3dd5a' },
      'status',
      new MeshAsker(localDaemon(null, false)),
      dialer('refuses'),
    );

    expect(r.via).toBeNull();
    expect(r.error).toMatch(/local daemon did not answer/);
  });

  it('opens the local daemon once for many machines', async () => {
    const opens: string[] = [];
    const open = (() => {
      opens.push('open');
      return {
        async isReachable() { return true; },
        async service() {
          return {
            async getNodeDaemonStatus({ nodeId }: { nodeId: string }) {
              return { nodeId, reachable: true, error: null, answer: STATUS };
            },
          };
        },
        async disconnect() {},
      };
    }) as never;

    const mesh = new MeshAsker(open);
    for (const nodeId of ['a', 'b', 'c']) {
      const r = await askMachine({ host: 'h', port: 9700, nodeId }, 'status', mesh, dialer('refuses'));
      expect(r.via).toBe('mesh');
    }
    await mesh.close();

    expect(opens).toHaveLength(1);
  });
});
