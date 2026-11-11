/**
 * @omnitron-dev/titan-lumen
 * Titan Backend Integration Module for Lumen Documentation Suite.
 */

export { LumenModule } from './lumen.module.js';
export {
  LUMEN_OPTIONS_TOKEN,
  LUMEN_SERVICE_TOKEN,
  LUMEN_CONFIG_TOKEN,
  LUMEN_RPC_SERVICE_TOKEN,
  LUMEN_RPC_CONTROLLER_TOKEN,
  ACCESS_FILTER_SERVICE_TOKEN,
  LIVE_EDIT_SERVICE_TOKEN,
  MCP_SERVER_TOKEN,
} from './lumen.tokens.js';

export { DEFAULT_DOCS_DIR, MCP_PROTOCOL_VERSION, MCP_RESOURCE_URI_PREFIX } from './constants.js';

export { LumenRpcService, LumenRpcController } from './rpc/index.js';
export {
  AccessFilterService,
  defaultDocRoleHierarchy,
  defaultRoleGrants,
  extractDocumentAccess,
  extractDocumentMetadata,
} from './access/index.js';
export {
  LiveEditService,
  DEFAULT_MAX_LIVE_DOCUMENTS,
  DEFAULT_MAX_PATCH_BYTES,
  DEFAULT_MAX_DOCUMENT_BYTES,
  type DocumentState,
} from './live/index.js';
export {
  LumenMcpServer,
  handleHttpMcpRequest,
  handleSseMcpConnection,
  getActiveSseConnections,
  DEFAULT_MAX_HTTP_BODY_BYTES,
  DEFAULT_HTTP_READ_TIMEOUT_MS,
  DEFAULT_MAX_SSE_CONNECTIONS,
  DEFAULT_SSE_HEARTBEAT_MS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './mcp/index.js';

export type {
  LumenSessionContext,
  SearchOptions,
  SearchResult,
  PlaygroundResult,
  SymbolContract,
  TheoremGraphNode,
  TheoremGraphEdge,
  TheoremGraphData,
  LiveEditMode,
  LiveEditPayload,
  LiveEditResult,
  LiveEditEvent,
  LiveEditServiceOptions,
  AccessFilterOptions,
  TransportAuthResult,
  HttpMcpTransportOptions,
  SseMcpTransportOptions,
  ILumenModuleOptions,
  ILumenModuleAsyncOptions,
  LumenModuleOptions,
  LumenModuleAsyncOptions,
  ILumenRpcService,
  ILumenService,
} from './interfaces.js';
