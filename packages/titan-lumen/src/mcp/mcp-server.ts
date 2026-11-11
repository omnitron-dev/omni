import { Injectable } from '@omnitron-dev/titan';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import { MCP_PROTOCOL_VERSION, MCP_RESOURCE_URI_PREFIX } from '../constants.js';
import { AccessFilterService, extractDocumentAccess } from '../access/access-filter.service.js';
import type { ILumenService, LumenSessionContext } from '../interfaces.js';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

function isSuspiciousResourcePath(resourcePath: string): boolean {
  if (!resourcePath || resourcePath.includes('\0') || resourcePath.includes('\\') || resourcePath.includes('..')) {
    return true;
  }
  return /%(?:2e|2f|5c|00|25(?:2e|2f|5c|00))/i.test(resourcePath);
}

@Injectable()
export class LumenMcpServer {
  private readonly knownResources = new Map<string, string>([
    ['guides/intro.pdx', '# Introduction\nWelcome to Lumen documentation.'],
    ['reference/api.pdx', '# API Reference\nComprehensive API reference.'],
  ]);

  private readonly resourceAccess = new Map<string, string>();
  private readonly accessFilter: AccessFilterService;

  constructor(
    private readonly rpcService?: ILumenService,
    accessFilter?: AccessFilterService
  ) {
    if (accessFilter) {
      this.accessFilter = accessFilter;
    } else if (
      rpcService &&
      'getAccessFilterService' in rpcService &&
      typeof (rpcService as { getAccessFilterService?: unknown }).getAccessFilterService === 'function'
    ) {
      this.accessFilter = (
        rpcService as { getAccessFilterService: () => AccessFilterService }
      ).getAccessFilterService();
    } else {
      this.accessFilter = new AccessFilterService();
    }
  }

  registerResource(resourcePath: string, content: string, access?: string): void {
    const cleanPath = resourcePath.startsWith(MCP_RESOURCE_URI_PREFIX)
      ? resourcePath.slice(MCP_RESOURCE_URI_PREFIX.length)
      : resourcePath;
    this.knownResources.set(cleanPath, content);
    const effectiveAccess = access ?? extractDocumentAccess(content);
    this.resourceAccess.set(cleanPath, effectiveAccess);
  }

  getTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return [
      {
        name: 'search_corpus',
        description: 'Search documentation corpus using semantic or lexical queries',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_document',
        description: 'Retrieve AST or clean markdown for a document path',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path' },
          },
          required: ['path'],
        },
      },
      {
        name: 'lumen_inspect_ast',
        description: 'Inspect AST representation for a document',
        inputSchema: {
          type: 'object',
          properties: {
            docId: { type: 'string', description: 'Document ID' },
          },
          required: ['docId'],
        },
      },
    ];
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, unknown> = {},
    session?: LumenSessionContext
  ): Promise<any> {
    const effectiveRoles = this.accessFilter.getEffectiveRoles(session);
    const effectiveSession: LumenSessionContext =
      session && session.valid === true
        ? { valid: true, roles: effectiveRoles, userId: session.userId }
        : { valid: false, roles: ['anonymous'] };

    if (toolName === 'search_corpus') {
      const query = args['query'];
      const limit = args['limit'];
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: query is required',
          },
        };
      }
      const rawResults = this.rpcService
        ? await this.rpcService.search(
            query,
            { limit: typeof limit === 'number' ? limit : undefined, filter: { roles: effectiveRoles } },
            effectiveSession
          )
        : [];
      const filteredResults = rawResults.filter((hit) => {
        const hitAccess = (hit as { access?: string }).access;
        return this.accessFilter.isAllowed(effectiveRoles, hitAccess ?? 'public');
      });
      return { result: filteredResults };
    }

    if (toolName === 'get_document') {
      const docPath = args['path'];
      if (!docPath || typeof docPath !== 'string' || docPath.trim().length === 0) {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: path is required',
          },
        };
      }

      let content = this.rpcService ? await this.rpcService.getDocument(docPath, effectiveSession) : null;
      if (content === null && this.knownResources.has(docPath)) {
        const resourceRes = this.readResource(`${MCP_RESOURCE_URI_PREFIX}${docPath}`, session);
        if (resourceRes.content !== undefined) {
          content = resourceRes.content;
        }
      }

      if (content !== null) {
        const docAccess = extractDocumentAccess(content);
        if (!this.accessFilter.isAllowed(effectiveRoles, docAccess)) {
          content = null;
        }
      }

      return { result: content };
    }

    if (toolName === 'lumen_inspect_ast') {
      const docId = args['docId'];
      if (!docId || typeof docId !== 'string' || docId.trim().length === 0) {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: docId is required',
          },
        };
      }

      const cleanResourceKey = docId.startsWith(MCP_RESOURCE_URI_PREFIX)
        ? docId.slice(MCP_RESOURCE_URI_PREFIX.length)
        : docId;

      let rawContent = this.rpcService ? await this.rpcService.getDocument(cleanResourceKey, effectiveSession) : null;

      if (rawContent === null && this.knownResources.has(cleanResourceKey)) {
        const resourceContent = this.knownResources.get(cleanResourceKey)!;
        const resourceAccessLevel = this.resourceAccess.get(cleanResourceKey) ?? extractDocumentAccess(resourceContent);
        if (!this.accessFilter.isAllowed(effectiveRoles, resourceAccessLevel)) {
          return {
            result: {
              type: 'doc',
              docId,
              frontmatter: {
                title: 'Restricted',
                access: resourceAccessLevel,
              },
              content: [],
              toc: [],
              diagnostics: [],
            },
          };
        }
        rawContent = resourceContent;
      }

      if (rawContent === null) {
        return {
          result: {
            type: 'doc',
            docId,
            frontmatter: {},
            content: [],
            toc: [],
            diagnostics: [],
          },
        };
      }

      const ast = await parseDocument(rawContent, cleanResourceKey);
      const filtered = this.accessFilter.filterAst(ast, effectiveRoles);

      return {
        result: {
          type: 'doc',
          docId,
          frontmatter: filtered.frontmatter,
          content: filtered.children,
          toc: filtered.toc,
          diagnostics: filtered.diagnostics,
        },
      };
    }

    return {
      error: {
        code: -32601,
        message: 'Method not found',
      },
    };
  }

  readResource(uri: string, session?: LumenSessionContext): { content?: string; code?: number; error?: string } {
    if (!uri || typeof uri !== 'string' || !uri.startsWith(MCP_RESOURCE_URI_PREFIX)) {
      return { error: 'Invalid URI scheme', code: -32602 };
    }
    const resourcePath = uri.slice(MCP_RESOURCE_URI_PREFIX.length);
    if (isSuspiciousResourcePath(resourcePath)) {
      return { error: 'Invalid resource path', code: -32602 };
    }
    if (!this.knownResources.has(resourcePath)) {
      return { error: 'Resource not found', code: 404 };
    }

    const content = this.knownResources.get(resourcePath)!;
    const effectiveRoles = this.accessFilter.getEffectiveRoles(session);
    const docAccess = this.resourceAccess.get(resourcePath) ?? extractDocumentAccess(content);

    const projected = this.accessFilter.filterRawMarkdownContent(content, effectiveRoles, docAccess);
    if (projected === null) {
      return { error: 'Access denied', code: 403 };
    }

    return { content: projected };
  }

  async handleRequest(request: JsonRpcRequest, session?: LumenSessionContext): Promise<JsonRpcResponse> {
    const id = request?.id ?? null;

    if (!request || !request.method) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }

    const effectiveRoles = this.accessFilter.getEffectiveRoles(session);
    const effectiveSession: LumenSessionContext =
      session && session.valid === true
        ? { valid: true, roles: effectiveRoles, userId: session.userId }
        : { valid: false, roles: ['anonymous'] };

    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: 'titan-lumen-mcp',
              version: '0.3.5',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.getTools(),
          },
        };

      case 'tools/call': {
        const { name, arguments: args } = request.params ?? {};
        const callResult = await this.handleToolCall(name, args ?? {}, session);
        if (callResult.error) {
          return {
            jsonrpc: '2.0',
            id,
            error: callResult.error,
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: callResult.result,
        };
      }

      case 'resources/list': {
        const resources: Array<{ uri: string; name: string; mimeType: string }> = [];
        for (const [resourcePath, content] of this.knownResources.entries()) {
          const docAccess = this.resourceAccess.get(resourcePath) ?? extractDocumentAccess(content);
          if (this.accessFilter.isAllowed(effectiveRoles, docAccess)) {
            resources.push({
              uri: `${MCP_RESOURCE_URI_PREFIX}${resourcePath}`,
              name: resourcePath,
              mimeType: 'text/markdown',
            });
          }
        }
        return {
          jsonrpc: '2.0',
          id,
          result: { resources },
        };
      }

      case 'resources/read': {
        const uri = request.params?.uri;
        if (!uri || typeof uri !== 'string') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: uri is required' },
          };
        }
        const res = this.readResource(uri, session);
        if (!res.error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'text/markdown',
                  text: res.content,
                },
              ],
            },
          };
        }

        if (res.code === 404 && this.rpcService) {
          const resourcePath = uri.slice(MCP_RESOURCE_URI_PREFIX.length);
          const rpcDoc = await this.rpcService.getDocument(resourcePath, effectiveSession);
          if (rpcDoc !== null) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: 'text/markdown',
                    text: rpcDoc,
                  },
                ],
              },
            };
          }
        }

        return {
          jsonrpc: '2.0',
          id,
          error: { code: res.code ?? -32000, message: res.error },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' },
        };
    }
  }
}
