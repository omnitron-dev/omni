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

// Both v3 fixtures encode 32 repeated public-key bytes (0x41 or 0x42)
// followed by the Tor checksum and version. No service lookup is needed.
const DEV_PORTAL = 'ifaucqkbifaucqkbifaucqkbifaucqkbifaucqkbifaucqkbifa2mryd.onion';
const OTHER_PORTAL = 'ijbeeqscijbeeqscijbeeqscijbeeqscijbeeqscijbeeqscijbezhid.onion';
const devId = '1'.repeat(64);
const otherId = '2'.repeat(64);
const hostnameFile = '/var/lib/tor/portal/hostname';

let containers: Array<Record<string, unknown>> = [];
const list = vi.fn(async (_options: { orThrow: boolean }) => containers);
const exec = vi.fn(async (container: string, argv: string[]) => {
  if (argv[0] === 'find') return hostnameFile + '\0';
  if (argv[0] === 'head' && argv[3] === hostnameFile) return container === devId ? DEV_PORTAL : OTHER_PORTAL;
  throw new Error('Unexpected read');
});
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  listManagedContainers: list,
  execInContainer: exec,
}));

let reachable = true;
const getStack = vi.fn(async ({ project, stack }: { project: string; stack: string }) => ({
  name: stack,
  type: stack === 'test' ? 'remote' : 'local',
  nodes: stack === 'test' ? [{ host: '192.0.2.20', port: 9700 }] : [],
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

const devTor = { name: 'sample-dev-tor', containerId: devId, service: 'tor', project: 'sample', stack: 'dev', status: 'running' };
const otherTor = { name: 'shop-prod-tor', containerId: otherId, service: 'tor', project: 'shop', stack: 'prod', status: 'running' };
const text = () => said.map((s) => s.text).join('\n');

beforeEach(() => {
  said.length = 0;
  boxes.length = 0;
  reachable = true;
  containers = [devTor, { name: 'sample-dev-postgres', service: 'postgres', project: 'sample', stack: 'dev', status: 'running' }];
  getStack.mockClear();
  list.mockClear();
  exec.mockClear();
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
    expect(boxes[0]!.title).toBe('Tor · stack sample/dev · sample-dev-tor · this machine');
    // The host name in the body: a long title is cut by the box border, and
    // on the master it was — `this machine (MacBook...`.
    expect(boxes[0]!.body).toMatch(/^on .+\n/);
    expect(boxes[0]!.body).toContain(DEV_PORTAL);
    expect(list).toHaveBeenCalledWith({ orThrow: true });
    expect(exec.mock.calls.map(([container]) => container)).toEqual([devId, devId]);
  });

  it('every tor container on this machine, not the first one found', async () => {
    containers.push(otherTor);

    await torCommand();

    expect(boxes.map((b) => b.title)).toEqual([
      expect.stringContaining('stack sample/dev'),
      expect.stringContaining('stack shop/prod'),
    ]);
  });
});

describe('a stack named on the command line', () => {
  it('prints that stack\'s onion only', async () => {
    containers.push(otherTor);

    await torCommand('shop', 'prod');

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.body).toContain(OTHER_PORTAL);
    expect(boxes[0]!.body).not.toContain(DEV_PORTAL);
  });

  it('on a node: names the container and the machine, and prints no onion from this one', async () => {
    await torCommand('sample', 'test');

    expect(getStack).toHaveBeenCalledWith({ project: 'sample', stack: 'test' });
    expect(boxes).toEqual([]);
    expect(text()).not.toContain(DEV_PORTAL);
    expect(text()).toContain('sample-test-tor is declared for sample/test on 192.0.2.20');
    expect(text()).toContain("Run 'omnitron tor sample test' there");
    expect(process.exitCode).toBe(1);
  });

  it('says so when the daemon cannot say where the stack runs', async () => {
    reachable = false;

    await torCommand('sample', 'test');

    expect(text()).toMatch(/No tor container for sample\/test on this machine, and the daemon did not answer/);
    expect(boxes).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});

describe('container and hostname observations', () => {
  it('reports a retained, stopped container without executing in it or following a name', async () => {
    containers = [{ ...devTor, status: 'exited' }, { ...otherTor, service: 'proxy' }];
    await torCommand();
    expect(exec).not.toHaveBeenCalled();
    expect(text()).toContain('exited');
    expect(text()).not.toContain('running');
    expect(boxes).toHaveLength(0);
  });

  it('reports inventory failure without consulting the declarations for a missing stack', async () => {
    list.mockRejectedValueOnce(new Error('Docker unavailable'));
    await torCommand('sample', 'test');
    expect(getStack).not.toHaveBeenCalled();
    expect(text()).toContain('Could not inspect managed containers');
    expect(process.exitCode).toBe(1);
  });

  it.each(['paused', 'restarting', 'unknown'])('reports %s without treating the publisher as stopped', async status => {
    containers = [{ ...devTor, status }];
    await torCommand();
    expect(exec).not.toHaveBeenCalled();
    expect(text()).toContain('public hostnames unavailable');
    expect(process.exitCode).toBe(1);
  });

  it('matches the full legacy stack name even when two share a prefix', async () => {
    containers = [{ ...devTor, project: undefined, stack: undefined },
      { ...otherTor, name: 'sample-dev-copy-tor', project: undefined, stack: undefined }];
    await torCommand('sample', 'dev');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.body).toContain(DEV_PORTAL);
    expect(exec.mock.calls.map(([container]) => container)).toEqual([devId, devId]);
  });

  it('distinguishes an empty successful search from failed discovery', async () => {
    exec.mockResolvedValueOnce('');
    await torCommand();
    expect(text()).toContain('No public hostname files found');
    expect(process.exitCode).not.toBe(1);
    said.length = 0;
    exec.mockRejectedValueOnce(new Error('container disappeared'));
    await torCommand();
    expect(text()).toContain('public hostnames unavailable');
    expect(text()).not.toContain('No public hostname files found');
    expect(process.exitCode).toBe(1);
  });

  it('withholds unexpected file contents and preserves observations for the other container', async () => {
    containers.push(otherTor);
    exec.mockResolvedValueOnce(hostnameFile + '\0').mockResolvedValueOnce(hostnameFile + '\0')
      .mockResolvedValueOnce('unexpected-file-content');
    await torCommand();
    expect(boxes[0]?.body).toContain('public hostname unavailable');
    expect(boxes[0]?.body).not.toContain('unexpected-file-content');
    expect(boxes[1]?.body).toContain(OTHER_PORTAL);
    expect(process.exitCode).toBe(1);
  });
});

describe('--json', () => {
  it('includes the immutable identity and observed state when the public read fails', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' } as never);
    exec.mockRejectedValueOnce(new Error('unavailable'));
    const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await torCommand();
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
        ok: false, data: { containerId: devId, status: 'running', observation: 'unavailable', services: [] },
      });
      expect(process.exitCode).toBe(1);
    } finally {
      output.mockRestore();
    }
  });

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
      container: 'sample-dev-tor',
      containerId: devId,
      status: 'running',
      observation: 'read',
      project: 'sample',
      stack: 'dev',
      containers: [expect.objectContaining({ container: 'sample-dev-tor' })],
    });
    expect(payload.services[0].onion).toBe(DEV_PORTAL);
  });
});
