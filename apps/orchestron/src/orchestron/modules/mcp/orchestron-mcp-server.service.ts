/**
 * OrchestronMCPServer - Main MCP server implementation
 * Provides tools and resources for AI agents to interact with Orchestron
 */

import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
// Logger will be injected instead of constructed directly
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { UnifiedOrchestron } from '../core/core.module.js';
import { MCPToolsService } from './mcp-tools.service.js';
import { MCPResourcesService } from './mcp-resources.service.js';

@Injectable()
export class OrchestronMCPServer {
  private server?: Server;
  private transport?: StdioServerTransport;

  constructor(
    @Inject(UnifiedOrchestron) private readonly orchestron: UnifiedOrchestron,
    @Inject(MCPToolsService) private readonly toolsService: MCPToolsService,
    @Inject(MCPResourcesService) private readonly resourcesService: MCPResourcesService
  ) { }

  async onStart(): Promise<void> {
    console.log('Starting MCP Server...');

    try {
      // Initialize MCP server
      this.server = new Server(
        {
          name: 'orchestron-mcp',
          version: '1.0.0',
          description: 'Orchestron Development Orchestration MCP Server'
        },
        {
          capabilities: {
            tools: {},
            resources: {}
          }
        }
      );

      // Setup request handlers
      await this.setupHandlers();

      // Create and connect transport
      this.transport = new StdioServerTransport();
      await this.server.connect(this.transport);

      console.log('MCP Server started successfully');
    } catch (error) {
      console.error('Failed to start MCP Server', error);
      throw error;
    }
  }

  async onStop(): Promise<void> {
    console.log('Stopping MCP Server...');

    if (this.transport) {
      await this.transport.close();
    }

    console.log('MCP Server stopped');
  }

  private async setupHandlers(): Promise<void> {
    if (!this.server) {
      throw new Error('Server not initialized');
    }

    // Tool handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: await this.toolsService.getTools()
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.toolsService.executeTool(name, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        console.error(`Tool execution failed: ${name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });

    // Resource handlers
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: await this.resourcesService.getResources()
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
      const { uri } = request.params;

      try {
        const content = await this.resourcesService.readResource(uri);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(content, null, 2)
            }
          ]
        };
      } catch (error: any) {
        console.error(`Resource read failed: ${uri}`, error);
        throw error;
      }
    });
  }

  /**
   * Start standalone MCP server (for testing or direct use)
   */
  async startStandalone(): Promise<void> {
    await this.onStart();

    // Keep server running
    process.on('SIGINT', async () => {
      await this.onStop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.onStop();
      process.exit(0);
    });
  }
}