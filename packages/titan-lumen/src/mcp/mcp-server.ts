import { MCP_PROTOCOL_VERSION, MCP_RESOURCE_URI_PREFIX } from '../constants.js';
import type { ILumenRpcService } from '../interfaces.js';

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

export class LumenMcpServer {
  private readonly knownResources = new Map<string, string>([
    ['guides/intro.pdx', '# Introduction\nWelcome to Lumen documentation.'],
    ['reference/api.pdx', '# API Reference\nComprehensive API reference.'],
  ]);

  constructor(private readonly rpcService?: ILumenRpcService) {}

  registerResource(path: string, content: string): void {
    const cleanPath = path.startsWith(MCP_RESOURCE_URI_PREFIX) ? path.slice(MCP_RESOURCE_URI_PREFIX.length) : path;
    this.knownResources.set(cleanPath, content);
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

  async handleToolCall(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
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
      const results = this.rpcService ? await this.rpcService.search(query, { limit: limit as number }) : [];
      return { result: results };
    }

    if (toolName === 'get_document') {
      const path = args['path'];
      if (!path || typeof path !== 'string') {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: path is required',
          },
        };
      }
      const content = this.rpcService ? await this.rpcService.getDocument(path) : null;
      return { result: content };
    }

    if (toolName === 'lumen_inspect_ast') {
      const docId = args['docId'];
      if (!docId || typeof docId !== 'string') {
        return {
          error: {
            code: -32602,
            message: 'Invalid params: docId is required',
          },
        };
      }
      return {
        result: {
          type: 'doc',
          docId,
          content: [],
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

  readResource(uri: string): { content?: string; code?: number; error?: string } {
    if (!uri.startsWith(MCP_RESOURCE_URI_PREFIX)) {
      return { error: 'Invalid URI scheme' };
    }
    const path = uri.slice(MCP_RESOURCE_URI_PREFIX.length);
    if (!this.knownResources.has(path)) {
      return { error: 'Resource not found', code: 404 };
    }
    return { content: this.knownResources.get(path) };
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = request.id ?? null;

    if (!request || !request.method) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }

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
              version: '0.3.4',
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
        const callResult = await this.handleToolCall(name, args ?? {});
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
        const resources = Array.from(this.knownResources.keys()).map((path) => ({
          uri: `${MCP_RESOURCE_URI_PREFIX}${path}`,
          name: path,
          mimeType: 'text/markdown',
        }));
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
        const res = this.readResource(uri);
        if (res.error) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: res.code ?? -32000, message: res.error },
          };
        }
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

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' },
        };
    }
  }
}
