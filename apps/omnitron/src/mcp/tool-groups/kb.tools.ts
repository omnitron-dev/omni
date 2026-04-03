import type { IMcpToolDef } from '../types.js';

/**
 * Knowledge Base MCP tools.
 * Exposes the full KB query API to AI agents.
 */
export function createKbTools(kbService: any): IMcpToolDef[] {
  return [
    {
      name: 'kb.query',
      description: 'Semantic + full-text hybrid search across code knowledge, documentation, patterns, and gotchas. Use this for open-ended questions about how things work.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Natural language question' },
          maxResults: { type: 'number', description: 'Max entries to return (default: 10)', default: 10 },
          scope: {
            type: 'string',
            description: 'Filter by package scope (e.g. "titan", "omnitron", "titan-auth")',
          },
        },
        required: ['question'],
      },
      handler: async (params: any) => {
        return kbService.query(params.question, {
          maxResults: params.maxResults,
          scope: params.scope,
        });
      },
    },
    {
      name: 'kb.get_api',
      description: 'Get the API surface of a class, interface, or type — signatures, decorators, members, inheritance. Use when you need to understand a specific symbol.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name (e.g. "AuthenticationManager", "IAuthService")' },
        },
        required: ['symbol'],
      },
      handler: async (params: any) => kbService.getApi(params.symbol),
    },
    {
      name: 'kb.get_module',
      description: 'Get complete information about a module: overview, specs, dependencies, dependents, and gotchas. Use to understand a package or subsystem.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Module path (e.g. "titan-auth", "titan/netron", "omnitron")' },
        },
        required: ['path'],
      },
      handler: async (params: any) => kbService.getModule(params.path),
    },
    {
      name: 'kb.repo_map',
      description: 'Get a compressed architecture map of the entire codebase (2-5K tokens). Shows package hierarchy, key symbols, and dependency graph. Start here for orientation.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter scope (e.g. "titan", "omnitron")' },
          detail: {
            type: 'string',
            enum: ['overview', 'signatures', 'full'],
            description: 'Level of detail (default: signatures)',
            default: 'signatures',
          },
        },
      },
      handler: async (params: any) => kbService.getRepoMap(params),
    },
    {
      name: 'kb.get_pattern',
      description: 'Get a development pattern with code examples. Use to learn the canonical way to implement something.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Pattern name (e.g. "service-rpc-module", "repo-map")' },
        },
        required: ['name'],
      },
      handler: async (params: any) => kbService.getPattern(params.name),
    },
    {
      name: 'kb.list_patterns',
      description: 'List all available development patterns.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => kbService.listPatterns(),
    },
    {
      name: 'kb.get_gotchas',
      description: 'Get known pitfalls and critical warnings. Essential before modifying code in unfamiliar areas.',
      inputSchema: {
        type: 'object',
        properties: {
          module: { type: 'string', description: 'Filter by module (omit for all gotchas)' },
        },
      },
      handler: async (params: any) => kbService.getGotchas(params.module),
    },
    {
      name: 'kb.search_symbols',
      description: 'Search for symbols (classes, interfaces, types, functions, enums) by name or kind.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (symbol name or partial match)' },
          kind: {
            type: 'string',
            enum: ['class', 'interface', 'type', 'function', 'enum', 'const', 'decorator'],
            description: 'Filter by symbol kind',
          },
        },
        required: ['query'],
      },
      handler: async (params: any) => kbService.searchSymbols(params.query, params.kind),
    },
    {
      name: 'kb.dependencies',
      description: 'Get the dependency graph for a module — what it depends on and what depends on it.',
      inputSchema: {
        type: 'object',
        properties: {
          module: { type: 'string', description: 'Module path' },
        },
        required: ['module'],
      },
      handler: async (params: any) => kbService.getDependencies(params.module),
    },
    {
      name: 'kb.index',
      description: 'Trigger knowledge base reindexing. Use after code changes to refresh the KB.',
      inputSchema: {
        type: 'object',
        properties: {
          full: { type: 'boolean', description: 'Full reindex (default: incremental)', default: false },
        },
      },
      handler: async (params: any) => kbService.reindex({ full: params.full }),
    },
    {
      name: 'kb.status',
      description: 'Get KB index health: total symbols, specs, patterns, embedding coverage, staleness.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => kbService.status(),
    },
  ];
}
