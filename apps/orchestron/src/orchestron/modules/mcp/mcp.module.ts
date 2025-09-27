/**
 * MCP Module for Orchestron
 * Implements Model Context Protocol for multi-agent coordination
 */

import { Module } from '@omnitron-dev/titan/nexus';
import { CoreModule } from '../core/core.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OrchestronMCPServer } from './orchestron-mcp-server.service.js';
import { MCPToolsService } from './mcp-tools.service.js';
import { MCPResourcesService } from './mcp-resources.service.js';

@Module({
  imports: [StorageModule, CoreModule],
  providers: [
    OrchestronMCPServer,
    MCPToolsService,
    MCPResourcesService,
  ],
  exports: [OrchestronMCPServer],
})
export class MCPModule {
  readonly name = 'MCPModule';
  readonly version = '1.0.0';
}