import { createHash } from 'node:crypto';
import { KB_SCHEMA, getVectorIndexSchema } from './schema.js';
import type {
  IKbStore,
  IModuleInfo,
  ISymbolDoc,
  ISpecDoc,
  ICodeChunk,
  IGotchaDoc,
  IPatternDoc,
  IDependency,
  IQueryResult,
  IQueryOptions,
  IKnowledgeEntry,
  IKbStats,
  IManifest,
  SymbolKind,
} from '../core/types.js';

export interface SurrealKbStoreConfig {
  /** Connection URL: 'surrealkv://path' for embedded, 'wss://host' for remote */
  url: string;
  /** SurrealDB namespace */
  namespace?: string;
  /** SurrealDB database */
  database?: string;
  /** Embedding dimension (for HNSW index creation) */
  embeddingDimension?: number;
}

/**
 * SurrealDB-backed knowledge base store.
 * Supports embedded (SurrealKV) and remote (WebSocket) modes.
 *
 * Uses dynamic import for surrealdb to keep it as an optional peer dependency.
 */
export class SurrealKbStore implements IKbStore {
  private db: any = null;
  private readonly config: Required<SurrealKbStoreConfig>;

  constructor(config: SurrealKbStoreConfig) {
    this.config = {
      namespace: 'omnitron',
      database: 'kb',
      embeddingDimension: 0,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    const { Surreal } = await import('surrealdb');

    // Check if embedded engine is needed (non-ws/http URLs)
    const isRemote = this.config.url.startsWith('ws') || this.config.url.startsWith('http');
    if (!isRemote) {
      try {
        const { createNodeEngines } = await import('@surrealdb/node');
        this.db = new Surreal({ engines: createNodeEngines() });
      } catch {
        // @surrealdb/node not installed — fall back to basic Surreal
        this.db = new Surreal();
      }
    } else {
      this.db = new Surreal();
    }

    await this.db.connect(this.config.url);
    await this.db.use({
      namespace: this.config.namespace,
      database: this.config.database,
    });

    // Apply schema (idempotent)
    await this.db.query(KB_SCHEMA);

    // Apply vector indexes if embedding dimension is known
    if (this.config.embeddingDimension > 0) {
      await this.db.query(getVectorIndexSchema(this.config.embeddingDimension));
    }
  }

  // ---- Upsert operations --------------------------------------------------

  async upsertModule(module: IModuleInfo): Promise<void> {
    const id = this.hashId(module.path);
    await this.db.query(
      `UPSERT module:⟨${id}⟩ SET
        path = $path, package = $package, name = $name,
        summary = $summary, tags = $tags, source = $source, tokens = $tokens`,
      module,
    );
  }

  async upsertSymbols(symbols: ISymbolDoc[]): Promise<void> {
    for (const sym of symbols) {
      const id = this.hashId(`${sym.module}:${sym.name}`);
      await this.db.query(
        `UPSERT symbol:⟨${id}⟩ SET
          name = $name, kind = $kind, module = $module, filePath = $filePath,
          line = $line, signature = $signature, jsdoc = $jsdoc,
          decorators = $decorators, members = $members,
          implements = $implements, extends = $extends,
          exportPath = $exportPath, embedding = $embedding`,
        {
          ...sym,
          embedding: sym.embedding ?? undefined,
          jsdoc: sym.jsdoc ?? undefined,
          implements: sym.implements ?? undefined,
          extends: sym.extends ?? undefined,
          exportPath: sym.exportPath ?? undefined,
        },
      );
    }
  }

  async upsertSpecs(specs: ISpecDoc[]): Promise<void> {
    for (const spec of specs) {
      const id = this.hashId(`${spec.module}:${spec.filePath}`);
      await this.db.query(
        `UPSERT spec:⟨${id}⟩ SET
          module = $module, title = $title, content = $content,
          tags = $tags, summary = $summary, filePath = $filePath,
          dependsOn = $dependsOn, tokens = $tokens, embedding = $embedding`,
        { ...spec, embedding: spec.embedding ?? undefined },
      );
    }
  }

  async upsertChunks(chunks: ICodeChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const id = this.hashId(`${chunk.source}:${chunk.range.start}-${chunk.range.end}`);
      await this.db.query(
        `UPSERT chunk:⟨${id}⟩ SET
          source = $source, range = $range, content = $content,
          symbol = $symbol, package = $package, tokens = $tokens,
          embedding = $embedding`,
        { ...chunk, embedding: chunk.embedding ?? undefined, symbol: chunk.symbol ?? undefined },
      );
    }
  }

  async upsertGotchas(gotchas: IGotchaDoc[]): Promise<void> {
    for (const gotcha of gotchas) {
      const id = this.hashId(gotcha.title);
      await this.db.query(
        `UPSERT gotcha:⟨${id}⟩ SET
          title = $title, module = $module, severity = $severity,
          content = $content, tags = $tags, embedding = $embedding`,
        { ...gotcha, embedding: gotcha.embedding ?? undefined, module: gotcha.module ?? undefined },
      );
    }
  }

