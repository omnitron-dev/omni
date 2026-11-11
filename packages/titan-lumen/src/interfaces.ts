import type { RoleHierarchy } from '@omnitron-dev/access';

export interface SearchOptions {
  limit?: number;
  locale?: string;
  filter?: Record<string, unknown> & { roles?: string[] };
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

export interface LiveEditPayload {
  docId: string;
  patch: string;
  baseRevision: number;
  author?: string;
}

export interface LiveEditResult {
  success: boolean;
  revision: number;
  hash?: string;
  conflict?: boolean;
  error?: string;
  content?: string;
}

export interface AccessFilterOptions {
  hierarchy?: RoleHierarchy;
  grants?: Record<string, string[]>;
}

export interface ILumenModuleOptions {
  docsDir?: string;
  kbEnabled?: boolean;
  mcpEnabled?: boolean;
  mcpPort?: number;
  global?: boolean;
  accessFilter?: AccessFilterOptions;
}

export interface ILumenModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => Promise<ILumenModuleOptions> | ILumenModuleOptions;
  inject?: any[];
  global?: boolean;
}

export type LumenModuleOptions = ILumenModuleOptions;
export type LumenModuleAsyncOptions = ILumenModuleAsyncOptions;

export interface ILumenRpcService {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  executePlayground(code: string): Promise<PlaygroundResult | unknown>;
  getDocument(path: string): Promise<string | null>;
  getSymbolContract(symbol: string): Promise<SymbolContract | unknown | null>;
  getTheoremGraph(): Promise<TheoremGraphData>;
  saveLiveEdit(payload: LiveEditPayload): Promise<LiveEditResult>;
  getOptions(): ILumenModuleOptions;
}
