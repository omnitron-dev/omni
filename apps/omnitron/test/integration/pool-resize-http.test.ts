import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import { DEFAULT_ECOSYSTEM, DAEMON_SERVICE_ID } from '../../src/config/defaults.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import type { ProcessInfoDto } from '../../src/config/types.js';
let netron: Netron, http: HttpNativeServer, endpoint: string;
const app: ProcessInfoDto = { name: 'fixture', mode: 'bootstrap', status: 'online', pid: null,
  cpu: 0, memory: 0, uptime: 0, restarts: 0, instances: 1, port: null, critical: false,
  processes: [{ name: 'workers', type: 'worker', pid: null, status: 'online', cpu: 0, memory: 0,
    uptime: 0, restarts: null, instances: 2, declaredInstances: 2 }] };
const scale = vi.fn(async (_name: string, count: number, _process: string) => { app.processes![0]!.instances = count; });
const record = vi.fn(async () => {});
const rpc = new DaemonRpcService({ getApp: (name: string) => name === 'fixture' ? structuredClone(app) : null,
  scaleApp: scale } as never, {} as never, {} as never, DEFAULT_ECOSYSTEM as never, {} as never);
rpc.setAudit({ record } as never);
beforeAll(async () => {
  const logger = createNullLogger(); netron = new Netron(logger);
  netron.configureAuth(new AuthenticationManager(logger, { authenticate: async () => { throw new Error('Test token required'); },
    validateToken: async role => {
      if (!['viewer', 'operator', 'admin'].includes(role)) throw new Error('Invalid token');
      return { userId: role, roles: [role], permissions: [] };
    }, tokenCache: { enabled: false } }), new AuthorizationManager(logger));
  await netron.start(); await netron.peer.exposeService(rpc);
  http = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false, invocationWrapper: createAuthContextWrapper() });
  http.setPeer(netron.peer); await http.listen(); endpoint = `http://127.0.0.1:${http.port}/netron/invoke`;
});
afterAll(async () => { await http?.close(); await netron?.stop(); });
async function request(role: string, input: unknown) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${role}` },
    body: JSON.stringify({ id: randomUUID(), service: DAEMON_SERVICE_ID, method: 'scale', input: [input] }) });
  const body: unknown = await response.json(); return { status: response.status, body };
}
it('keeps viewer denied and validates operator input before dispatch', async () => {
  const valid = { name: 'fixture', process: 'workers', instances: 3 };
  expect((await request('viewer', valid)).status).toBe(403);
  for (const input of [{ name: 'fixture', instances: 3 }, { ...valid, instances: 1.5 }, { ...valid, instances: 0 },
    { ...valid, instances: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, process: 'missing' }]) expect((await request('operator', input)).status).toBe(400);
  expect(scale).not.toHaveBeenCalled();
});
it('rejects classic false success and returns selected pool observation', async () => {
  app.mode = 'classic';
  expect((await request('operator', { name: 'fixture', process: 'workers', instances: 3 })).status).toBe(400);
  expect(scale).not.toHaveBeenCalled(); app.mode = 'bootstrap';
  const response = await request('operator', { name: 'fixture', process: 'workers', instances: 3 });
  expect(response.status).toBe(200); expect(scale).toHaveBeenCalledWith('fixture', 3, 'workers');
  expect(JSON.stringify(response.body)).toContain('"declaredInstances":2');
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', details: expect.objectContaining({ process: 'workers', requested: 3, observed: 3 }) }));
});
it('records failed outcome without rewriting it as success', async () => {
  scale.mockRejectedValueOnce(new Error('worker failed after partial resize'));
  expect((await request('admin', { name: 'fixture', process: 'workers', instances: 4 })).status).not.toBe(200);
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'failed', details: expect.objectContaining({ requested: 4 }) }));
});
