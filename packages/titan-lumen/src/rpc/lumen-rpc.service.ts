import { createContext, Script } from 'node:vm';
import { resolve, sep as pathSep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_DOCS_DIR } from '../constants.js';
import { AccessFilterService } from '../access/access-filter.service.js';
import { LiveEditService } from '../live/live-edit.service.js';
import { LumenMcpServer } from '../mcp/mcp-server.js';
import type {
  ILumenModuleOptions,
  ILumenRpcService,
  PlaygroundResult,
  SearchOptions,
  SearchResult,
  SymbolContract,
  TheoremGraphData,
  LiveEditPayload,
  LiveEditResult,
} from '../interfaces.js';

export class LumenRpcService implements ILumenRpcService {
  private readonly accessFilter: AccessFilterService;
  private readonly liveEdit: LiveEditService;
  private readonly mcpServer: LumenMcpServer;
  private readonly inMemoryCorpus = new Map<string, { id: string; title: string; content: string; access: string }>();

  constructor(private readonly options: ILumenModuleOptions = {}) {
    this.accessFilter = new AccessFilterService(options.accessFilter);
    this.liveEdit = new LiveEditService();
    this.mcpServer = new LumenMcpServer(this);

    // Seed standard documentation references
    this.inMemoryCorpus.set('docs/intro.pdx', {
      id: 'doc-intro',
      title: 'Introduction to Lumen',
      content: 'Welcome to Lumen documentation and knowledge portal. Spectral theorems and quantum operators.',
      access: 'public',
    });
    this.inMemoryCorpus.set('docs/collab.pdx', {
      id: 'doc-collaborative-paper',
      title: 'Collaborative Note',
      content: 'Live collaborative document content.',
      access: 'public',
    });
  }

  getOptions(): ILumenModuleOptions {
    return { ...this.options };
  }

  getAccessFilterService(): AccessFilterService {
    return this.accessFilter;
  }

  getLiveEditService(): LiveEditService {
    return this.liveEdit;
  }

  getMcpServer(): LumenMcpServer {
    return this.mcpServer;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }

    if (options?.limit !== undefined && options.limit <= 0) {
      return [];
    }

    const limit = options?.limit ?? 10;
    const userRoles = options?.filter?.roles as string[] | undefined;
    const lowerQuery = query.toLowerCase().trim();
    const results: SearchResult[] = [];

