import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Application } from '@omnitron-dev/titan';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { TitanHealthModule, HealthService } from '@omnitron-dev/titan-health';
import { DEFAULT_DAEMON_CONFIG, DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import { createDaemonModule, getDaemonLogStream, getDaemonErrorStream } from '../../src/daemon/daemon.module.js';

describe('daemon health RPC access', () => {
  const marker = 'private-indicator-diagnostic';
  let app: Application, http: HttpNativeServer, endpoint: string, logDir: string;
  beforeAll(async () => {
    logDir = await mkdtemp(join(tmpdir(), 'omnitron-health-policy-'));
    const module = createDaemonModule({ ...DEFAULT_ECOSYSTEM, apps: [] }, { ...DEFAULT_DAEMON_CONFIG, logDir });
    const health = Reflect.getMetadata('nexus:module', module).imports
      .find((item: { module?: unknown }) => item.module === TitanHealthModule);
    expect(health).toBeDefined();
    app = await Application.create({ imports: [health], disableGracefulShutdown: true });
    await app.start();
    const service = await app.resolveAsync(HealthService);
    service.registerIndicator({ name: 'fixture', check: async () => ({ status: 'unhealthy', message: marker }) });
    const logger = createNullLogger();
    app.netron!.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('Bearer token required'); },
      validateToken: async token => {
        if (!['viewer', 'operator', 'admin', 'service_role', 'unrelated'].includes(token)) throw new Error('Unknown credential');
        return { userId: token, roles: [token], permissions: [] };
      },
      tokenCache: { enabled: false },
    }), new AuthorizationManager(logger));
    http = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false });
    http.setPeer(app.netron!.peer); await http.listen();
    endpoint = `http://127.0.0.1:${http.port}/netron/invoke`;
  });
  afterAll(async () => {
    await http?.close();
    await app?.stop({ force: true });
    await Promise.all([getDaemonLogStream(), getDaemonErrorStream()].map(stream =>
      stream ? new Promise<void>(resolve => stream.end(resolve)) : Promise.resolve()));
    if (logDir) await rm(logDir, { recursive: true, force: true });
  });
  async function request(method: string, role?: string) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(role && { authorization: `Bearer ${role}` }) },
      body: JSON.stringify({ id: randomUUID(), service: 'Health@1.0.0', method, input: method === 'checkIndicator' ? ['fixture'] : [] }),
    });
    return { status: response.status, body: await response.json() };
  }

  it.each(['live', 'ready'])('exposes only status and time for the anonymous %s probe', async method => {
    const { status, body } = await request(method);
    expect(status).toBe(200);
    expect(body.data).toEqual({ status: method === 'ready' ? 'unhealthy' : 'up', timestamp: expect.any(String) });
  });

  it.each(['check', 'checkIndicator', 'listIndicators', 'uptime', 'isHealthy'])('requires a permitted principal for %s', async method => {
    expect((await request(method)).status).toBe(401);
    expect((await request(method, 'unrelated')).status).toBe(403);
    for (const role of ['viewer', 'operator', 'admin', 'service_role']) {
      const { status, body } = await request(method, role);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      if (method === 'check' || method === 'checkIndicator') expect(JSON.stringify(body.data)).toContain(marker);
    }
  });
});