  async upsertPatterns(patterns: IPatternDoc[]): Promise<void> {
    for (const pattern of patterns) {
      const id = this.hashId(pattern.name);
      await this.db.query(
        `UPSERT pattern:⟨${id}⟩ SET
          name = $name, title = $title, content = $content,
          tags = $tags, embedding = $embedding`,
        { ...pattern, embedding: pattern.embedding ?? undefined },
      );
    }
  }

  async upsertDependencies(deps: IDependency[]): Promise<void> {
    // Store dependencies as simple records (graph relations require specific SurrealDB syntax per version)
    for (const dep of deps) {
      try {
        await this.db.query(
          `CREATE depends_on SET \`in\` = $from, out = $to, kind = $kind`,
          { from: dep.from, to: dep.to, kind: dep.kind },
        );
      } catch {
        // Ignore duplicate or invalid relations
      }
    }
  }

  // ---- Query operations ---------------------------------------------------

  async query(
    question: string,
    embedding: number[] | null,
    options: IQueryOptions,
  ): Promise<IQueryResult> {
    const maxResults = options.maxResults ?? 10;
    const entries: IKnowledgeEntry[] = [];
    const sources = new Set<IQueryResult['sources'][number]>();

    const q = question.toLowerCase();

    // Spec search (content + title)
    const ftResults = await this.db.query(
      `SELECT * FROM spec
       WHERE string::contains(string::lowercase(content), $q)
          OR string::contains(string::lowercase(title), $q)
       LIMIT $limit`,
      { q, limit: maxResults },
    );
    for (const row of this.extractRows(ftResults)) {
      entries.push({
        id: row.id,
        kind: 'spec',
        module: row.module,
        title: row.title,
        content: row.content,
        tags: row.tags,
        tokens: row.tokens,
      });
      sources.add('spec');
    }

    // Symbol search (name + signature)
    const symbolResults = await this.db.query(
      `SELECT * FROM symbol
       WHERE string::contains(string::lowercase(name), $q)
          OR string::contains(string::lowercase(signature), $q)
       LIMIT $limit`,
      { q, limit: maxResults },
    );
    for (const row of this.extractRows(symbolResults)) {
      entries.push({
        id: row.id,
        kind: 'api',
        module: row.module,
        title: row.name,
        content: row.signature,
        tags: [],
        tokens: Math.ceil(row.signature.length / 4),
      });
      sources.add('api');
    }

    // Gotcha search
    const gotchaResults = await this.db.query(
      `SELECT * FROM gotcha
       WHERE string::contains(string::lowercase(content), $q)
          OR string::contains(string::lowercase(title), $q)
       LIMIT $limit`,
      { q, limit: Math.min(maxResults, 5) },
    );
    for (const row of this.extractRows(gotchaResults)) {
      entries.push({
        id: row.id,
        kind: 'gotcha',
        module: row.module ?? '',
        title: row.title,
        content: row.content,
        tags: row.tags,
        tokens: Math.ceil(row.content.length / 4),
      });
      sources.add('gotcha');
    }

    // Pattern search
    const patternResults = await this.db.query(
      `SELECT * FROM pattern
       WHERE string::contains(string::lowercase(content), $q)
          OR string::contains(string::lowercase(title), $q)
       LIMIT $limit`,
      { q, limit: Math.min(maxResults, 5) },
    );
    for (const row of this.extractRows(patternResults)) {
      entries.push({
        id: row.id,
        kind: 'pattern',
        module: '',
        title: row.title,
        content: row.content,
        tags: row.tags,
        tokens: Math.ceil(row.content.length / 4),
      });
      sources.add('pattern');
    }

    // Vector search (if embedding provided)
    if (embedding) {
      const vecResults = await this.db.query(
        `SELECT *, vector::similarity::cosine(embedding, $vec) AS score
         FROM spec WHERE embedding <|${maxResults},200|> $vec
         ORDER BY score DESC LIMIT $limit`,
        { vec: embedding, limit: maxResults },
      );
      for (const row of this.extractRows(vecResults)) {
        // Avoid duplicates from full-text
        if (!entries.some(e => e.id === row.id)) {
          entries.push({
            id: row.id,
            kind: 'spec',
            module: row.module,
            title: row.title,
            content: row.content,
            tags: row.tags,
            tokens: row.tokens,
          });
          sources.add('spec');
        }
      }
    }

    // Apply scope filter
    const filtered = this.applyScope(entries, options);

    const totalTokens = filtered.reduce((sum, e) => sum + e.tokens, 0);

    return {
      entries: filtered.slice(0, maxResults),
      totalTokens,
      sources: [...sources],
    };
  }

  async getSymbol(name: string): Promise<ISymbolDoc | null> {
    const result = await this.db.query(
      'SELECT * FROM symbol WHERE name = $name LIMIT 1',
      { name },
    );
    const rows = this.extractRows(result);
    return rows[0] ?? null;
  }

