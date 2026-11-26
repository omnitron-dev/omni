import type { Readable, Writable } from 'node:stream';
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { CLI_VERSION } from '../config/defaults.js';
import type { IMcpToolDef } from './types.js';

export class McpBridge {
  private readonly tools = new Map<string, IMcpToolDef>();

  constructor(private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {}

  registerTools(tools: IMcpToolDef[]): void {
    for (const tool of tools) this.tools.set(tool.name, tool);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport(this.input, this.output);
    const handle = serveStdio(() => {
      const server = new McpServer({ name: 'omnitron', version: CLI_VERSION });
      for (const tool of this.tools.values()) {
        const inputSchema = fromJsonSchema<Record<string, unknown>>(tool.inputSchema);
        server.registerTool(tool.name, { description: tool.description, inputSchema }, async (args, { mcpReq }) => {
          mcpReq.signal.throwIfAborted();
          try {
            const value = await tool.handler(args, mcpReq.signal);
            mcpReq.signal.throwIfAborted();
            return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2) }] };
          } catch (error) {
            mcpReq.signal.throwIfAborted();
            return { isError: true, content: [{ type: 'text', text: 'Error: ' + (error instanceof Error ? error.message : String(error)) }] };
          }
        });
      }
      return server;
    }, { transport });

    // serveStdio owns the transport lifecycle. Keep CLI resources until that
    // lifecycle ends, including a closed output or a rejected input frame.
    try {
      await new Promise<void>(resolve => {
        const closeSession = transport.onclose;
        transport.onclose = () => {
          try { closeSession?.(); } finally { resolve(); }
        };
      });
    } finally {
      await handle.close();
    }
  }
}
