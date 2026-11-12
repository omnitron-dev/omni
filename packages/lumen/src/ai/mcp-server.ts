import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { createLumenMcpServer } from '@omnitron-dev/lumen-ast/mcp';
import { extractAstPlainText, projectCorpus } from '../corpus/projection.js';
import type { CorpusGraph } from '../corpus/graph.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

export interface LumenMcpServerOptions {
  /** Official transport buffer limit, checked before appending an incoming chunk. */
  maxBufferSize?: number;
}

/** Local process trust only. The stdio endpoint always exposes the anonymous projection. */
export async function runLumenMcpServer(corpus: CorpusGraph, options?: LumenMcpServerOptions): Promise<void> {
  const maxBufferSize = options?.maxBufferSize ?? 1_048_576;
  if (!Number.isSafeInteger(maxBufferSize) || maxBufferSize < 1) throw new RangeError('Invalid MCP buffer limit');
  const projected = projectCorpus(corpus, { roles: ['anonymous'] });
  const documents = projected.getAllDocuments().map(doc => ({
    ...doc,
    content: doc.ast ? toCleanMarkdown(doc.ast, { includeFrontmatter: true }) : `# ${doc.title}\n`,
    text: extractAstPlainText(doc.ast?.children),
  }));
  const byPath = new Map(documents.map(doc => [doc.path, doc]));
  const server = createLumenMcpServer({
    resourcePaths: [...byPath.keys()],
    getDocument: async path => byPath.get(path)?.content ?? null,
    search: async (query, { limit = 20 }) => {
      const lower = query.toLowerCase();
      return documents.filter(doc => [doc.title, doc.path, doc.text].some(text => text.toLowerCase().includes(lower)))
        .slice(0, limit).map(doc => ({ documentId: doc.id, title: doc.title, path: doc.path,
          snippet: doc.text.slice(0, 160), score: doc.title.toLowerCase().includes(lower) ? 1 : 0.85 }));
    },
  }, { name: '@omnitron-dev/lumen', version });
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize });
  const stop = () => { void server.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await new Promise<void>((resolve, reject) => {
      let failure: Error | undefined;
      server.server.onerror = error => { failure = error; console.error('Lumen MCP:', error.message); };
      server.server.onclose = () => failure ? reject(failure) : resolve();
      server.connect(transport).catch(reject);
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await server.close();
    // The SDK pauses stdin on close. This process-owned endpoint also releases
    // its pipe, so an over-limit sender cannot keep the terminated server alive.
    process.stdin.destroy();
  }
}
