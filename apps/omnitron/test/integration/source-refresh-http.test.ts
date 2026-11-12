import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Errors } from '@omnitron-dev/titan/errors';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import { DEFAULT_ECOSYSTEM, DAEMON_SERVICE_ID } from '../../src/config/defaults.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import type { ProcessInfoDto } from '../../src/config/types.js';
import type { SourceChangeRequest } from '../../src/shared/dto/services.js';

describe('source refresh over the authenticated Netron HTTP surface', () => {
  const binding: SourceChangeRequest = { name: 'fixture/local/site', generation: 'observed-generation', definitionRevision: 7 };
  const online: ProcessInfoDto = { name: binding.name, generation: binding.generation, mode: 'classic', status: 'online',
    pid: null, cpu: 0, memory: 0, uptime: 0, restarts: 0, instances: 1, port: null, critical: false };
  let observed: ProcessInfoDto | null;
  const refresh = vi.fn(async (_name: string, _expected: Omit<SourceChangeRequest, 'name'>): Promise<ProcessInfoDto | undefined> => {
    observed = { ...online, generation: 'confirmed-generation' };
    return observed;
  });
  const read = vi.fn((name: string) => name === binding.name && observed ? structuredClone(observed) : null);
  const manualRestart = vi.fn();
  const lifecycleGate = vi.fn(() => {});
  const rpc = new DaemonRpcService({ getApp: read, restartAfterChange: refresh, restartApp: manualRestart } as never,
    {} as never, {} as never, DEFAULT_ECOSYSTEM as never, {} as never, lifecycleGate);
  let netron: Netron, http: HttpNativeServer, endpoint: string;

  beforeAll(async () => {
    const logger = createNullLogger();
    netron = new Netron(logger);
    netron.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('Test token required'); },
      validateToken: async role => {
        if (!['viewer', 'operator', 'admin'].includes(role)) throw new Error('Invalid token');
        return { userId: role, roles: [role], permissions: [] };
      }, tokenCache: { enabled: false },
    }), new AuthorizationManager(logger));
    await netron.start();
    await netron.peer.exposeService(rpc);
    http = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false, invocationWrapper: createAuthContextWrapper() });
    http.setPeer(netron.peer);
    await http.listen();
    endpoint = `http://127.0.0.1:${http.port}/netron/invoke`;
  });
  beforeEach(() => {
    observed = structuredClone(online);
    vi.clearAllMocks();
  });
  afterAll(async () => { await http?.close(); await netron?.stop(); });

  async function request(role: string, input: unknown) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${role}` },
      body: JSON.stringify({ id: randomUUID(), service: DAEMON_SERVICE_ID, method: 'restartAfterChange', input: [input] }),
    });
    const body: unknown = await response.json();
    return { status: response.status, body };
  }

  it('denies a viewer before lifecycle admission or owner effects', async () => {
    expect((await request('viewer', binding)).status).toBe(403);
    expect(lifecycleGate).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(manualRestart).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(observed).toEqual(online);
  });

  it('rejects malformed binding with HTTP 400 before dispatch', async () => {
    for (const input of [null, {}, { ...binding, name: '' }, { ...binding, name: 'a'.repeat(1025) },
      { ...binding, generation: undefined }, { ...binding, generation: '' }, { ...binding, generation: 'g'.repeat(129) },
      { ...binding, definitionRevision: -1 }, { ...binding, definitionRevision: 0.5 },
      { ...binding, definitionRevision: '7' }, { ...binding, definitionRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect((await request('operator', input)).status).toBe(400);
    }
    expect(refresh).not.toHaveBeenCalled();
    expect(manualRestart).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(observed).toEqual(online);
  });

  it('honors the backend lifecycle gate before invoking the owner', async () => {
    lifecycleGate.mockImplementationOnce(() => { throw Errors.conflict('Fixture backend transition is in progress'); });
    const response = await request('operator', binding);
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('Fixture backend transition is in progress');
    expect(refresh).not.toHaveBeenCalled();
    expect(manualRestart).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(observed).toEqual(online);
  });

  it('propagates an owner refusal without retrying through manual restart', async () => {
    refresh.mockRejectedValueOnce(Errors.conflict('Fixture source binding changed at the owner'));
    const response = await request('operator', binding);
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('Fixture source binding changed at the owner');
    expect(refresh).toHaveBeenCalledExactlyOnceWith(binding.name, {
      generation: binding.generation, definitionRevision: binding.definitionRevision,
    });
    expect(manualRestart).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(observed).toEqual(online);
  });

  it.each(['unchanged generation', 'not online', 'removed', 'no owner result'] as const)(
    'refuses a successful response without a receipt: %s', async condition => {
      refresh.mockImplementationOnce(async () => {
        observed = condition === 'removed' ? null : { ...online,
          generation: condition === 'unchanged generation' ? binding.generation : 'new-generation',
          status: condition === 'not online' ? 'starting' : 'online' };
        return condition === 'no owner result' ? undefined : { ...online };
      });
      const response = await request('operator', binding);
      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain('not confirmed');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(manualRestart).not.toHaveBeenCalled();
    });

  it.each(['operator', 'admin'])('returns the new online observation for an admitted %s', async role => {
    const response = await request(role, binding);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: {
      name: binding.name, generation: 'confirmed-generation', status: 'online',
    } });
    expect(lifecycleGate).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(binding.name, {
      generation: binding.generation, definitionRevision: binding.definitionRevision,
    });
    expect(read).toHaveBeenCalledExactlyOnceWith(binding.name);
    expect(manualRestart).not.toHaveBeenCalled();
  });
});