  async getModule(path: string): Promise<IModuleInfo | null> {
    const result = await this.db.query(
      'SELECT * FROM module WHERE path = $path LIMIT 1',
      { path },
    );
    const rows = this.extractRows(result);
    return rows[0] ?? null;
  }

  async getModuleSpecs(modulePath: string): Promise<ISpecDoc[]> {
    const result = await this.db.query(
      'SELECT * FROM spec WHERE module = $module',
      { module: modulePath },
    );
    return this.extractRows(result);
  }

  async getDependencies(modulePath: string): Promise<IDependency[]> {
    const result = await this.db.query(
      `SELECT ->depends_on->module.path AS to, 'import' AS kind
       FROM module WHERE path = $path`,
      { path: modulePath },
    );
    const rows = this.extractRows(result);
    return rows.map((r: any) => ({
      from: modulePath,
      to: r.to,
      kind: r.kind ?? 'import',
    }));
  }

  async getDependents(modulePath: string): Promise<IDependency[]> {
    const result = await this.db.query(
      `SELECT <-depends_on<-module.path AS from, 'import' AS kind
       FROM module WHERE path = $path`,
      { path: modulePath },
    );
    const rows = this.extractRows(result);
    return rows.map((r: any) => ({
      from: r.from,
      to: modulePath,
      kind: r.kind ?? 'import',
    }));
  }

  async getGotchas(modulePath?: string): Promise<IGotchaDoc[]> {
    if (modulePath) {
      const result = await this.db.query(
        'SELECT * FROM gotcha WHERE module = $module ORDER BY severity ASC',
        { module: modulePath },
      );
      return this.extractRows(result);
    }
    const result = await this.db.query(
      'SELECT * FROM gotcha ORDER BY severity ASC',
    );
    return this.extractRows(result);
  }

  async getPattern(name: string): Promise<IPatternDoc | null> {
    const result = await this.db.query(
      'SELECT * FROM pattern WHERE name = $name LIMIT 1',
      { name },
    );
    const rows = this.extractRows(result);
    return rows[0] ?? null;
  }

  async listPatterns(): Promise<IPatternDoc[]> {
    const result = await this.db.query('SELECT * FROM pattern');
    return this.extractRows(result);
  }

  async searchSymbols(query: string, kind?: SymbolKind | SymbolKind[]): Promise<ISymbolDoc[]> {
    let sql = 'SELECT * FROM symbol WHERE string::contains(string::lowercase(name), $query)';
    const params: Record<string, unknown> = { query: query.toLowerCase() };

    if (kind) {
      const kinds = Array.isArray(kind) ? kind : [kind];
      sql += ' AND kind IN $kinds';
      params['kinds'] = kinds;
    }

    sql += ' LIMIT 50';
    const result = await this.db.query(sql, params);
    return this.extractRows(result);
  }

  async getStats(): Promise<IKbStats> {
    const countTable = async (table: string): Promise<number> => {
      const r = await this.db.query(`SELECT count() FROM ${table} GROUP ALL`);
      const rows = this.extractRows(r);
      return Number(rows[0]?.count ?? 0);
    };

    const [modules, symbols, specs, chunks, gotchas, patterns, dependencies] = await Promise.all([
      countTable('module'),
      countTable('symbol'),
      countTable('spec'),
      countTable('chunk'),
      countTable('gotcha'),
      countTable('pattern'),
      countTable('depends_on'),
    ]);

    return {
      modules,
      symbols,
      specs,
      chunks,
      gotchas,
      patterns,
      dependencies,
      embeddingsIndexed: 0,
      lastIndexedAt: null,
      byPackage: {},
    };
  }

  async getManifest(packageName: string): Promise<IManifest | null> {
    const result = await this.db.query(
      'SELECT * FROM manifest WHERE package = $package LIMIT 1',
      { package: packageName },
    );
    const rows = this.extractRows(result);
    return rows[0] ?? null;
  }

  async upsertManifest(packageName: string, manifest: IManifest): Promise<void> {
    const id = this.hashId(packageName);
    await this.db.query(
      `UPSERT manifest:⟨${id}⟩ SET
        package = $package, files = $files, hash = $hash,
        extractedAt = $extractedAt, packageVersion = $packageVersion`,
      { package: packageName, ...manifest },
    );
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // ---- Helpers ------------------------------------------------------------

  private extractRows(result: any): any[] {
    if (!result) return [];
    if (Array.isArray(result)) {
      // SurrealDB returns array of result sets
      for (const r of result) {
        if (Array.isArray(r)) return r;
        if (r?.result && Array.isArray(r.result)) return r.result;
      }
      return result;
    }
    return [];
  }

  private applyScope(entries: IKnowledgeEntry[], options: IQueryOptions): IKnowledgeEntry[] {
    if (!options.scope) return entries;
    const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
    return entries.filter(e =>
      scopes.some(s => e.module.includes(s)),
    );
  }

  /** Generate a deterministic short hash ID from a string key. */
  private hashId(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }
}