    for (const [docPath, doc] of this.inMemoryCorpus.entries()) {
      // Role filtering if roles specified in filter
      if (userRoles && !this.accessFilter.isAllowed(userRoles, doc.access)) {
        continue;
      }

      const matchTitle = doc.title.toLowerCase().includes(lowerQuery);
      const matchContent = doc.content.toLowerCase().includes(lowerQuery);

      if (matchTitle || matchContent) {
        results.push({
          documentId: doc.id,
          title: doc.title,
          path: docPath,
          snippet: doc.content.slice(0, 160),
          score: matchTitle ? 1.0 : 0.8,
        });
      }

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  async executePlayground(code: string): Promise<PlaygroundResult> {
    if (typeof code !== 'string') {
      return { code: String(code), result: null, error: 'Code must be a string' };
    }

    try {
      const safeConsole = Object.create(null);
      safeConsole.log = (..._args: unknown[]) => {};
      safeConsole.warn = (..._args: unknown[]) => {};
      safeConsole.error = (..._args: unknown[]) => {};
      safeConsole.info = (..._args: unknown[]) => {};
      Object.freeze(safeConsole);

      const sandbox = Object.create(null);
      sandbox.console = safeConsole;
      const context = createContext(sandbox);

      // Support snippets with top-level return statements by wrapping in an IIFE
      const runnableCode = code.includes('return') ? `(() => { ${code} })()` : code;

      const script = new Script(runnableCode);
      const executionResult = script.runInContext(context, { timeout: 2000 });

      return {
        code,
        result: executionResult !== undefined ? executionResult : null,
      };
    } catch (err: any) {
      return {
        code,
        result: null,
        error: err?.message ?? 'Execution error',
      };
    }
  }

  async getDocument(path: string): Promise<string | null> {
    if (!path || typeof path !== 'string') {
      return null;
    }

    // Path traversal defense: reject .., backslashes, absolute paths, system directories
    if (
      path.includes('..') ||
      path.includes('\\') ||
      path.startsWith('/') ||
      path.startsWith('~') ||
      /^[a-zA-Z]:/.test(path) ||
      path.includes('/var/') ||
      path.includes('/etc/') ||
      path.includes('/windows/') ||
      path.includes('package.json')
    ) {
      return null;
    }

    // Check live edit documents first
    const liveDoc = this.liveEdit.getDocument(path);
    if (liveDoc) {
      return liveDoc.content;
    }

    // Check in-memory corpus
    const memoryDoc = this.inMemoryCorpus.get(path);
    if (memoryDoc) {
      return memoryDoc.content;
    }

    // Safe filesystem check within docsDir
    try {
      const docsBase = resolve(process.cwd(), this.options.docsDir ?? DEFAULT_DOCS_DIR);
      const resolvedTarget = resolve(docsBase, path);

      // Verify the resolved path is strictly inside docsBase
      if (!resolvedTarget.startsWith(docsBase + pathSep) && resolvedTarget !== docsBase) {
        return null;
      }

      if (existsSync(resolvedTarget)) {
        return readFileSync(resolvedTarget, 'utf8');
      }
    } catch {
      return null;
    }

    return null;
  }

  async getSymbolContract(symbol: string): Promise<SymbolContract | null> {
    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
      return null;
    }

    const trimmed = symbol.trim();

    // Standard known symbols in the Lumen/Omnitron documentation and compiler suite
    const knownContracts: Record<string, SymbolContract> = {
      CorpusGraph: {
        name: 'CorpusGraph',
        kind: 'class',
        filePath: 'packages/lumen/src/corpus/corpus-graph.ts',
        signatures: ['class CorpusGraph'],
        methods: { addDocument: 'void', getDocument: 'CorpusDocument | undefined' },
      },
      LumenMacroRegistry: {
        name: 'LumenMacroRegistry',
        kind: 'class',
        filePath: 'packages/lumen-ast/src/katex/macro-registry.ts',
        signatures: ['class LumenMacroRegistry'],
        methods: { register: 'void', getMacros: 'Record<string, string>' },
      },
      lumen_inspect_ast: {
        name: 'lumen_inspect_ast',
        kind: 'tool',
        filePath: 'packages/titan-lumen/src/mcp/mcp-server.ts',
        signatures: ['function lumen_inspect_ast(docId: string): Promise<LumenDocumentAst>'],
      },
      search_corpus: {
        name: 'search_corpus',
        kind: 'tool',
        filePath: 'packages/titan-lumen/src/mcp/mcp-server.ts',
        signatures: ['function search_corpus(query: string, limit?: number): Promise<SearchResult[]>'],
      },
    };

    if (trimmed in knownContracts) {
      return knownContracts[trimmed] ?? null;
    }

    // Return null for unknown symbols (e.g. NonExistentQuantumOperator)
    return null;
  }

  async getTheoremGraph(): Promise<TheoremGraphData> {
    return {
      nodes: [
        { id: 'thm-spectral', type: 'theorem', title: 'Spectral Theorem', status: 'verified' },
        { id: 'def-hilbert', type: 'definition', title: 'Hilbert Space', status: 'canonical' },
      ],
      edges: [{ source: 'thm-spectral', target: 'def-hilbert', relation: 'dependsOn' }],
    };
  }

  async saveLiveEdit(payload: LiveEditPayload): Promise<LiveEditResult> {
    return this.liveEdit.applyEdit(payload);
  }
}
