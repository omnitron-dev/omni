import { resolve } from 'node:path';
import { KnowledgeDiscovery } from '../discovery/discovery.js';
import { Indexer } from '../indexer/indexer.js';
import { NullEmbeddingProvider } from '../embeddings/providers/null.provider.js';
import { RepoMapGenerator } from '../extractors/repo-map/repo-map.generator.js';
import type {
  IKbStore,
  IEmbeddingProvider,
  IQueryResult,
  IQueryOptions,
  ISymbolDoc,
  IModuleInfo,
  ISpecDoc,
  IGotchaDoc,
  IPatternDoc,
  IDependency,
  IKbStats,
  SymbolKind,
} from './types.js';

export interface KnowledgeBaseConfig {
  /** KB store implementation */
  store: IKbStore;
  /** Embedding provider (optional, defaults to NullProvider) */
  embeddings?: IEmbeddingProvider;
  /** Workspace root for discovery */
  root: string;
  /** Path to built-in cross-cutting specs */
  builtinSpecs?: string;
  /** Use pre-built extraction from kb/generated/ when available */
  usePrebuilt?: boolean;
}

/**
 * Main KnowledgeBase facade — unified query API for all knowledge types.
 *
 * @example
 * ```typescript
 * const kb = new KnowledgeBase({
 *   store: new SurrealKbStore({ url: 'surrealkv://~/.omnitron/kb.db' }),
 *   root: '/path/to/monorepo',
 * });
 * await kb.initialize();
 * const result = await kb.query('how does auth middleware work');
 * ```
 */
export class KnowledgeBase {
  private readonly store: IKbStore;
  private readonly embeddings: IEmbeddingProvider;
  private readonly discovery: KnowledgeDiscovery;
  private readonly indexer: Indexer;
  private readonly repoMapGen: RepoMapGenerator;
  private readonly root: string;
  private readonly usePrebuilt: boolean;

  constructor(config: KnowledgeBaseConfig) {
    this.store = config.store;
    this.embeddings = config.embeddings ?? new NullEmbeddingProvider();
    this.root = config.root;
    this.usePrebuilt = config.usePrebuilt ?? true;

    // Specs are .md files shipped alongside dist/, not inside it
    const builtinSpecs = config.builtinSpecs
      ?? resolve(import.meta.dirname, '..', '..', 'specs', 'content');

    this.discovery = new KnowledgeDiscovery(builtinSpecs);
    this.indexer = new Indexer();
    this.repoMapGen = new RepoMapGenerator();
  }

  /**
   * Initialize the KB: connect store, discover sources, index if needed.
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Full reindex of all discovered sources.
   */
  async reindex(options?: { full?: boolean }): Promise<{ indexed: number; skipped: number }> {
    const sources = await this.discovery.discover(this.root);

    if (options?.full) {
      await this.indexer.indexAll(sources, this.store, {
        embeddings: this.embeddings,
        usePrebuilt: this.usePrebuilt,
      });
      return { indexed: sources.length, skipped: 0 };
    }

    return this.indexer.indexChanged(sources, this.store, {
      embeddings: this.embeddings,
      usePrebuilt: this.usePrebuilt,
    });
  }

  // ---- Query API (MCP tools map to these) ---------------------------------

  /**
   * Semantic + full-text hybrid search.
   * MCP: kb.query
   */
  async query(question: string, options?: IQueryOptions): Promise<IQueryResult> {
    let embedding: number[] | null = null;

    if (this.embeddings.dimension > 0) {
      try {
        const [vec] = await this.embeddings.embedText([question]);
        embedding = vec ?? null;
      } catch {
        // Fall back to text-only search
      }
    }

    return this.store.query(question, embedding, options ?? {});
  }

  /**
   * Get API surface of a symbol.
   * MCP: kb.get_api
   */
  async getApi(symbolName: string): Promise<ISymbolDoc | null> {
    return this.store.getSymbol(symbolName);
  }

  /**
   * Get module info + specs + dependencies.
   * MCP: kb.get_module
   */
  async getModule(path: string): Promise<{
    module: IModuleInfo | null;
    specs: ISpecDoc[];
    dependencies: IDependency[];
    dependents: IDependency[];
    gotchas: IGotchaDoc[];
  }> {
    const [module, specs, dependencies, dependents, gotchas] = await Promise.all([
      this.store.getModule(path),
      this.store.getModuleSpecs(path),
      this.store.getDependencies(path),
      this.store.getDependents(path),
      this.store.getGotchas(path),
    ]);
    return { module, specs, dependencies, dependents, gotchas };
  }

  /**
   * Get compressed repo map.
   * MCP: kb.repo_map
   */
  async getRepoMap(options?: {
    scope?: string;
    detail?: 'overview' | 'signatures' | 'full';
  }): Promise<string> {
    const pattern = await this.store.getPattern('repo-map');
    if (pattern) return pattern.content;
    return '# No repo map indexed yet. Run `omnitron kb index` first.';
  }

  /**
   * Get a development pattern.
   * MCP: kb.get_pattern
   */
  async getPattern(name: string): Promise<IPatternDoc | null> {
    return this.store.getPattern(name);
  }

  /**
   * List all patterns.
   * MCP: kb.list_patterns
   */
  async listPatterns(): Promise<IPatternDoc[]> {
    return this.store.listPatterns();
  }

  /**
   * Get gotchas/pitfalls.
   * MCP: kb.get_gotchas
   */
  async getGotchas(module?: string): Promise<IGotchaDoc[]> {
    return this.store.getGotchas(module);
  }

  /**
   * Search symbols by name/kind.
   * MCP: kb.search_symbols
   */
  async searchSymbols(query: string, kind?: SymbolKind | SymbolKind[]): Promise<ISymbolDoc[]> {
    return this.store.searchSymbols(query, kind);
  }

  /**
   * Get dependency graph.
   * MCP: kb.dependencies
   */
  async getDependencies(modulePath: string): Promise<{
    dependencies: IDependency[];
    dependents: IDependency[];
  }> {
    const [dependencies, dependents] = await Promise.all([
      this.store.getDependencies(modulePath),
      this.store.getDependents(modulePath),
    ]);
    return { dependencies, dependents };
  }

  /**
   * Get index statistics.
   * MCP: kb.status
   */
  async status(): Promise<IKbStats> {
    return this.store.getStats();
  }

  /**
   * Close the KB store.
   */
  async close(): Promise<void> {
    await this.store.close();
  }
}
