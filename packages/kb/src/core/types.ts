// ---------------------------------------------------------------------------
// @omnitron-dev/kb — Core Type Definitions
// ---------------------------------------------------------------------------

// ---- Knowledge Configuration ------------------------------------------------

/** Configuration returned by defineKnowledge() in each package's kb/kb.config.ts */
export interface IKbConfig {
  /** Module identifier (e.g. 'titan-redis', 'omnitron') */
  module: string;
  /** Human-readable name */
  name: string;
  /** Searchable tags */
  tags: string[];
  /** ts-morph extraction settings */
  extract: IExtractConfig;
  /** Path to specs directory (relative to kb/) */
  specs: string;
  /** Declared relationships to other modules */
  relationships?: IModuleRelationships;
}

export interface IExtractConfig {
  /** Extract all exported symbols from src/ (true) or specify entry points */
  symbols: boolean | string[];
  /** Decorator names to capture as significant metadata */
  decorators: string[];
  /** Entry point files for dependency graph analysis */
  entryPoints: string[];
}

export interface IModuleRelationships {
  /** Modules this one builds upon */
  extends?: string[];
  /** Modules this one integrates with */
  integrates?: string[];
  /** Modules this one replaces */
  replaces?: string[];
}

// ---- Knowledge Sources ------------------------------------------------------

export type KbSourceType = 'builtin' | 'workspace' | 'external';

export interface IKbSource {
  /** Source type for provenance tracking */
  type: KbSourceType;
  /** Absolute path to the kb/ directory */
  path: string;
  /** Absolute path to the package root (parent of kb/) */
  root: string;
  /** Package name from package.json */
  packageName: string;
  /** Parsed kb.config.ts */
  config: IKbConfig;
}

// ---- Module -----------------------------------------------------------------

export interface IModuleInfo {
  /** SurrealDB record ID */
  id?: string;
  /** Module path (e.g. 'titan/netron/auth') */
  path: string;
  /** npm package name */
  package: string;
  /** Human-readable name */
  name: string;
  /** One-line summary */
  summary: string;
  /** Searchable tags */
  tags: string[];
  /** Source provenance */
  source: KbSourceType;
  /** Token cost to load full module info */
  tokens: number;
}

// ---- Symbol (ts-morph extracted) -------------------------------------------

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'const'
  | 'decorator';

export interface ISymbolDoc {
  /** SurrealDB record ID */
  id?: string;
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKind;
  /** Module this symbol belongs to */
  module: string;
  /** File path relative to package root */
  filePath: string;
  /** Line number in source */
  line: number;
  /** Compressed one-line signature */
  signature: string;
  /** JSDoc description if present */
  jsdoc?: string;
  /** Decorators applied to this symbol */
  decorators: IDecoratorDoc[];
  /** Class/interface members (methods, properties) */
  members: IMemberDoc[];
  /** Interfaces this symbol implements */
  implements?: string[];
  /** Parent class this symbol extends */
  extends?: string;
  /** Export path (e.g. '@omnitron-dev/titan/netron') */
  exportPath?: string;
  /** Embedding vector (populated at index time) */
  embedding?: number[];
}

export interface IDecoratorDoc {
  /** Decorator name (e.g. 'Service', 'Public', 'Inject') */
  name: string;
  /** Decorator arguments as serialized values */
  args: Record<string, unknown>;
}

export interface IMemberDoc {
  /** Member name */
  name: string;
  /** 'method' | 'property' | 'accessor' */
  kind: 'method' | 'property' | 'accessor';
  /** Visibility */
  visibility: 'public' | 'protected' | 'private';
  /** Compressed signature (for methods: params + return type) */
  signature: string;
  /** Decorators on this member */
  decorators: IDecoratorDoc[];
  /** Is this member static? */
  isStatic: boolean;
  /** Is this member async? */
  isAsync: boolean;
  /** JSDoc description */
  jsdoc?: string;
}

// ---- Spec (human-written knowledge) ----------------------------------------

export interface ISpecDoc {
  /** SurrealDB record ID */
  id?: string;
  /** Module this spec belongs to */
  module: string;
  /** Spec title from frontmatter */
  title: string;
  /** Full markdown content */
  content: string;
  /** Frontmatter tags */
  tags: string[];
  /** One-line summary from frontmatter */
  summary: string;
  /** File path relative to kb/specs/ */
  filePath: string;
  /** Dependencies declared in frontmatter */
  dependsOn: string[];
  /** Token cost */
  tokens: number;
  /** Embedding vector */
  embedding?: number[];
}

