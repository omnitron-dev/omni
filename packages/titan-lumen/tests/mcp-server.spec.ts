import { describe, it, expect } from 'vitest';
import { LumenMcpServer } from '../src/mcp/mcp-server.js';
import { LumenRpcService } from '../src/rpc/lumen-rpc.service.js';

describe('LumenMcpServer', () => {
  it('dispatches initialize with protocol version and serverInfo', async () => {
    const server = new LumenMcpServer();
    const res = await server.handleRequest({ method: 'initialize', id: 1 });

    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe('2024-11-05');
    expect(res.result.serverInfo.name).toBe('titan-lumen-mcp');
  });

  it('lists available MCP tools', async () => {
    const server = new LumenMcpServer();
    const res = await server.handleRequest({ method: 'tools/list', id: 2 });

    expect(res.result.tools).toHaveLength(3);
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('search_corpus');
    expect(names).toContain('get_document');
    expect(names).toContain('lumen_inspect_ast');
  });

  it('validates tool call arguments reporting -32602 on missing required query', async () => {
    const server = new LumenMcpServer();
    const res = await server.handleRequest({
      method: 'tools/call',
      id: 3,
      params: { name: 'search_corpus', arguments: {} },
    });

    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('query is required');
  });

  it('executes tool call on valid arguments with rpcService', async () => {
    const rpcService = new LumenRpcService();
    const server = new LumenMcpServer(rpcService);
    const res = await server.handleRequest({
      method: 'tools/call',
      id: 4,
      params: { name: 'search_corpus', arguments: { query: 'intro' } },
    });

    expect(res.result).toBeDefined();
    expect(Array.isArray(res.result)).toBe(true);
  });

  it('reads resource and returns 404 for unknown resources', () => {
    const server = new LumenMcpServer();
    const notFound = server.readResource('lumen://corpus/unknown-file.pdx');
    expect(notFound.code).toBe(404);

    const found = server.readResource('lumen://corpus/guides/intro.pdx');
    expect(found.content).toContain('Introduction');
  });
});
