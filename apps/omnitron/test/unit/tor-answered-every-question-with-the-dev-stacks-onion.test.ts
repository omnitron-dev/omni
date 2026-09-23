/**
 * `omnitron tor` answered every question with the dev stack's onion.
 *
 * Measured 2026-09-23 on the live master:
 *
 *     $ omnitron tor
 *     ┌─Tor Hidden Services─────────────────────────────────────┐
 *     │  ● webapp: ijodqv5j5jjk3chxg5iypuupvwkbnpqo3s6qvdzqjd…  │
 *     │  ● portal: ohtohqkc5pknagnl5uw2c7hnatxmmdlx7vcxfarqdx…  │
 *
 * — the onions of `daos-dev-tor`, the first container on THIS machine whose
 * name ended in `-tor`. The test portal is `6me2nawd…c7cid.onion`, on
 * 37.27.130.185. Nothing on screen named the container, the stack or the
 * machine (the container appeared only under --json), and the command took
 * no arguments, so there was no way to ask for another stack's.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const said: Array<{ level: string; text: string }> = [];
const boxes: Array<{ title: string; body: string }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: {
    info: (t: string) => said.push({ level: 'info', text: t }),
    warn: (t: string) => said.push({ level: 'warn', text: t }),
    error: (t: string) => said.push({ level: 'error', text: t }),
    success: (t: string) => said.push({ level: 'success', text: t }),
  },
  box: (body: string, title: string) => boxes.push({ title, body }),
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const DEV_PORTAL = 'ohtohqkc5pknagnl5uw2c7hnatxmmdlx7vcxfarqdx75vzetoxtqbead.onion';
const OTHER_PORTAL = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion';

let containers: Array<Record<string, unknown>> = [];
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  listManagedContainers: async () => containers,
  execInContainer: async (container: string, argv: string[]) => {
    if (argv[0] === 'find') return '/var/lib/tor/portal/hostname\n';
    return container === 'daos-dev-tor' ? `${DEV_PORTAL}\n` : `${OTHER_PORTAL}\n`;
  },
}));

let reachable = true;
const getStack = vi.fn(async ({ project, stack }: { project: string; stack: string }) => ({
  name: stack,
  type: stack === 'test' ? 'remote' : 'local',
  nodes: stack === 'test' ? [{ host: '37.27.130.185', port: 9700 }] : [],
  infrastructure: { ready: true, services: stack === 'test' ? { tor: { status: 'running', containerName: `${project}-test-tor`, port: null } } : {} },
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    isReachable: async () => reachable,
    service: async () => ({ getStack }),
    disconnect: async () => {},
  }),
}));

const { torCommand } = await import('../../src/commands/tor.js');
const { setEnvOverride, resetEnvCache } = await import('../../src/shared/env-config.js');

const devTor = { name: 'daos-dev-tor', service: 'tor', project: 'daos', stack: 'dev', status: 'running' };
const text = () => said.map((s) => s.text).join('\n');

beforeEach(() => {
  said.length = 0;
  boxes.length = 0;
  reachable = true;
  containers = [devTor, { name: 'daos-dev-postgres', service: 'postgres', project: 'daos', stack: 'dev', status: 'running' }];
  getStack.mockClear();
  resetEnvCache();
});

afterEach(() => {
  process.exitCode = undefined;
  resetEnvCache();
});

describe('what an onion is printed with', () => {
  it('the container, the stack and this machine', async () => {
    await torCommand();

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.title).toBe('Tor · stack daos/dev · daos-dev-tor · this machine');
    // The host name in the body: a long title is cut by the box border, and
    // on the master it was — `this machine (MacBook...`.
    expect(boxes[0]!.body).toMatch(/^on .+\n/);
    expect(boxes[0]!.body).toContain(DEV_PORTAL);
  });

  it('every tor container on this machine, not the first one found', async () => {
    containers.push({ name: 'shop-prod-tor', service: 'tor', project: 'shop', stack: 'prod', status: 'running' });

    await torCommand();

    expect(boxes.map((b) => b.title)).toEqual([
      expect.stringContaining('stack daos/dev'),
      expect.stringContaining('stack shop/prod'),
    ]);
  });
});

describe('a stack named on the command line', () => {
  it('prints that stack\'s onion only', async () => {
    containers.push({ name: 'shop-prod-tor', service: 'tor', project: 'shop', stack: 'prod', status: 'running' });

    await torCommand('shop', 'prod');

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.body).toContain(OTHER_PORTAL);
    expect(boxes[0]!.body).not.toContain(DEV_PORTAL);
  });

  it('on a node: names the container and the machine, and prints no onion from this one', async () => {
    await torCommand('daos', 'test');

    expect(getStack).toHaveBeenCalledWith({ project: 'daos', stack: 'test' });
    expect(boxes).toEqual([]);
    expect(text()).not.toContain(DEV_PORTAL);
    expect(text()).toContain('its tor container daos-test-tor runs on 37.27.130.185, not on this machine');
    expect(text()).toContain('No daemon RPC reads an onion address from a node');
    expect(process.exitCode).toBe(1);
  });

  it('says so when the daemon cannot say where the stack runs', async () => {
    reachable = false;

    await torCommand('daos', 'test');

    expect(text()).toMatch(/No tor container for daos\/test on this machine, and the daemon did not answer/);
    expect(boxes).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});

describe('--json', () => {
  it('names the machine and the stack, and keeps the one-container shape', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' } as never);
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await torCommand();
    } finally {
      spy.mockRestore();
    }

    const payload = JSON.parse(written.join('')).data;
    expect(payload).toMatchObject({
      machine: 'this machine',
      container: 'daos-dev-tor',
      project: 'daos',
      stack: 'dev',
      containers: [expect.objectContaining({ container: 'daos-dev-tor' })],
    });
    expect(payload.services[0].onion).toBe(DEV_PORTAL);
  });
});
