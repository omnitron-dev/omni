import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';
import { Netron } from '@omnitron-dev/titan/netron';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { createDaemonTokenValidator, createDaemonPrincipalValidator } from '../../src/services/daemon-authority.js';
import { SyncRpcService } from '../../src/services/sync.rpc-service.js';
import { FleetRpcService } from '../../src/services/fleet.rpc-service.js';
import { TelemetryRpcService } from '../../src/services/telemetry.rpc-service.js';
import { ClusterRpcService } from '../../src/cluster/cluster.rpc-service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';

@Service('SessionFixture@1.0.0')
class SessionFixture {
  effects = 0;
  @Public({ auth: { roles: ['admin'] } })
  mutate() { return ++this.effects; }
  @Public({ auth: { roles: ['admin', 'viewer', 'service_role'] } })
  read() { return this.effects; }
}

describe('live session authority across HTTP cache and persistent WebSocket', () => {
  const secret = new TextEncoder().encode('isolated-session-authority-fixture-secret');
  const fixture = new SessionFixture();
  const heartbeat = vi.fn(), receive = vi.fn();
  let role: string | null = 'admin', unavailable = false;
  const store = { validateSessionAuthority: async (userId: string, sessionId: string) => {
    if (unavailable) throw Object.assign(new Error('Session store is unavailable'), { code: 'SESSION_STORE_UNAVAILABLE', statusCode: 503 });
    return role && userId === 'human' && sessionId === 'active' ? { userId, sessionId, role } : null;
  } };
  let netron: Netron, http: HttpNativeServer, client: Netron;
  let endpoint: string, ws: string, token: string;
  beforeAll(async () => {
    const logger = createNullLogger();
    const wrapper = createAuthContextWrapper({ validatePrincipal: createDaemonPrincipalValidator(store) });
    netron = new Netron(logger);
    netron.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('Token required'); },
      validateToken: createDaemonTokenValidator(async value => (await jwtVerify(value, secret, { algorithms: ['HS256'], issuer: 'omnitron' })).payload, store),
      tokenCache: { enabled: true, ttl: 60000 },
    }), new AuthorizationManager(logger));
    netron.registerTransport('ws', () => new WebSocketTransport());
    netron.registerTransportServer('ws', { name: 'ws', options: { host: '127.0.0.1', port: 0, invocationWrapper: wrapper } });
    await netron.start(); await netron.peer.exposeService(fixture);
    await netron.peer.exposeService(new SyncRpcService({ receiveBatch: receive, ackDrained: () => ({ released: 0 }),
      acknowledgeReconciliation: () => ({}), readUnverifiedMetrics: () => [] } as never));
    await netron.peer.exposeService(new FleetRpcService({ heartbeat, getSummary: () => ({ total: 0 }) } as never));
    await netron.peer.exposeService(new TelemetryRpcService({ receive, stats: () => ({ totalReceived: 0 }) } as never));
    await netron.peer.exposeService(new ClusterRpcService({ isLeader: false, getClusterState: () => ({ state: 'follower' }) } as never));
    await netron.peer.exposeService(new ProjectRpcService({
      resolveProjectStack: (scope: unknown) => scope, reviewStackStop: () => ({ digest: null, targets: [] }),
      stopStack: () => ({ status: 'stopped', config: {}, apps: [], nodes: [] }),
      inspectNodeStackStop: () => 'observed', prepareNodeStackStop: () => 'prepared', executeNodeStackStop: () => 'executed',
      resumeInstalledStack: () => ({ outcome: 'running' }), prepareNodeInstalledResume: () => 'prepared',
      executeNodeInstalledResume: () => 'executed', getNodeInstalledResumeReceipt: () => 'observed',
    } as never));
    ws = `ws://127.0.0.1:${(netron.transportServers.get('ws') as { port: number }).port}`;
    http = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false, invocationWrapper: wrapper });
    http.setPeer(netron.peer); await http.listen();
    endpoint = `http://127.0.0.1:${http.port}/netron/invoke`;
    client = new Netron(logger); client.registerTransport('ws', () => new WebSocketTransport()); await client.start();
    token = await mint({ sid: 'active', role: 'admin' });
  });
  beforeEach(() => { role = 'admin'; unavailable = false; fixture.effects = 0; });
  afterAll(async () => { await client?.stop(); await http?.close(); await netron?.stop(); });
  async function mint(claims: Record<string, unknown>) {
    return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer('omnitron').setSubject('human')
      .setExpirationTime('1h').sign(secret);
  }
  async function request(credential = token, method = 'mutate', extra: Record<string, unknown> = {}) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ id: randomUUID(), service: 'SessionFixture', method, input: [], ...extra }) });
    const body = await response.text(); return { status: response.status, body };
  }
  async function connect() {
    const peer = await client.connect(ws);
    expect((await peer.runTask('authenticate', { token })).success).toBe(true);
    return { peer, service: await peer.queryInterface<SessionFixture>('SessionFixture') };
  }

  it('rejects a signed admin credential without a human session', async () => {
    expect((await request(await mint({ role: 'admin' }))).status).toBe(401);
    expect(fixture.effects).toBe(0);
  });
  it('keeps node liveness and replicated writes off the public RPC surface for every principal', async () => {
    const claims = { userId: 'victim', roles: ['service_role'], metadata: { principalType: 'service' } };
    for (const principal of [null, 'viewer', 'operator', 'admin', 'service_role']) {
      role = principal;
      const credential = principal && await mint({ role: principal, ...(principal !== 'service_role' && { sid: 'active' }) });
      for (const [service, method] of [['OmnitronFleet', 'heartbeat'], ['OmnitronTelemetry', 'pushBatch'], ['OmnitronSync', 'receiveBatch']]) {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json', ...(credential && { authorization: 'Bearer ' + credential }) },
          body: JSON.stringify({ id: randomUUID(), service, method, metadata: { authContext: claims },
            input: [{ nodeId: 'victim', entries: [{ nodeId: 'another-victim', type: 'log', data: {} }] }] }),
        });
        expect(response.status).toBe(404);
        expect(await response.text()).toContain('not found');
      }
      if (credential) {
        for (const method of ['ackDrained', 'acknowledgeReconciliation']) {
          expect((await request(credential, method, { service: 'OmnitronSync', input: [{}] })).status).toBe(principal === 'service_role' ? 200 : 403);
        }
        expect((await request(credential, 'readUnverifiedMetrics', { service: 'OmnitronSync' })).status)
          .toBe(['admin', 'service_role'].includes(principal!) ? 200 : 403);
        expect((await request(credential, 'getRelayStats', { service: 'OmnitronTelemetry' })).status).toBe(200);
        expect((await request(credential, 'getSummary', { service: 'OmnitronFleet' })).status).toBe(principal === 'service_role' ? 403 : 200);
      }
    }
    expect(heartbeat).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
  });
  it('separates human stop authority, controller protocol and administrative leadership transfer at HTTP ingress', async () => {
    for (const principal of ['viewer', 'operator', 'admin', 'service_role']) {
      role = principal;
      const credential = await mint({ role: principal, ...(principal !== 'service_role' && { sid: 'active' }) });
      expect((await request(credential, 'getClusterState', { service: 'OmnitronCluster' })).status).toBe(200);
      expect((await request(credential, 'stepDown', { service: 'OmnitronCluster' })).status).toBe(principal === 'admin' ? 200 : 403);
      const stack = { service: 'OmnitronProject', input: [{ project: 'sample', stack: 'prod' }] };
      expect((await request(credential, 'reviewStackStop', stack)).status).toBe(principal === 'service_role' ? 403 : 200);
      expect((await request(credential, 'stopStack', stack)).status).toBe(['operator','admin'].includes(principal) ? 200 : 403);
      expect((await request(credential, 'resumeInstalledStack', stack)).status).toBe(['operator','admin'].includes(principal) ? 200 : 403);
      for (const method of ['inspectNodeStackStop', 'prepareNodeStackStop', 'executeNodeStackStop',
        'prepareNodeInstalledResume', 'executeNodeInstalledResume', 'getNodeInstalledResumeReceipt']) {
        expect((await request(credential, method, { service: 'OmnitronProject', input: [{}] })).status).toBe(principal === 'service_role' ? 200 : 403);
      }
    }
  });
  it('refuses cached admin tokens immediately after demotion and cannot be tricked by caller metadata', async () => {
    expect((await request()).status).toBe(200);
    role = 'viewer';
    const result = await request(token, 'mutate', { metadata: { authContext: { userId: 'omnitron-local', roles: ['admin'], metadata: { source: 'local-unix-socket' } } } });
    expect(result.status).toBe(401);
    expect(fixture.effects).toBe(1);
  });
  it('revokes an already authenticated socket without disconnecting or waiting for its JWT cache', async () => {
    const { peer, service } = await connect();
    try {
      expect(await service.mutate()).toBe(1);
      role = 'viewer';
      await expect(service.mutate()).rejects.toThrow(/role changed/);
      role = null;
      await expect(service.read()).rejects.toThrow(/revoked/);
      expect(fixture.effects).toBe(1);
    } finally { await peer.disconnect(); }
  });
  it('reports store failure as unavailable while preventing side effects on HTTP and sockets', async () => {
    const { peer, service } = await connect();
    try {
      expect((await request()).status).toBe(200);
      unavailable = true;
      expect(await request()).toMatchObject({ status: 503, body: expect.stringContaining('Session store is unavailable') });
      await expect(service.mutate()).rejects.toThrow('Session store is unavailable');
      expect(fixture.effects).toBe(1);
    } finally { await peer.disconnect(); }
  });
  it('checks the expiry of an admitted service peer and accepts fresh authentication on that same peer', async () => {
    const peer = await client.connect(ws);
    const credential = await mint({ role: 'service_role' });
    try {
      expect((await peer.runTask('authenticate', { token: credential })).success).toBe(true);
      const service = await peer.queryInterface<SessionFixture>('SessionFixture');
      expect(await service.read()).toBe(0);
      // Expire only the server's admitted authority, without altering timers or the signed token.
      const accepted = [...netron.peers.values()].find(p => p.getAuthContext()?.roles?.[0] === 'service_role')!;
      const context = accepted.getAuthContext()!;
      accepted.setAuthContext({ ...context, metadata: { ...context.metadata, expiresAt: Date.now() - 1 } });
      await expect(service.read()).rejects.toThrow('expired');
      const fresh = await mint({ role: 'service_role', renewal: randomUUID() });
      expect((await peer.runTask('authenticate', { token: fresh })).success).toBe(true);
      expect(await service.read()).toBe(0);
      expect(fixture.effects).toBe(0);
    } finally { await peer.disconnect(); }
  });
});
