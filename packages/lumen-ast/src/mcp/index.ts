import { McpServer, ResourceTemplate, ResourceNotFoundError, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { parseDocument } from '../compiler/parser.js';

export const MCP_RESOURCE_URI_PREFIX = 'lumen://corpus/';

export interface LumenMcpSearchResult {
  documentId: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
}

/** Callers supply an already admitted projection; this adapter grants no access. */
export interface LumenMcpCorpus {
  search(query: string, options: { limit?: number }): Promise<LumenMcpSearchResult[]>;
  getDocument(path: string): Promise<string | null>;
  /** Candidate corpus-relative paths. Every listed resource is checked by getDocument. */
  resourcePaths: readonly string[];
}

function toolResult(result: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
}

/** Node-only external protocol adapter, isolated from the AST root and browser entry. */
export function createLumenMcpServer(corpus: LumenMcpCorpus, identity: { name: string; version: string }): McpServer {
  const server = new McpServer(identity, { maxToolInputElements: 128 });
  server.registerTool('search_corpus', {
    description: 'Search the documents available in this corpus projection.',
    inputSchema: z.object({ query: z.string().trim().min(1).max(4096), limit: z.number().int().min(1).max(100).optional() }).strict(),
  }, async ({ query, limit }) => toolResult({ results: await corpus.search(query, { limit }) }));
  server.registerTool('get_document', {
    description: 'Read a projected document by corpus-relative path.',
    inputSchema: z.object({ path: z.string().min(1).max(4096) }).strict(),
  }, async ({ path }) => toolResult({ path, content: await corpus.getDocument(path) }));
  server.registerTool('lumen_inspect_ast', {
    description: 'Inspect the parsed document projection. docId is its corpus-relative path.',
    inputSchema: z.object({ docId: z.string().min(1).max(4096) }).strict(),
  }, async ({ docId }) => {
    const content = await corpus.getDocument(docId);
    if (content === null) throw new ResourceNotFoundError('Document not found');
    const ast = await parseDocument(content, docId);
    return toolResult({ type: 'doc', docId, frontmatter: ast.frontmatter, content: ast.children, toc: ast.toc });
  });
  server.registerResource('corpus', new ResourceTemplate(`${MCP_RESOURCE_URI_PREFIX}{+path}`, {
    list: async () => {
      const resources: Array<{ uri: string; name: string; mimeType: string }> = [];
      for (const path of corpus.resourcePaths) {
        if (await corpus.getDocument(path) !== null) {
          resources.push({ uri: MCP_RESOURCE_URI_PREFIX + path.split('/').map(encodeURIComponent).join('/'),
            name: path, mimeType: 'text/markdown' });
        }
      }
      return { resources };
    },
  }), { mimeType: 'text/markdown' }, async (uri) => {
    const path = decodeURIComponent(uri.href.slice(MCP_RESOURCE_URI_PREFIX.length));
    const text = await corpus.getDocument(path);
    if (text === null) throw new ResourceNotFoundError('Document not found');
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });
  return server;
}
