import { createInterface } from 'node:readline';
import { toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { projectCorpus } from '../corpus/projection.js';
import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface LumenMcpServerOptions {
  roles?: string[];
  maxLineBytes?: number;
}

const DEFAULT_MAX_LINE_BYTES = 1_048_576;

export async function runLumenMcpServer(
  corpus: CorpusGraph,
  _config: LumenConfig,
  options?: LumenMcpServerOptions
): Promise<void> {
  const authorizedCorpus = projectCorpus(corpus, { roles: options?.roles ?? ['anonymous'] });
  const maxLineBytes = options?.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (id: string | number | null | undefined, result: unknown, error?: unknown) => {
    if (id === undefined && !error) return;
    const response = {
      jsonrpc: '2.0',
      id: id ?? null,
      ...(error ? { error } : { result }),
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  };

  rl.on('line', (line) => {
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
      sendResponse(null, null, {
        code: -32600,
        message: `Payload Too Large: line exceeds ${maxLineBytes} bytes`,
      });
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) return;

    let parsedId: string | number | null | undefined;
    try {
      const msg = JSON.parse(trimmed) as JsonRpcRequest;
      parsedId = msg.id;

      switch (msg.method) {
        case 'initialize': {
          sendResponse(msg.id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: '@omnitron-dev/lumen-mcp',
              version: '0.3.5',
            },
          });
          break;
        }

        case 'resources/list': {
          const resources = authorizedCorpus.getAllDocuments().map((doc) => ({
            uri: `lumen://docs/${doc.id}`,
            name: doc.title,
            mimeType: 'text/markdown',
          }));
          sendResponse(msg.id, { resources });
          break;
        }

        case 'resources/read': {
          const uri = String(msg.params?.['uri'] ?? '');
          const prefix = 'lumen://docs/';
          if (!uri.startsWith(prefix)) {
            sendResponse(msg.id, null, {
              code: -32602,
              message: `Invalid resource URI: ${uri}`,
            });
            break;
          }
          const docId = uri.slice(prefix.length);
          const doc = authorizedCorpus.getDocument(docId);
          if (!doc) {
            sendResponse(msg.id, null, {
              code: -32002,
              message: `Resource not found or access denied: ${uri}`,
            });
            break;
          }
          const text = doc.ast ? toCleanMarkdown(doc.ast) : `# ${doc.title}\n`;
          sendResponse(msg.id, {
            contents: [{ uri, mimeType: 'text/markdown', text }],
          });
          break;
        }

        case 'tools/list': {
          sendResponse(msg.id, {
            tools: [
              {
                name: 'search_corpus',
                description: 'Search corpus documents and math theorems',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'Search term or query' },
                  },
                  required: ['query'],
                },
              },
              {
                name: 'get_document',
                description: 'Retrieve full document AST and metadata by document ID',
                inputSchema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Document ID' },
                  },
                  required: ['id'],
                },
              },
              {
                name: 'lumen_inspect_ast',
                description: 'Inspect AST details for a document or snippet',
                inputSchema: {
                  type: 'object',
                  properties: {
                    docId: { type: 'string' },
                  },
                  required: ['docId'],
                },
              },
            ],
          });
          break;
        }

        case 'tools/call': {
          const toolName = msg.params?.['name'] as string;
          const args = (msg.params?.['arguments'] as Record<string, unknown>) ?? {};

          if (toolName === 'search_corpus') {
            const query = String(args['query'] ?? '').toLowerCase();
            const matches = authorizedCorpus
              .getAllDocuments()
              .filter((d) => d.title.toLowerCase().includes(query) || d.id.toLowerCase().includes(query));
            sendResponse(msg.id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(matches.map((m) => ({ id: m.id, title: m.title, path: m.path }))),
                },
              ],
            });
          } else if (toolName === 'get_document') {
            const doc = authorizedCorpus.getDocument(String(args['id'] ?? ''));
            sendResponse(msg.id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(doc ?? { error: 'Document not found' }),
                },
              ],
            });
          } else if (toolName === 'lumen_inspect_ast') {
            const doc = authorizedCorpus.getDocument(String(args['docId'] ?? ''));
            sendResponse(msg.id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(doc?.ast ?? { error: 'AST not found' }),
                },
              ],
            });
          } else {
            sendResponse(msg.id, null, {
              code: -32601,
              message: `Unknown tool: ${toolName}`,
            });
          }
          break;
        }

        default: {
          if (msg.id !== undefined) {
            sendResponse(msg.id, null, {
              code: -32601,
              message: `Method not found: ${msg.method}`,
            });
          }
          break;
        }
      }
    } catch (err: unknown) {
      sendResponse(parsedId ?? null, null, {
        code: -32700,
        message: 'Parse error',
        data: String(err),
      });
    }
  });
}
