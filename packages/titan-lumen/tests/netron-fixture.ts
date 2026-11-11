import { afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager } from '@omnitron-dev/titan/netron/auth';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { decodeHttpError, TitanError } from '@omnitron-dev/netron-protocol';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { LumenService } from '../src/lumen.service.js';
import { LumenMcpAdapter, type LumenMcpOptions } from '../src/mcp.js';
import type { LumenModuleOptions, LumenServiceContract } from '../src/types.js';

const hosts = new Map<LumenService, { netron: Netron; http: HttpNativeServer }>();
const roots: string[] = [];

afterEach(async () => {
  for (const { netron, http } of hosts.values()) { await http.close(); await netron.stop(); }
  hosts.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export function createLumenFixture(documents: Record<string, string> = {}, options: LumenModuleOptions = {}) {
  const docsDir = mkdtempSync(join(tmpdir(), 'lumen-native-')); roots.push(docsDir);
  for (const [path, content] of Object.entries(documents)) {
    const target = join(docsDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return new LumenService({ ...options, docsDir });
}

export async function hostFor(service: LumenService) {
  let host = hosts.get(service);
  if (host) return host;
  const logger = createNullLogger();
  const netron = new Netron(logger, { id: crypto.randomUUID() });
  netron.configureAuth(new AuthenticationManager(logger, {
    authenticate: () => { throw new Error('Token required'); },
    validateToken: (token) => {
      if (!['admin', 'staff', 'reader', 'security_officer'].includes(token)) throw new Error('Invalid token');
      return { userId: `verified-${token}`, roles: [token === 'reader' ? 'anonymous' : token],
        permissions: token === 'admin' ? ['lumen.playground.execute', 'lumen.documents.write'] : [] };
    }, tokenCache: { enabled: false },
  }));
  await netron.start();
  await netron.peer.exposeService(service);
  const http = new HttpNativeServer({ cors: false });
  http.setPeer(netron.peer);
  host = { netron, http }; hosts.set(service, host);
  return host;
}

export async function asUser(service: LumenService, token?: string): Promise<LumenServiceContract> {
  const { http } = await hostFor(service);
  return new Proxy({} as LumenServiceContract, { get: (_, method) => method === 'then' ? undefined : async (...input: unknown[]) => {
    const response = await http.handleRequest(new Request('http://localhost/netron/invoke', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id: crypto.randomUUID(), service: 'Lumen', method, input }),
    }));
    const body = await response.json();
    if (!response.ok || !body.success) throw new TitanError(decodeHttpError(response.status, body));
    return body.data;
  } });
}

export function mcpRequest(body: unknown, token?: string, headers?: HeadersInit): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': LATEST_PROTOCOL_VERSION,
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...Object.fromEntries(new Headers(headers)) },
    body: JSON.stringify(body),
  });
}

export async function mcpFor(service: LumenService, options: Omit<Partial<LumenMcpOptions>, 'http'> = {}) {
  const { http } = await hostFor(service);
  const adapter = new LumenMcpAdapter({ http, ...options });
  const call = async (request: { id?: string | number; method: string; params?: unknown }, token?: string) => {
    const response = await adapter.handleRequest(mcpRequest({ jsonrpc: '2.0', id: 1, ...request }, token), '127.0.0.1');
    const body = await response.json();
    return { ...body, status: response.status, result: body.result?.structuredContent ?? body.result };
  };
  const readResource = async (uri: string, token?: string) => {
    const answer = await call({ method: 'resources/read', params: { uri } }, token);
    return { content: answer.result?.contents?.[0]?.text, error: answer.error, code: answer.error?.code };
  };
  return { adapter, http, call, readResource };
}
