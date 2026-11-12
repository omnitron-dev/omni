import type { KnowledgeBase } from '@omnitron-dev/kb';
import type { DocumentAccessOptions } from '@omnitron-dev/lumen-ast';
import type { DynamicModule, InjectionToken } from '@omnitron-dev/titan/nexus';

export interface SearchOptions {
  limit?: number;
  locale?: string;
}

export interface SearchResult {
  documentId: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
}

export interface PlaygroundResult {
  code: string;
  result: unknown;
  error?: string;
}

export interface SymbolContract {
  name: string;
  kind?: string;
  filePath?: string;
  signatures?: string[];
  methods?: Record<string, unknown>;
}

export interface TheoremGraphNode {
  id: string;
  type:
    'axiom' | 'theorem' | 'definition' | 'lemma' | 'proposition' | 'corollary' | 'hypothesis' | 'remark' | 'example';
  title: string;
  status?: string;
  path?: string;
}

export interface TheoremGraphEdge {
  source: string;
  target: string;
  relation: 'dependsOn' | 'proves' | 'references';
}

export interface TheoremGraphData {
  nodes: TheoremGraphNode[];
  edges: TheoremGraphEdge[];
}

export type LiveEditMode = 'append' | 'replace' | 'line-range';

export interface LiveEditPayload {
  docId: string;
  patch: string;
  baseRevision: number;
  author?: string;
  mode?: LiveEditMode;
  startLine?: number;
  endLine?: number;
  access?: string;
}

export interface LiveEditResult {
  success: boolean;
  revision: number;
  hash?: string;
  conflict?: boolean;
  error?: string;
  content?: string;
}

export interface LiveEditEvent {
  docId: string;
  revision: number;
  hash: string;
  patch: string;
  author?: string;
  mode: LiveEditMode;
  access: string;
}

export interface LiveEditServiceOptions {
  maxDocuments?: number;
  maxPatchBytes?: number;
  maxDocumentBytes?: number;
}

export interface LumenModuleOptions {
  docsDir?: string;
  sourceDir?: string;
  /** Source-level floor; individual document rules can only restrict it further. Defaults to internal. */
  sourceAccess?: string;
  knowledgeBaseAccess?: string;
  /** Bound complete inventories; exceeding a limit fails instead of returning partial results. */
  corpusLimits?: { maxEntries?: number; maxBytes?: number; maxDepth?: number };
  kbEnabled?: boolean;
  knowledgeBase?: KnowledgeBase;
  global?: boolean;
  enablePlayground?: boolean;
  accessFilter?: DocumentAccessOptions;
  liveEdit?: LiveEditServiceOptions;
}

export interface LumenModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  useFactory: (...args: any[]) => Promise<LumenModuleOptions> | LumenModuleOptions;
  inject?: InjectionToken[];
  global?: boolean;
}

/** The complete wire contract. Identity is resolved by Netron, never serialized here. */
export interface LumenServiceContract {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  executePlayground(code: string): Promise<PlaygroundResult>;
  getDocument(path: string): Promise<string | null>;
  getSymbolContract(symbol: string): Promise<SymbolContract | null>;
  getTheoremGraph(): Promise<TheoremGraphData>;
  saveLiveEdit(payload: LiveEditPayload): Promise<LiveEditResult>;
}
