import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { TerminalRpcService } from '../../src/services/terminal.rpc-service.js';

// Real HTTP admission and production invocation wrapper; no live daemon or database.
const fingerprint = `SHA256:${'a'.repeat(43)}`;
const node = {
  id: 'test-node',
  host: 'test.invalid',
  sshPort: 22,
  sshUser: 'deploy',
  name: 'test-node',
  isLocal: false,
};
const pins = new Map<string, unknown>();
const pty = { write: vi.fn(async () => {}), resize: vi.fn(), close: vi.fn() };
const driver = { probe: vi.fn(async () => fingerprint), connect: vi.fn(async () => pty) };
let role = 'admin';
let netron: Netron, server: HttpNativeServer, terminal: TerminalRpcService, url: string;

beforeAll(async () => {
  const logger = createNullLogger();
  const identity = (token: string) => {
    if (!['admin-a', 'admin-b', 'viewer', 'operator', 'service'].includes(token)) throw new Error('Invalid test token');
    return {
      userId: token,
      roles: [token.startsWith('admin') ? 'admin' : token === 'service' ? 'service_role' : token],
      permissions: [],
      metadata: { sessionId: token },
    };
  };
  netron = new Netron(logger);
  netron.configureAuth(
    new AuthenticationManager(logger, {
      authenticate: (c) => identity(c.token ?? ''),
      validateToken: identity,
      tokenCache: { enabled: true, ttl: 10_000 },
    }),
    new AuthorizationManager(logger)
  );
  terminal = new TerminalRpcService(
    { getNode: () => node, nodeToSshTarget: async () => ({ host: node.host, username: node.sshUser }) } as never,
    { validateSession: async (id: string) => ({ id, role }) } as never,
    {
      kvGetSync: (key: string) => pins.get(key) ?? null,
      kvSetSync: (key: string, value: unknown) => {
        pins.set(key, value);
      },
    } as never,
    { record: async () => {} },
    {},
    driver
  );
  await netron.start();
  await netron.peer.exposeService(terminal);
  server = new HttpNativeServer({
    host: '127.0.0.1',
    port: 0,
    cors: false,
    invocationWrapper: createAuthContextWrapper(),
  });
  server.setPeer(netron.peer);
  await server.listen();
  url = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  terminal?.dispose();
  await server?.close();
  await netron?.stop();
});

async function invoke(token: string | null, method: string, input: unknown[] = [], context?: unknown) {
  const response = await fetch(`${url}/netron/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ id: crypto.randomUUID(), service: 'OmnitronTerminal', method, input, context }),
  });
  return { response, body: await response.json() };
}

describe('terminal HTTP authority', () => {
  it('does not accept a forged local-socket identity, or lower roles, over HTTP', async () => {
    const forged = {
      authContext: { userId: 'omnitron-local', roles: ['admin'], metadata: { source: 'local-unix-socket' } },
      authenticated: true,
    };
    for (const token of [null, 'viewer', 'operator', 'service']) {
      const result = await invoke(token, 'inspectHost', [{ nodeId: node.id }], forged);
      expect(result.body.success).toBe(false);
      expect([401, 403]).toContain(result.response.status);
    }
    expect(driver.probe).not.toHaveBeenCalled();
  });

  it('enforces ownership and current role even when a previously admitted token is cached', async () => {
    expect(
      (await invoke('admin-a', 'trustHost', [{ nodeId: node.id, fingerprint, previous: null }])).body.success
    ).toBe(true);
    const opened = await invoke('admin-a', 'open', [{ nodeId: node.id, cols: 80, rows: 24 }]);
    expect(opened.body.success).toBe(true);
    const id = opened.body.data.id;
    expect((await invoke('admin-b', 'list')).body.data).toEqual([]);
    expect((await invoke('admin-b', 'write', [{ id, sequence: 0, data: 'aWQK' }])).body.success).toBe(false);
    expect(pty.write).not.toHaveBeenCalled();
    role = 'viewer';
    expect((await invoke('admin-a', 'write', [{ id, sequence: 0, data: 'aWQK' }])).body.success).toBe(false);
    await terminal.sweep();
    expect(pty.close).toHaveBeenCalledTimes(1);
  });
});
