import type { IMcpToolDef } from './types.js';

/**
 * MCP stdio bridge — implements the Model Context Protocol over stdin/stdout.
 * Minimal implementation that handles tool listing and invocation.
 *
 * Protocol: JSON-RPC 2.0 over newline-delimited JSON on stdin/stdout.
 */
export class McpBridge {
  private tools = new Map<string, IMcpToolDef>();

  registerTools(tools: IMcpToolDef[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Start the MCP stdio server.
   * Reads JSON-RPC messages from stdin, dispatches to tool handlers,
   * writes responses to stdout.
   */
  async start(): Promise<void> {
    const { createInterface } = await import('node:readline');

    const rl = createInterface({ input: process.stdin });

    // Send server info on connect
    this.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        await this.handleMessage(message);
      } catch (err) {
        this.sendError(null, -32700, 'Parse error');
      }
    }
  }

  private async handleMessage(message: any): Promise<void> {
    const { id, method, params } = message;

    switch (method) {
      case 'initialize':
        this.send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'omnitron',
              version: '0.1.0',
            },
          },
        });
        break;

      case 'tools/list':
        this.send({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [...this.tools.values()].map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        });
        break;

      case 'tools/call': {
        const toolName = params?.name;
        const tool = this.tools.get(toolName);

        if (!tool) {
          this.sendError(id, -32601, `Unknown tool: ${toolName}`);
          return;
        }

        try {
          const result = await tool.handler(params?.arguments ?? {});
          this.send({
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
          this.send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: 'text',
                text: `Error: ${err.message ?? String(err)}`,
              }],
              isError: true,
            },
          });
        }
        break;
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        // No response needed for notifications
        break;

      default:
        if (id !== undefined) {
          this.sendError(id, -32601, `Method not found: ${method}`);
        }
    }
  }

  private send(message: any): void {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  private sendError(id: unknown, code: number, message: string): void {
    this.send({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }
}
