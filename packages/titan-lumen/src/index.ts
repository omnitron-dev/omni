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
export { AccessFilterService, defaultDocRoleHierarchy, defaultRoleGrants } from './access/index.js';
export { LiveEditService, type DocumentState } from './live/index.js';
export {
  LumenMcpServer,
  handleHttpMcpRequest,
  handleSseMcpConnection,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './mcp/index.js';

export type {
  SearchOptions,
  SearchResult,
  PlaygroundResult,
  SymbolContract,
  TheoremGraphNode,
  TheoremGraphEdge,
  TheoremGraphData,
  LiveEditPayload,
  LiveEditResult,
  AccessFilterOptions,
  ILumenModuleOptions,
  ILumenModuleAsyncOptions,
  LumenModuleOptions,
  LumenModuleAsyncOptions,
  ILumenRpcService,
} from './interfaces.js';
