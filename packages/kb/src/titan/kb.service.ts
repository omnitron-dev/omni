import { KnowledgeBase } from '../core/knowledge-base.js';
import { NullEmbeddingProvider } from '../embeddings/providers/null.provider.js';
import type {
  IKbModuleConfig,
  IKbStore,
  IEmbeddingProvider,
  IQueryResult,
  IQueryOptions,
  ISymbolDoc,
  ISpecDoc,
  IGotchaDoc,
  IPatternDoc,
  IDependency,
  IKbStats,
  SymbolKind,
} from '../core/types.js';

/**
 * Injectable KnowledgeBase service for Titan DI.
 * Wraps the core KnowledgeBase with lifecycle management.
 */
export class KnowledgeBaseService {
  private kb: KnowledgeBase;
  private initialized = false;

  constructor(
    private readonly config: IKbModuleConfig,
    private readonly store: IKbStore,
  ) {
    const embeddings = this.createEmbeddingProvider();

    this.kb = new KnowledgeBase({
      store: this.store,
      embeddings,
      root: this.config.root,
      usePrebuilt: true,
    });
  }

  /**
   * Titan lifecycle hook — called after DI container resolves all dependencies.
   */
  async onModuleInit(): Promise<void> {
    await this.kb.initialize();
    this.initialized = true;

    if (this.config.autoIndex) {
      const result = await this.kb.reindex();
      console.log(
        `[kb] Auto-index complete: ${result.indexed} indexed, ${result.skipped} skipped`,
      );
    }
  }

  /**
   * Titan lifecycle hook — cleanup.
   */
  async onModuleDestroy(): Promise<void> {
    await this.kb.close();
  }

  // ---- Delegated API (same as KnowledgeBase) --------------------------------

  async query(question: string, options?: IQueryOptions): Promise<IQueryResult> {
    return this.kb.query(question, options);
  }

  async getApi(symbolName: string): Promise<ISymbolDoc | null> {
    return this.kb.getApi(symbolName);
  }

  async getModule(path: string) {
    return this.kb.getModule(path);
  }

  async getRepoMap(options?: { scope?: string; detail?: 'overview' | 'signatures' | 'full' }) {
    return this.kb.getRepoMap(options);
  }

  async getPattern(name: string): Promise<IPatternDoc | null> {
    return this.kb.getPattern(name);
  }

  async listPatterns(): Promise<IPatternDoc[]> {
    return this.kb.listPatterns();
  }

  async getGotchas(module?: string): Promise<IGotchaDoc[]> {
    return this.kb.getGotchas(module);
  }

  async searchSymbols(query: string, kind?: SymbolKind | SymbolKind[]): Promise<ISymbolDoc[]> {
    return this.kb.searchSymbols(query, kind);
  }

  async getDependencies(modulePath: string) {
    return this.kb.getDependencies(modulePath);
  }

  async reindex(options?: { full?: boolean }) {
    return this.kb.reindex(options);
  }

  async status(): Promise<IKbStats> {
    return this.kb.status();
  }

  // ---- Private --------------------------------------------------------------

  private createEmbeddingProvider(): IEmbeddingProvider {
    const embConfig = this.config.embeddings;
    if (!embConfig || !embConfig.provider) {
      return new NullEmbeddingProvider();
    }

    // Lazy-load providers to avoid bundling unused deps
    switch (embConfig.provider) {
      case 'voyage': {
        // Will be loaded dynamically at runtime
        const { VoyageEmbeddingProvider } = require('../embeddings/providers/voyage.provider.js');
        return new VoyageEmbeddingProvider({
          apiKey: embConfig.apiKey ?? process.env['VOYAGE_API_KEY'] ?? '',
          codeModel: embConfig.codeModel,
          textModel: embConfig.textModel,
        });
      }
      case 'openai': {
        const { OpenAIEmbeddingProvider } = require('../embeddings/providers/openai.provider.js');
        return new OpenAIEmbeddingProvider({
          apiKey: embConfig.apiKey ?? process.env['OPENAI_API_KEY'] ?? '',
          model: embConfig.codeModel,
        });
      }
      case 'ollama': {
        const { OllamaEmbeddingProvider } = require('../embeddings/providers/ollama.provider.js');
        return new OllamaEmbeddingProvider({
          model: embConfig.codeModel,
          url: embConfig.url,
        });
      }
      default:
        return new NullEmbeddingProvider();
    }
  }
}
