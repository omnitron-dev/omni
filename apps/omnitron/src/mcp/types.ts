/**
 * MCP Tool definition for the Omnitron MCP server.
 */
export interface IMcpToolDef<TParams = Record<string, unknown>> {
  /** Tool name (dot notation: 'kb.query', 'apps.list') */
  name: string;
  /** Tool description for AI agents */
  description: string;
  /** JSON Schema for parameters */
  inputSchema: Record<string, unknown>;
  /** Handler function */
  handler: (params: TParams) => Promise<unknown>;
}

/**
 * A group of related MCP tools.
 */
export interface IMcpToolGroup {
  /** Group prefix (e.g. 'kb', 'apps', 'infra') */
  prefix: string;
  /** Tool definitions */
  tools: IMcpToolDef[];
}
