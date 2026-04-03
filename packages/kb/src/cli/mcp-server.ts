#!/usr/bin/env node

/**
 * Standalone MCP server for the Omnitron Knowledge Base.
 * Runs without the Omnitron daemon — KB tools only.
 *
 * Usage:
 *   node dist/cli/mcp-server.js [--root /path/to/monorepo]
 */

import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { KnowledgeBase } from '../core/knowledge-base.js';
import { SurrealKbStore } from '../surreal/client.js';
import type { IQueryOptions } from '../core/types.js';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]!) : process.cwd();

const dbPath = resolve(process.env['HOME'] ?? '.', '.omnitron', 'kb.db');

let kb: KnowledgeBase = null!;
let ready = false;

async function initializeAndIndex(): Promise<void> {
  const store = new SurrealKbStore({ url: `mem://` });
  // usePrebuilt: true — load from kb/generated/ JSON, skip ts-morph (avoids OOM)
  kb = new KnowledgeBase({ store, root, usePrebuilt: true });
  await kb.initialize();

  process.stderr.write('[kb-mcp] Indexing knowledge base (specs only)...\n');
  const result = await kb.reindex({ full: true });
  const stats = await kb.status();
  ready = true;
  process.stderr.write(
    `[kb-mcp] Ready: ${stats.modules} modules, ${stats.specs} specs, ${stats.symbols} symbols, ${stats.gotchas} gotchas\n`,
  );
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const tools = [
  {
    name: 'kb.query',
    description: 'Semantic search across code knowledge, documentation, patterns, and gotchas',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Natural language question' },
        maxResults: { type: 'number', description: 'Max entries (default: 10)' },
        scope: { type: 'string', description: 'Filter by module (e.g. "titan", "omnitron")' },
      },
      required: ['question'],
    },
  },
  {
    name: 'kb.get_api',
    description: 'Get API surface of a symbol — signatures, decorators, members, inheritance',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name (e.g. "AuthenticationManager")' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'kb.get_module',
    description: 'Get complete module info: specs, dependencies, gotchas',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Module path (e.g. "titan", "titan-auth")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'kb.repo_map',
    description: 'Compressed architecture map of the entire codebase',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'kb.get_pattern',
    description: 'Get a development pattern with code examples',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Pattern name (e.g. "service-rpc-module")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'kb.list_patterns',
    description: 'List all development patterns',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'kb.get_gotchas',
    description: 'Get known pitfalls and critical warnings',
    inputSchema: {
      type: 'object',
      properties: {
        module: { type: 'string', description: 'Filter by module' },
      },
    },
  },
  {
    name: 'kb.search_symbols',
    description: 'Search symbols by name or kind',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        kind: { type: 'string', enum: ['class', 'interface', 'type', 'function', 'enum', 'const'] },
      },
      required: ['query'],
    },
  },
  {
    name: 'kb.dependencies',
    description: 'Get dependency graph for a module',
    inputSchema: {
      type: 'object',
      properties: {
        module: { type: 'string', description: 'Module path' },
      },
      required: ['module'],
    },
  },
  {
    name: 'kb.status',
    description: 'Get KB index health and statistics',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'kb.query':
      return kb.query(args['question'] as string, {
        maxResults: (args['maxResults'] as number) ?? 10,
        scope: args['scope'] as string | undefined,
      });
    case 'kb.get_api':
      return kb.getApi(args['symbol'] as string);
    case 'kb.get_module':
      return kb.getModule(args['path'] as string);
    case 'kb.repo_map':
      return kb.getRepoMap();
    case 'kb.get_pattern':
      return kb.getPattern(args['name'] as string);
    case 'kb.list_patterns':
      return kb.listPatterns();
    case 'kb.get_gotchas':
      return kb.getGotchas(args['module'] as string | undefined);
    case 'kb.search_symbols':
      return kb.searchSymbols(args['query'] as string, args['kind'] as any);
    case 'kb.dependencies':
      return kb.getDependencies(args['module'] as string);
    case 'kb.status':
      return kb.status();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message: Record<string, unknown>): Promise<void> {
  const { id, method, params } = message as any;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'omnitron-kb', version: '0.1.0' },
        },
      });
      break;

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: { tools },
      });
      break;

    case 'tools/call': {
      const toolName = params?.name as string;
      try {
        const result = await handleToolCall(toolName, params?.arguments ?? {});
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            }],
          },
        });
      } catch (err: any) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        });
      }
      break;
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      break;

    default:
      if (id !== undefined) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
}

// Main — start listening immediately, index in background
const indexPromise = initializeAndIndex().catch((err) => {
  process.stderr.write(`[kb-mcp] Index error: ${err.message}\n`);
});

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const message = JSON.parse(line);
    // For tool calls, ensure indexing is complete first
    if ((message as any).method === 'tools/call' && !ready) {
      await indexPromise;
    }
    await handleMessage(message);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
}

if (kb) await kb.close();
