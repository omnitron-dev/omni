import { afterEach, describe, expect, it, vi } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { Public, Auth, Service } from '../../src/decorators/core.js';
import { HttpNativeServer } from '../../src/netron/transport/http/index.js';
import { TcpTransport } from '../../src/netron/transport/tcp-transport.js';
import { HttpTransport } from '../../src/netron/transport/http/http-transport.js';
import { AuthenticationManager } from '../../src/netron/auth/authentication-manager.js';
import type { PolicyEngine } from '../../src/netron/auth/policy-engine.js';
import type { AuthContext } from '../../src/netron/auth/types.js';
import { createAuthMiddleware } from '../../src/netron/transport/http/middleware/auth.js';
import { createMockLogger } from './test-utils.js';

@Service('TransportProbe')
class Probe {
  calls: string[] = [];
  @Public({ transports: ['http'], auth: { permissions: ['probe:read'] } })
  http() { this.calls.push('http'); return 'http'; }
  @Public({ transports: ['websocket'], auth: { permissions: ['probe:read'] } })
  websocket() { this.calls.push('websocket'); return 'websocket'; }
  @Public({ transports: ['tcp'], auth: { permissions: ['probe:read'] } })
  tcp() { this.calls.push('tcp'); return 'tcp'; }
  @Public({ transports: ['http'] })
  @Auth({ roles: ['admin'], permissions: ['probe:read'] })
  composed() { this.calls.push('composed'); return 'composed'; }
  @Public({ transports: [], auth: false })
  nowhere() { this.calls.push('nowhere'); return 'nowhere'; }
  @Public({ transports: ['tcp'], auth: { allowAnonymous: true } })
  anonymousTcp() { this.calls.push('anonymousTcp'); return 'tcp'; }
  @Public({ auth: { policies: ['real-transport'] } })
  policy() { this.calls.push('policy'); return 'policy'; }
  @Public({ auth: false })
  nested() { return new TcpOnly(); }
}

@Service({ name: 'TcpOnly', transports: [new TcpTransport()] })
class TcpOnly {
  calls = 0;
  @Public({ transports: ['http'], auth: false }) // A member cannot widen the service.
  widen() { this.calls++; return 'wrong'; }
  @Public({ auth: false }) open() { this.calls++; return 'tcp'; }
}

@Service({ name: 'HttpOnly', transports: [new HttpTransport()] })
class HttpOnly { @Public({ auth: false }) open() { return 'http-service'; } }

const resources: Array<{ netron: Netron; http: HttpNativeServer }> = [];
afterEach(async () => {
  for (const { netron, http } of resources.splice(0).reverse()) {
    await http.close();
    await netron.stop();
  }
});

