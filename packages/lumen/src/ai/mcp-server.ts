import { createInterface } from 'node:readline';
import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export async function runLumenMcpServer(corpus: CorpusGraph, _config: LumenConfig): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (id: string | number | undefined, result: unknown, error?: unknown) => {
    if (id === undefined) return;
    const response = {
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result }),
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  };

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed) as JsonRpcRequest;

      switch (msg.method) {
        case 'initialize': {
          sendResponse(msg.id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: '@omnitron-dev/lumen-mcp',
              version: '0.3.4',
            },
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
            const matches = corpus
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
            const doc = corpus.getDocument(String(args['id'] ?? ''));
            sendResponse(msg.id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(doc ?? { error: 'Document not found' }),
                },
              ],
            });
          } else if (toolName === 'lumen_inspect_ast') {
            const doc = corpus.getDocument(String(args['docId'] ?? ''));
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
      sendResponse(undefined, null, {
        code: -32700,
        message: 'Parse error',
        data: String(err),
      });
    }
  });
}
