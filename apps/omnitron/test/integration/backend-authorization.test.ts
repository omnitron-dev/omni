import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Errors } from '@omnitron-dev/titan/errors';
import { BackendRpcService } from '../../src/daemon/backend.rpc-service.js';
import type { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { createAuthContextWrapper, runWithAuth } from '../../src/services/auth-context.js';

describe('backend authority and startup admission over HTTP', () => {
  let netron: Netron, server: HttpNativeServer, endpoint: string;
  let ready = true;
  const daemon = { backendRuntimeStatus: vi.fn(() => ({ mode: 'resident', handoffSupported: true })),
    backendControlAddress: vi.fn(() => '/private/controller.sock') };
  const rpc = new BackendRpcService(daemon as unknown as OmnitronDaemon);
  beforeAll(async () => {
    const logger = createNullLogger();
    netron = new Netron(logger);
    netron.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('Use a test token'); },
      validateToken: async token => {
        if (!['viewer', 'operator', 'admin', 'service_role'].includes(token)) throw new Error('Invalid token');
        return { userId: token, roles: [token], permissions: [] };
      }, tokenCache: { enabled: false },
    }), new AuthorizationManager(logger));
    await netron.start();
    await netron.peer.exposeService(rpc);
    server = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false,
      invocationWrapper: createAuthContextWrapper({ assertReady: () => {
        if (!ready) throw Errors.unavailable('Backend is adopting execution ownership');
      } }),
    });
    server.setPeer(netron.peer); await server.listen();
    endpoint = `http://127.0.0.1:${server.port}/netron/invoke`;
  });
  afterAll(async () => { await server?.close(); await netron?.stop(); });
  async function request(role: string | null, method: string) {
    const response = await fetch(endpoint, { method: 'POST', headers: {
      'content-type': 'application/json', ...(role ? { authorization: `Bearer ${role}` } : {}),
    }, body: JSON.stringify({ id: randomUUID(), service: 'OmnitronBackend', method, input: [] }) });
    await response.arrayBuffer(); return response.status;
  }
  it('allows control-plane readers, including mesh observers, and refuses anonymous access', async () => {
    for (const role of ['viewer', 'operator', 'admin', 'service_role']) expect(await request(role, 'status')).toBe(200);
    expect(await request(null, 'status')).toBe(401);
  });
  it('never exposes local artifact activation through HTTP, including to administrators', async () => {
    for (const role of ['viewer', 'operator', 'admin', 'service_role']) expect(await request(role, 'controlAddress')).toBe(403);
    expect(daemon.backendControlAddress).not.toHaveBeenCalled();
    expect(await runWithAuth({ userId: 'local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } },
      () => rpc.controlAddress())).toEqual({ socket: '/private/controller.sock' });
  });
  it('does not dispatch requests until ownership adoption has completed', async () => {
    daemon.backendRuntimeStatus.mockClear(); ready = false;
    try {
      expect(await request('admin', 'status')).toBe(503);
      expect(daemon.backendRuntimeStatus).not.toHaveBeenCalled();
    } finally { ready = true; }
    expect(await request('admin', 'status')).toBe(200);
  });
});
