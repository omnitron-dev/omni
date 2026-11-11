export const LUMEN_OPTIONS_TOKEN = Symbol.for('titan:lumen:options');
export const LUMEN_SERVICE_TOKEN = Symbol.for('titan:lumen:service');

// Aliases for token parity across the Titan ecosystem:
export const LUMEN_CONFIG_TOKEN = LUMEN_OPTIONS_TOKEN;
export const LUMEN_RPC_SERVICE_TOKEN = LUMEN_SERVICE_TOKEN;
export const LUMEN_RPC_CONTROLLER_TOKEN = Symbol.for('titan:lumen:rpc:controller');
export const ACCESS_FILTER_SERVICE_TOKEN = Symbol.for('titan:lumen:access:filter');
export const LIVE_EDIT_SERVICE_TOKEN = Symbol.for('titan:lumen:live:edit');
export const MCP_SERVER_TOKEN = Symbol.for('titan:lumen:mcp:server');

export const DEFAULT_DOCS_DIR = 'docs';
export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_RESOURCE_URI_PREFIX = 'lumen://corpus/';
