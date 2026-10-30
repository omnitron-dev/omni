import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { TraceRpcService } from '../../src/services/trace-collector.rpc-service.js';
import type { TraceCollectorService } from '../../src/services/trace-collector.service.js';
import type { TraceSpan } from '../../src/shared/dto/traces.js';

describe('trace permissions over HTTP RPC', () => {
  let netron: Netron, server: HttpNativeServer, endpoint: string;
  const collector = {
    ingestSpan: vi.fn(async () => {}),
    ingestBatch: vi.fn(async () => {}),
    getTrace: vi.fn(async () => null),
    queryTraces: vi.fn(async () => []),
    getServiceMap: vi.fn(async () => []),
  };
  const span: TraceSpan = {
    traceId: '1'.repeat(32), spanId: '2'.repeat(16), parentSpanId: null,
    serviceName: 'fixture', operationName: 'probe',
    startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:00:00.001Z',
    duration: 1, status: 'ok', tags: {},
  };
  beforeAll(async () => {
    const logger = createNullLogger();
    netron = new Netron(logger);
    netron.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('Use a test token'); },
      validateToken: async token => {
        if (!['viewer', 'operator', 'admin', 'service_role'].includes(token)) throw new Error('Invalid token');
        return { userId: token, roles: [token], permissions: [] };
      },
      tokenCache: { enabled: false },
    }), new AuthorizationManager(logger));
    await netron.start();
    await netron.peer.exposeService(new TraceRpcService(collector as unknown as TraceCollectorService));
    server = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false });
    server.setPeer(netron.peer);
    await server.listen();
    endpoint = `http://127.0.0.1:${server.port}/netron/invoke`;
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await server?.close(); await netron?.stop(); });
  async function request(role: string | null, method: string, input: unknown[] = []) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(role ? { authorization: `Bearer ${role}` } : {}) },
      body: JSON.stringify({ id: randomUUID(), service: 'OmnitronTraces', method, input }),
    });
    await response.arrayBuffer();
    return response.status;
  }

  it('preserves viewer access to traces, queries and the service map', async () => {
    expect(await request('viewer', 'getTrace', [{ traceId: span.traceId }])).toBe(200);
    expect(await request('viewer', 'queryTraces', [{}])).toBe(200);
    expect(await request('viewer', 'getServiceMap')).toBe(200);
  });

  it.each(['ingestSpan', 'ingestBatch'] as const)('rejects viewer writes to %s before ingestion', async method => {
    const input = method === 'ingestSpan' ? span : { spans: [span] };
    expect(await request('viewer', method, [input])).toBe(403);
    expect(await request('service_role', method, [input])).toBe(403);
    expect(await request(null, method, [input])).toBe(401);
    expect(collector[method]).not.toHaveBeenCalled();
    for (const role of ['operator', 'admin']) expect(await request(role, method, [input])).toBe(200);
    expect(collector[method]).toHaveBeenCalledTimes(2);
  });
});
