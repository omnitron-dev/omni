#!/usr/bin/env node

/**
 * Orchestron - Development Orchestration System
 * Main application entry point using Titan framework
 */

import { createApp, startApp } from '@omnitron-dev/titan';
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { EventsModule } from '@omnitron-dev/titan/module/events';
import { SchedulerModule } from '@omnitron-dev/titan/module/scheduler';
import { TitanRedisModule } from '@omnitron-dev/titan/module/redis';

// Import Orchestron modules
import { CoreModule } from './modules/core/core.module.js';
import { ClaudeModule } from './modules/claude/claude.module.js';
import { NetronHttpModule } from './modules/netron-http/netron-http.module.js';
import { MCPModule } from './modules/mcp/mcp.module.js';
import { SessionModule } from './modules/session/session.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { ProjectModule } from './modules/project/project.module.js';
import { CheckpointModule } from './modules/checkpoint/checkpoint.module.js';
import { AgentsModule } from './modules/agents/agents.module.js';

async function bootstrap() {
  const app = createApp({
    name: 'Orchestron',
    version: '3.0.0',
    config: {
      environment: process.env.NODE_ENV || 'development',
      debug: process.env.DEBUG === 'true',
    }
  });

  // Register core Titan modules
  app.use(ConfigModule.forRoot({
    sources: [
      { type: 'object', data: {
        port: 3001,
        host: '0.0.0.0',
        storagePath: '.orchestron',
        dashboardEnabled: true,
        mcpEnabled: true,
        redisEnabled: false,
      }},
      { type: 'env', prefix: 'ORCHESTRON_' },
    ]
  }) as any);

  app.use(LoggerModule.forRoot({
    level: (process.env.LOG_LEVEL || 'info') as any,
    prettyPrint: process.env.NODE_ENV !== 'production',
  }));

  app.use(EventsModule.forRoot({
    maxListeners: 100,
  }) as any);

  app.use(SchedulerModule.forRoot({}) as any);

  // Conditionally register Redis module
  if (process.env.ORCHESTRON_REDIS_ENABLED === 'true') {
    app.use(TitanRedisModule.forRoot({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    } as any) as any);
  }

  // Netron is integrated into Titan, no separate module needed
  // The NetronHttpModule will handle the HTTP transport

  // Register Orchestron modules
  app.use(StorageModule);
  app.use(CoreModule);
  app.use(ProjectModule);
  app.use(SessionModule);
  app.use(ClaudeModule);
  app.use(CheckpointModule);
  app.use(AgentsModule);
  app.use(MCPModule);
  app.use(NetronHttpModule); // Netron HTTP module should be last to use other services

  // Start the application
  await startApp(app);

  console.log(`
    ╔═══════════════════════════════════════════╗
    ║                                           ║
    ║   🚀 Orchestron v3.0 Started              ║
    ║   Development Orchestration System        ║
    ║                                           ║
    ║   Dashboard: http://localhost:3001        ║
    ║   API:       http://localhost:3001/api    ║
    ║   MCP:       ws://localhost:3002          ║
    ║                                           ║
    ╚═══════════════════════════════════════════╝
  `);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
bootstrap().catch((error) => {
  console.error('Failed to start Orchestron:', error);
  process.exit(1);
});