export interface ISpecFrontmatter {
  module: string;
  tags: string[];
  summary: string;
  depends_on?: string[];
  title?: string;
}

// ---- Code Chunk (for embedding search) -------------------------------------

export interface ICodeChunk {
  /** SurrealDB record ID */
  id?: string;
  /** Source file path */
  source: string;
  /** Line range */
  range: { start: number; end: number };
  /** Chunk content */
  content: string;
  /** Associated symbol (if chunk is within a symbol boundary) */
  symbol?: string;
  /** Package name */
  package: string;
  /** Token count */
  tokens: number;
  /** Embedding vector */
  embedding?: number[];
}

// ---- Gotcha (critical pitfalls) --------------------------------------------

export interface IGotchaDoc {
  /** SurrealDB record ID */
  id?: string;
  /** Title */
  title: string;
  /** Module (optional — global gotchas have no module) */
  module?: string;
  /** Severity */
  severity: 'critical' | 'warning' | 'info';
  /** Markdown content */
  content: string;
  /** Tags */
  tags: string[];
  /** Embedding vector */
  embedding?: number[];
}

// ---- Pattern (development patterns) ----------------------------------------

export interface IPatternDoc {
  /** SurrealDB record ID */
  id?: string;
  /** Pattern identifier (e.g. 'service-rpc-module') */
  name: string;
  /** Human-readable title */
  title: string;
  /** Full markdown content with code examples */
  content: string;
  /** Tags */
  tags: string[];
  /** Embedding vector */
  embedding?: number[];
}

// ---- Dependency Graph (relations) ------------------------------------------

export type DependencyKind = 'import' | 'di' | 'peer' | 'extends' | 'implements';

export interface IDependency {
  /** Source module or symbol */
  from: string;
  /** Target module or symbol */
  to: string;
  /** Relationship kind */
  kind: DependencyKind;
  /** DI token name (for kind === 'di') */
  token?: string;
}

// ---- Repo Map ---------------------------------------------------------------

export interface IRepoMap {
  /** Package overviews ordered by importance */
  packages: IPackageOverview[];
  /** Module-level dependency graph */
  dependencyGraph: Record<string, string[]>;
  /** Total token cost of the full map */
  totalTokens: number;
  /** Generated timestamp */
  generatedAt: string;
}

export interface IPackageOverview {
  /** Package name */
  name: string;
  /** One-line description */
  description: string;
  /** Key exported symbols (ranked by importance) */
  keySymbols: string[];
  /** Export paths */
  exports: string[];
  /** Direct dependencies */
  dependencies: string[];
}

// ---- Generated Extraction Output (build-time) ------------------------------

export interface IExtractedData {
  /** Extracted symbols */
  symbols: ISymbolDoc[];
  /** Decorator usage map */
  decorators: IDecoratorUsageMap;
  /** Dependency graph */
  dependencies: IDependency[];
  /** Repo map for this package */
  repoMap: IPackageOverview;
  /** File hash manifest for incremental builds */
  manifest: IManifest;
}

export interface IDecoratorUsageMap {
  [decoratorName: string]: Array<{
    symbol: string;
    filePath: string;
    args: Record<string, unknown>;
  }>;
}

export interface IManifest {
  /** Hash per source file */
  files: Record<string, string>;
  /** Overall manifest hash */
  hash: string;
  /** Timestamp of extraction */
  extractedAt: string;
  /** Package version at extraction time */
  packageVersion: string;
}

// ---- Query API --------------------------------------------------------------

export interface IQueryOptions {
  /** Max chunks/entries to return */
  maxResults?: number;
  /** Scope to specific packages */
  scope?: string | string[];
  /** Filter by kind */
  kind?: SymbolKind | SymbolKind[];
  /** Filter by tags */
  tags?: string[];
  /** Include embedding scores in results */
  includeScores?: boolean;
}

export interface IQueryResult {
  /** Matched entries */
  entries: IKnowledgeEntry[];
  /** Total token cost of returned entries */
  totalTokens: number;
  /** Sources that contributed results */
  sources: Array<'spec' | 'api' | 'chunk' | 'gotcha' | 'pattern'>;
  /** Search scores (if includeScores was true) */
  scores?: number[];
}