async function fixture(initial: boolean, auth = true) {
  const logger = createMockLogger();
  const netron = new Netron(logger);
  const evaluateAll = vi.fn(async (_names, context) => ({ allowed: context.environment.transport === 'http' }));
  netron.policyEngine = { evaluateAll } as unknown as PolicyEngine;
  const http = new HttpNativeServer();
  resources.push({ netron, http });
  if (auth) {
    const validateToken = (token: string): AuthContext => {
      if (token === 'admin') return { userId: 'a', roles: ['admin'], permissions: ['probe:read'] };
      if (token === 'viewer') return { userId: 'v', roles: ['viewer'], permissions: [] };
      throw new Error('Invalid fixture token');
    };
    netron.configureAuth(new AuthenticationManager(logger, {
      authenticate: creds => validateToken(creds.token ?? ''), validateToken, tokenCache: { enabled: false },
    }));
  }
  const probe = new Probe(); const restricted = new TcpOnly();
  if (initial) {
    await netron.peer.exposeService(probe);
    await netron.peer.exposeService(restricted);
    await netron.peer.exposeService(new HttpOnly());
  }
  http.setPeer(netron.peer);
  netron.transportServers.set('http', http);
  if (!initial) {
    await netron.peer.exposeService(probe);
    await netron.peer.exposeService(restricted);
    await netron.peer.exposeService(new HttpOnly());
  }
  const invoke = async (method: string, mode: 'single' | 'sequential' | 'parallel' = 'single',
    token = 'admin', service = 'TransportProbe') => {
    const item = { id: 'item', service, method, input: [], context: { transport: 'tcp', metadata: { transport: 'websocket' } } };
    const response = await http.handleRequest(new Request(`http://fixture/netron/${mode === 'single' ? 'invoke' : 'batch'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, transport: 'tcp' },
      body: JSON.stringify(mode === 'single' ? item : { id: 'batch', options: { parallel: mode === 'parallel' }, requests: [item, { ...item, id: 'item-2' }] }),
    }));
    const body = await response.json();
    return { status: response.status, items: mode === 'single' ? [body] : body.responses };
  };
  return { netron, http, probe, restricted, invoke, evaluateAll };
}

describe('HTTP transport confinement is a server-owned publication boundary', () => {
  it.each([true, false])('uses the same restrictions for initial=%s and dynamic publication', async initial => {
    const f = await fixture(initial);
    for (const mode of ['single', 'sequential', 'parallel'] as const) {
      const allowed = await f.invoke('http', mode);
      expect(allowed.items.every((item: { success: boolean }) => item.success)).toBe(true);
      for (const method of ['websocket', 'tcp', 'nowhere', 'anonymousTcp']) {
        const denied = await f.invoke(method, mode);
        expect(denied.items).toHaveLength(mode === 'single' ? 1 : 2);
        for (const item of denied.items) expect(item).toMatchObject({ success: false, error: { code: '404' } });
      }
      const service = await f.invoke('widen', mode, 'admin', 'TcpOnly');
      expect(service.items.every((item: { success: boolean }) => !item.success)).toBe(true);
      expect((await f.invoke('open', mode, 'admin', 'HttpOnly')).items.every((item: { success: boolean }) => item.success)).toBe(true);
    }
    expect(new Set(f.probe.calls)).toEqual(new Set(['http']));
    expect(f.restricted.calls).toBe(0);
    const spec = await f.http.handleRequest(new Request('http://fixture/openapi.json', { headers: { Authorization: 'Bearer admin' } }));
    const paths = Object.keys((await spec.json()).paths);
    expect(paths.some(path => path.includes('/TransportProbe/http'))).toBe(true);
    expect(paths.some(path => /websocket|TcpOnly|nowhere/.test(path))).toBe(false);
    await f.netron.peer.unexposeService('TransportProbe');
    expect((await f.invoke('http')).status).toBe(404);
    await f.netron.peer.exposeService(new Probe());
    expect((await f.invoke('websocket')).status).toBe(404);
  });

  it('keeps permission and composable role gates in every HTTP mode', async () => {
    const f = await fixture(false);
    for (const mode of ['single', 'sequential', 'parallel'] as const) {
      for (const method of ['http', 'composed']) {
        expect((await f.invoke(method, mode, 'viewer')).items.every((item: { success: boolean }) => !item.success)).toBe(true);
        expect((await f.invoke(method, mode, 'invalid')).items.every((item: { success: boolean }) => !item.success)).toBe(true);
        expect((await f.invoke(method, mode)).items.every((item: { success: boolean }) => item.success)).toBe(true);
      }
    }
  });

  it('ignores forged transport headers/context for policy evaluation and nested interfaces', async () => {
    const f = await fixture(true);
    for (const mode of ['single', 'sequential', 'parallel'] as const) {
      expect((await f.invoke('policy', mode)).items.every((item: { success: boolean }) => item.success)).toBe(true);
      expect((await f.invoke('nested', mode)).items.every((item: { success: boolean; error: { code: string } }) => !item.success && item.error.code === '404')).toBe(true);
    }
    expect(f.evaluateAll).toHaveBeenCalled();
    for (const [, context] of f.evaluateAll.mock.calls) expect(context.environment.transport).toBe('http');
    expect([...f.netron.peer.stubs.values()].filter(stub => stub.definition.meta.name === 'TcpOnly')).toHaveLength(1);
  });

  it('does not turn auth skip lists into transport exemptions', async () => {
    const logger = createMockLogger();
    const middleware = createAuthMiddleware({ logger, skipServices: ['TransportProbe'] });
    const netron = new Netron(logger); const next = vi.fn(async () => {});
    const context = { peer: netron.peer, serviceName: 'TransportProbe', methodName: 'tcp', transport: 'http',
      metadata: new Map<string, unknown>([['serviceInstance', new Probe()]]),
      timing: { start: 0, middlewareTimes: new Map<string, number>() } };
    await expect(middleware(context, next)).rejects.toMatchObject({ code: 404 });
    expect(next).not.toHaveBeenCalled();
    context.methodName = 'http';
    await middleware(context, next);
    expect(next).toHaveBeenCalledOnce();
    await netron.stop();
  });

  it('does not require an authentication manager to enforce a transport restriction', async () => {
    const f = await fixture(false, false);
    expect((await f.invoke('anonymousTcp')).status).toBe(404);
    expect((await f.invoke('widen', 'single', 'anything', 'TcpOnly')).status).toBe(404);
    expect((await f.invoke('http')).status).toBe(401);
    expect(f.probe.calls).toEqual([]);
  });
});
