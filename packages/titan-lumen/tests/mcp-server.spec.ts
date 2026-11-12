import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { LumenService } from '../src/lumen.service.js';
import { LumenMcpAdapter } from '../src/mcp.js';
import { hostFor, mcpFor, mcpRequest } from './netron-fixture.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const docsDir = mkdtempSync(join(tmpdir(), 'lumen-mcp-')); roots.push(docsDir);
  writeFileSync(join(docsDir, 'public.pdx'), '# Public\nShared corpus guide.');
  writeFileSync(join(docsDir, 'secret.pdx'), '---\naccess: confidential\n---\n# Secret\nShared corpus private canary.');
  const service = new LumenService({ docsDir });
  return { service, ...await mcpFor(service, { resources: ['public.pdx', 'secret.pdx'] }) };
}

describe('official MCP protocol through native Netron admission', () => {
  it('works with the official client for discovery, search and resources', async () => {
    const { service } = await fixture();
    const { netron } = await hostFor(service);
    let adapter: LumenMcpAdapter;
    const http = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false,
      customRoutes: [async (request, { remoteAddress }) =>
        new URL(request.url).pathname === '/mcp' ? adapter.handleRequest(request, remoteAddress) : null],
    });
    http.setPeer(netron.peer);
    adapter = new LumenMcpAdapter({ http, resources: ['public.pdx', 'secret.pdx'] });
    await http.listen();
    const client = new Client({ name: 'lumen-independent-audit', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.port}/mcp`));
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['search_corpus', 'get_document', 'lumen_inspect_ast']);
      const search = await client.callTool({ name: 'search_corpus', arguments: { query: 'corpus' } });
      expect(search.structuredContent).toMatchObject({ results: [{ path: 'public.pdx' }] });
      expect(JSON.stringify(search)).not.toContain('private canary');
      expect((await client.listResources()).resources.map(resource => resource.name)).toEqual(['public.pdx']);
      const read = await client.readResource({ uri: 'lumen://corpus/public.pdx' });
      expect(read.contents).toMatchObject([{ text: expect.stringContaining('Shared corpus guide') }]);
      await expect(client.readResource({ uri: 'lumen://corpus/secret.pdx' })).rejects.toThrow();
    } finally { await client.close(); await http.close(); }
  });

  it('does not mix concurrent caller credentials or accept roles from tool arguments', async () => {
    const mcp = await fixture();
    const read = (index: number) => mcp.call({ method: 'tools/call',
      params: { name: 'get_document', arguments: { path: 'secret.pdx' } } }, index % 2 ? 'admin' : undefined);
    const calls = await Promise.all(Array.from({ length: 12 }, (_, i) => read(i)));
    expect(calls.some(result => result.result?.isError)).toBe(true);
    expect(calls.some(result => !result.result?.isError)).toBe(true);
    for (const [index, initial] of calls.entries()) {
      let result = initial;
      if (result.result?.isError) {
        expect(JSON.stringify(result.result)).toContain('Too many requests');
        expect(JSON.stringify(result)).not.toContain('private canary');
        result = await read(index);
      }
      expect(result.error).toBeUndefined();
      expect(result.result.isError).toBeUndefined();
      expect(result.result.content === null).toBe(index % 2 === 0);
      if (index % 2) expect(result.result.content).toContain('private canary');
    }
    const forged = await mcp.call({ method: 'tools/call', params: { name: 'search_corpus', arguments: { query: 'corpus', roles: ['admin'] } } });
    expect(forged.error ?? forged.result?.isError).toBeTruthy();
    expect(JSON.stringify(forged)).not.toContain('private canary');
    const denied = await mcp.call({ method: 'tools/call', params: { name: 'get_document', arguments: { path: 'secret.pdx' } } }, 'invalid');
    expect(JSON.stringify(denied)).not.toContain('private canary');
  });

  it('enforces SDK payload and host/origin limits without allocating legacy SSE connections', async () => {
    const { adapter } = await fixture();
    const oversize = await adapter.handleRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { data: 'a'.repeat(1024 * 1024) } }));
    expect(oversize.status).toBe(413);
    const origin = await adapter.handleRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, { origin: 'https://evil.example' }));
    expect(origin.status).toBe(403);
    const host = await adapter.handleRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, { host: 'attacker.example' }));
    expect(host.status).toBe(403);
    const get = await adapter.handleRequest(new Request('http://localhost/mcp', { headers: { host: 'localhost', accept: 'text/event-stream' } }));
    expect(get.status).toBe(405);
  });
});
