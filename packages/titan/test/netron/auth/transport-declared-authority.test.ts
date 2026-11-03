import { afterEach, describe, expect, it } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { HttpTransport } from '../../../src/netron/transport/http/http-transport.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';

@Service({ name: 'AuthorityGate', version: '2.0.0' })
class AuthorityGate {
  protectedCalls = 0;
  @Public({ auth: true }) protected() { this.protectedCalls++; return 'protected'; }
  @Public() open() { return 'open'; }
  @Public({ auth: false }) anonymous() { return 'anonymous'; }
}
const nodes: Netron[] = [];
afterEach(async () => { for (const node of nodes.splice(0).reverse()) await node.stop(); });

async function fixture(defaultDeny = false, acl = false) {
  const logger = createMockLogger();
  const server = new Netron(logger, { id: 'authority-server', authDefaultDeny: defaultDeny }); nodes.push(server);
  if (acl) {
    const authz = new AuthorizationManager(logger);
    authz.registerACL({ service: 'AuthorityGate@2.0.0', allowedRoles: ['administrator'] });
    server.configureAuth(new AuthenticationManager(logger, { authenticate: async () => null }), authz);
  }
  server.registerTransport('http', () => new HttpTransport());
  for (const name of ['http', 'websocket']) server.registerTransportServer(name, { name, options: { host: '127.0.0.1', port: 0 } });
  await server.start(); const service = new AuthorityGate(); await server.peer.exposeService(service);
  const httpPort = (server.transportServers.get('http') as unknown as { port: number }).port;
  const wsPort = (server.transportServers.get('websocket') as unknown as { port: number }).port;
  const client = new Netron(logger, { id: 'authority-client' }); nodes.push(client);
  client.registerTransport('http', () => new HttpTransport()); await client.start();
  return { client, service, http: `http://127.0.0.1:${httpPort}`, websocket: `ws://127.0.0.1:${wsPort}` };
}

describe('declared authority is independent of optional authentication wiring', () => {
  it.each([false, true])('enforces method declarations and default-deny=%s equally on HTTP and WebSocket', async defaultDeny => {
    const f = await fixture(defaultDeny);
    for (const url of [f.http, f.websocket]) {
      const peer = await f.client.connect(url);
      const proxy = await peer.queryInterface<{ protected(): Promise<string>; open(): Promise<string>; anonymous(): Promise<string> }>('AuthorityGate');
      await expect(proxy.protected()).rejects.toThrow(/Authentication required/i);
      expect(await proxy.anonymous()).toBe('anonymous');
      if (defaultDeny) await expect(proxy.open()).rejects.toThrow(/Access denied/);
      else expect(await proxy.open()).toBe('open');
    }
    for (const parallel of [false, true]) {
      const response = await fetch(f.http + '/netron/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'batch', options: { parallel }, requests: ['protected', 'anonymous', 'open'].map(method =>
          ({ id: method, service: 'AuthorityGate', method, input: [] })) }) });
      const result = await response.json() as { responses: Array<{ success: boolean; data?: string }> };
      expect(result.responses.map(value => value.success)).toEqual([false, true, !defaultDeny]);
    }
    expect(f.service.protectedCalls).toBe(0);
  });

  it('enforces a versioned ACL on both exact and unqualified HTTP requests', async () => {
    const f = await fixture(false, true);
    for (const service of ['AuthorityGate', 'AuthorityGate@2.0.0']) {
      const response = await fetch(f.http + '/netron/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'acl', service, method: 'anonymous', input: [] }) });
      expect(response.status).toBe(403);
      const body = await response.json() as { success: boolean }; expect(body.success).toBe(false);
      const ws = await f.client.connect(f.websocket);
      const proxy = await ws.queryInterface<{ anonymous(): Promise<string> }>(service);
      await expect(proxy.anonymous()).rejects.toThrow(/denied/i);
    }
    const response = await fetch(f.http + '/netron/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'acl-batch', requests: [{ id: 'one', service: 'AuthorityGate', method: 'anonymous', input: [] }] }) });
    const body = await response.json() as { responses: Array<{ success: boolean }> };
    expect(body.responses[0]!.success).toBe(false);
  });
});
