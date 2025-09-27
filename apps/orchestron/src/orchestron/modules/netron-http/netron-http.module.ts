/**
 * Netron HTTP Module for Orchestron
 * Provides HTTP server using Titan's Netron transport layer
 */

import { Module } from '@omnitron-dev/titan/nexus';
import { createToken } from '@omnitron-dev/titan';
import { NetronHttpService } from './netron-http.service.js';
import { OrchestronApiService } from './orchestron-api.service.js';
import { CONFIG_SERVICE_TOKEN } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import { EVENTS_SERVICE_TOKEN } from '@omnitron-dev/titan/module/events';
import { NetronToken } from '@omnitron-dev/titan';
import type { Token } from '@omnitron-dev/titan';

// Import service tokens from other modules
import { UNIFIED_ORCHESTRON_TOKEN } from '../core/core.module.js';
import { CLAUDE_SERVICE_TOKEN } from '../claude/claude.module.js';
import { PROJECT_SERVICE_TOKEN } from '../project/project.module.js';
import { SESSION_SERVICE_TOKEN } from '../session/session.module.js';

// Export HTTP service tokens
export const NETRON_HTTP_SERVICE_TOKEN: Token<NetronHttpService> = createToken<NetronHttpService>('NetronHttpService');
export const ORCHESTRON_API_SERVICE_TOKEN: Token<OrchestronApiService> = createToken<OrchestronApiService>('OrchestronApiService');

@Module({
  providers: [
    // Orchestron API Service
    {
      provide: ORCHESTRON_API_SERVICE_TOKEN,
      useFactory: (
        unifiedOrchestron: any,
        claudeService: any,
        projectService: any,
        sessionService: any,
        logger: any
      ) => new OrchestronApiService(
        unifiedOrchestron,
        claudeService,
        projectService,
        sessionService,
        logger
      ),
      inject: [
        { token: UNIFIED_ORCHESTRON_TOKEN, optional: true },
        { token: CLAUDE_SERVICE_TOKEN, optional: true },
        { token: PROJECT_SERVICE_TOKEN, optional: true },
        { token: SESSION_SERVICE_TOKEN, optional: true },
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    },

    // Netron HTTP Service
    {
      provide: NETRON_HTTP_SERVICE_TOKEN,
      useFactory: (
        configService: any,
        netronService: any,
        apiService: OrchestronApiService,
        eventsService: any,
        logger: any
      ) => new NetronHttpService(
        configService,
        netronService,
        apiService,
        eventsService,
        logger
      ),
      inject: [
        { token: CONFIG_SERVICE_TOKEN, optional: true },
        { token: NetronToken, optional: true },
        ORCHESTRON_API_SERVICE_TOKEN,
        { token: EVENTS_SERVICE_TOKEN, optional: true },
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    }
  ],
  exports: [
    NETRON_HTTP_SERVICE_TOKEN,
    ORCHESTRON_API_SERVICE_TOKEN
  ]
})
export class NetronHttpModule {
  readonly name = 'NetronHttpModule';
  readonly version = '1.0.0';
  readonly dependencies = ['CoreModule', 'ClaudeModule', 'NetronModule'];

  constructor(
    private httpService?: NetronHttpService
  ) { }

  async onStart() {
    // Start HTTP server via Netron
    if (this.httpService) {
      await this.httpService.start();
    }
  }

  async onStop() {
    // Stop HTTP server
    if (this.httpService) {
      await this.httpService.stop();
    }
  }
}