/** Union type for any queryable knowledge entry */
export interface IKnowledgeEntry {
  /** Entry ID */
  id: string;
  /** Entry kind */
  kind: 'api' | 'spec' | 'chunk' | 'gotcha' | 'pattern';
  /** Module this entry belongs to */
  module: string;
  /** Title or name */
  title: string;
  /** Content (markdown or structured) */
  content: string;
  /** Tags */
  tags: string[];
  /** Token cost */
  tokens: number;
}

// ---- Embedding Provider -----------------------------------------------------

export interface IEmbeddingProvider {
  /** Provider name for logging */
  readonly name: string;
  /** Embed code content */
  embedCode(texts: string[]): Promise<number[][]>;
  /** Embed natural language content (specs, docs) */
  embedText(texts: string[]): Promise<number[][]>;
  /** Vector dimension */
  readonly dimension: number;
}

// ---- KB Store (SurrealDB abstraction) ---------------------------------------

export interface IKbStore {
  /** Initialize the store (apply schema, connect) */
  initialize(): Promise<void>;
  /** Store module info */
  upsertModule(module: IModuleInfo): Promise<void>;
  /** Store symbols */
  upsertSymbols(symbols: ISymbolDoc[]): Promise<void>;
  /** Store specs */
  upsertSpecs(specs: ISpecDoc[]): Promise<void>;
  /** Store chunks */
  upsertChunks(chunks: ICodeChunk[]): Promise<void>;
  /** Store gotchas */
  upsertGotchas(gotchas: IGotchaDoc[]): Promise<void>;
  /** Store patterns */
  upsertPatterns(patterns: IPatternDoc[]): Promise<void>;
  /** Store dependency relations */
  upsertDependencies(deps: IDependency[]): Promise<void>;
  /** Hybrid search (vector + full-text) */
  query(question: string, embedding: number[] | null, options: IQueryOptions): Promise<IQueryResult>;
  /** Get symbol by name */
  getSymbol(name: string): Promise<ISymbolDoc | null>;
  /** Get module info */
  getModule(path: string): Promise<IModuleInfo | null>;
  /** Get all specs for a module */
  getModuleSpecs(modulePath: string): Promise<ISpecDoc[]>;
  /** Get dependency graph for a module */
  getDependencies(modulePath: string): Promise<IDependency[]>;
  /** Get reverse dependencies (who depends on this) */
  getDependents(modulePath: string): Promise<IDependency[]>;
  /** Get gotchas (optionally filtered by module) */
  getGotchas(modulePath?: string): Promise<IGotchaDoc[]>;
  /** Get pattern by name */
  getPattern(name: string): Promise<IPatternDoc | null>;
  /** List all patterns */
  listPatterns(): Promise<IPatternDoc[]>;
  /** Search symbols by name/kind */
  searchSymbols(query: string, kind?: SymbolKind | SymbolKind[]): Promise<ISymbolDoc[]>;
  /** Get index statistics */
  getStats(): Promise<IKbStats>;
  /** Get stored manifest for a package */
  getManifest(packageName: string): Promise<IManifest | null>;
  /** Store manifest */
  upsertManifest(packageName: string, manifest: IManifest): Promise<void>;
  /** Close connection */
  close(): Promise<void>;
}

export interface IKbStats {
  modules: number;
  symbols: number;
  specs: number;
  chunks: number;
  gotchas: number;
  patterns: number;
  dependencies: number;
  embeddingsIndexed: number;
  lastIndexedAt: string | null;
  byPackage: Record<string, {
    symbols: number;
    specs: number;
    chunks: number;
  }>;
}

// ---- KB Module Config (Titan DI) -------------------------------------------

export interface IKbModuleConfig {
  /** Path to SurrealDB storage file (embedded mode) or URL (remote) */
  dbPath: string;
  /** Workspace root for discovery */
  root: string;
  /** Embedding provider configuration */
  embeddings?: IEmbeddingConfig;
  /** Auto-index on module init */
  autoIndex?: boolean;
  /** Watch files for incremental updates */
  watchMode?: boolean;
  /** Additional spec paths to include */
  additionalSpecs?: string[];
}

export interface IEmbeddingConfig {
  /** Provider name */
  provider: 'voyage' | 'openai' | 'ollama' | null;
  /** Model for code embeddings */
  codeModel?: string;
  /** Model for text embeddings */
  textModel?: string;
  /** API key (or env var reference) */
  apiKey?: string;
  /** Provider URL (for ollama) */
  url?: string;
}
