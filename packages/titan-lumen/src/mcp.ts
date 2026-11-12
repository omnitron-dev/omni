import { createRequire } from 'node:module';
import { WebStandardStreamableHTTPServerTransport,
  hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server';
import { decodeHttpError, TitanError } from '@omnitron-dev/netron-protocol';
import { createLumenMcpServer } from '@omnitron-dev/lumen-ast/mcp';
import type { HttpNativeServer, HttpResponseMessage } from '@omnitron-dev/titan/netron/transport/http';
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
    const server = createLumenMcpServer({
      resourcePaths: this.options.resources ?? [],
      search: (query, options) => this.invoke(request, 'search', [query, options], remoteAddress),
      getDocument: path => this.invoke(request, 'getDocument', [path], remoteAddress),
    }, { name: 'titan-lumen', version });

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
