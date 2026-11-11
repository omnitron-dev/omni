import type { IncomingMessage } from 'node:http';
import type { KnowledgeBase } from '@omnitron-dev/kb';
import type { DocumentAccessOptions } from '@omnitron-dev/lumen-ast';
import type { AccessFilterService } from './access/access-filter.service.js';

export interface LumenSessionContext {
  valid: boolean;
  roles: string[];
  userId?: string;
}

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

export type AccessFilterOptions = DocumentAccessOptions;

export type TransportAuthResult = boolean | LumenSessionContext | null | undefined;

export interface HttpMcpTransportOptions {
  maxBodyBytes?: number;
  readTimeoutMs?: number;
  allowedOrigins?: string[];
  authorize?: (req: IncomingMessage) => Promise<TransportAuthResult> | TransportAuthResult;
  resolveSession?: (
    req: IncomingMessage
  ) => Promise<LumenSessionContext | null | undefined> | LumenSessionContext | null | undefined;
}

export interface SseMcpTransportOptions {
  maxConnections?: number;
  heartbeatIntervalMs?: number;
  allowedOrigins?: string[];
  accessFilter?: AccessFilterService;
  authorize?: (req: IncomingMessage) => Promise<TransportAuthResult> | TransportAuthResult;
  resolveSession?: (
    req: IncomingMessage
  ) => Promise<LumenSessionContext | null | undefined> | LumenSessionContext | null | undefined;
}

export interface ILumenModuleOptions {
  docsDir?: string;
  sourceDir?: string;
  kbEnabled?: boolean;
  knowledgeBase?: KnowledgeBase;
  mcpEnabled?: boolean;
  mcpPort?: number;
  global?: boolean;
  enablePlayground?: boolean;
  accessFilter?: AccessFilterOptions;
  liveEdit?: LiveEditServiceOptions;
}

export interface ILumenModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => Promise<ILumenModuleOptions> | ILumenModuleOptions;
  inject?: any[];
  global?: boolean;
}

export type LumenModuleOptions = ILumenModuleOptions;
export type LumenModuleAsyncOptions = ILumenModuleAsyncOptions;

/** The complete wire contract. Identity is resolved by Netron, never serialized here. */
export interface ILumenRpcService {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  executePlayground(code: string): Promise<PlaygroundResult>;
  getDocument(path: string): Promise<string | null>;
  getSymbolContract(symbol: string): Promise<SymbolContract | null>;
  getTheoremGraph(): Promise<TheoremGraphData>;
  saveLiveEdit(payload: LiveEditPayload): Promise<LiveEditResult>;
}

/** In-process operations for adapters which have already resolved a trusted session. */
export interface ILumenService extends ILumenRpcService {
  search(query: string, options?: SearchOptions, session?: LumenSessionContext): Promise<SearchResult[]>;
  executePlayground(code: string, session?: LumenSessionContext): Promise<PlaygroundResult>;
  getDocument(path: string, session?: LumenSessionContext): Promise<string | null>;
  getSymbolContract(symbol: string, session?: LumenSessionContext): Promise<SymbolContract | null>;
  getTheoremGraph(session?: LumenSessionContext): Promise<TheoremGraphData>;
  saveLiveEdit(payload: LiveEditPayload, session?: LumenSessionContext): Promise<LiveEditResult>;
  getOptions(): ILumenModuleOptions;
}
