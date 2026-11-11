import { createRequire } from 'node:module';
import { McpServer, ResourceTemplate, ResourceNotFoundError, WebStandardStreamableHTTPServerTransport,
  hostHeaderValidationResponse, originValidationResponse, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { decodeHttpError, TitanError } from '@omnitron-dev/netron-protocol';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import type { HttpNativeServer, HttpResponseMessage } from '@omnitron-dev/titan/netron/transport/http';
import { MCP_RESOURCE_URI_PREFIX } from './constants.js';
import type { LumenServiceContract } from './types.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface LumenMcpOptions {
  /** Native Netron HTTP host. No second listener or authorization stack is created. */
  http: Pick<HttpNativeServer, 'handleRequest'>;
  /** Match the host's configured pathPrefix, if any. */
  rpcPath?: string;
  /** Catalog paths, never independent document bodies. Reads always enter Netron. */
  resources?: readonly string[];
  /** Hostnames without ports, following the MCP SDK host/origin policy. */
  allowedHostnames?: string[];
  allowedOriginHostnames?: string[];
  maxRequestBodyBytes?: number;
}

function toolResult(result: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
}

/** External MCP protocol adapter. All document access runs through native Netron admission. */
export class LumenMcpAdapter {
  constructor(private readonly options: LumenMcpOptions) {}

  private async invoke<M extends keyof LumenServiceContract>(
    request: Request, method: M, args: Parameters<LumenServiceContract[M]>, remoteAddress?: string,
  ): Promise<Awaited<ReturnType<LumenServiceContract[M]>>> {
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    const response = await this.options.http.handleRequest(new Request(
      new URL(this.options.rpcPath ?? '/netron/invoke', request.url), {
        method: 'POST', headers, signal: request.signal,
        body: JSON.stringify({ id: crypto.randomUUID(), service: 'Lumen', method, input: args }),
      }), remoteAddress);
    const body = await response.json() as HttpResponseMessage;
    if (!response.ok || !body.success) {
      throw new TitanError(decodeHttpError(response.status, body, Object.fromEntries(response.headers)));
    }
    return body.data as Awaited<ReturnType<LumenServiceContract[M]>>;
  }

  async handleRequest(request: Request, remoteAddress?: string): Promise<Response> {
    const hosts = this.options.allowedHostnames ?? ['localhost', '127.0.0.1', '[::1]'];
    const refusal = hostHeaderValidationResponse(request, hosts) ??
      originValidationResponse(request, this.options.allowedOriginHostnames ?? hosts);
    if (refusal) return refusal;
    // This adapter serves request/response operations, without session or event streams.
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });

    // Request-local closures retain credentials without any mutable session on the singleton.
    const server = new McpServer({ name: 'titan-lumen', version }, { maxToolInputElements: 128 });
    const invoke = <M extends keyof LumenServiceContract>(method: M, args: Parameters<LumenServiceContract[M]>) =>
      this.invoke(request, method, args, remoteAddress);
    server.registerTool('search_corpus', {
      description: 'Search the documents accessible to the authenticated caller.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(4096), limit: z.number().int().min(1).max(100).optional() }).strict(),
    }, async ({ query, limit }) => toolResult({ results: await invoke('search', [query, { limit }]) }));
    server.registerTool('get_document', {
      description: 'Read an authorized document by corpus-relative path.',
      inputSchema: z.object({ path: z.string().min(1).max(4096) }).strict(),
    }, async ({ path }) => toolResult({ path, content: await invoke('getDocument', [path]) }));
    server.registerTool('lumen_inspect_ast', {
      description: 'Inspect the parsed, authorized document projection.',
      inputSchema: z.object({ docId: z.string().min(1).max(4096) }).strict(),
    }, async ({ docId }) => {
      const content = await invoke('getDocument', [docId]);
      if (content === null) throw new ResourceNotFoundError('Document not found');
      const ast = await parseDocument(content, docId);
      return toolResult({ type: 'doc', docId, frontmatter: ast.frontmatter, content: ast.children, toc: ast.toc });
    });
    server.registerResource('corpus', new ResourceTemplate(`${MCP_RESOURCE_URI_PREFIX}{+path}`, {
      list: async () => {
        const resources: Array<{ uri: string; name: string; mimeType: string }> = [];
        for (const path of this.options.resources ?? []) {
          if (await invoke('getDocument', [path]) !== null) {
            resources.push({ uri: MCP_RESOURCE_URI_PREFIX + path.split('/').map(encodeURIComponent).join('/'),
              name: path, mimeType: 'text/markdown' });
          }
        }
        return { resources };
      },
    }), { mimeType: 'text/markdown' }, async (uri) => {
      const path = decodeURIComponent(uri.href.slice(MCP_RESOURCE_URI_PREFIX.length));
      const text = await invoke('getDocument', [path]);
      if (text === null) throw new ResourceNotFoundError('Document not found');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true,
      maxRequestBodySize: this.options.maxRequestBodyBytes ?? 1024 * 1024,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  }
}
