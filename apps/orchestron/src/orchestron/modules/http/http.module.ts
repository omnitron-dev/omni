/**
 * HTTP Module for Orchestron
 * Provides the web dashboard and REST API
 */

import { Module } from '@omnitron-dev/titan/nexus';
import { createToken, Token } from '@omnitron-dev/titan';
import { HttpService } from './http.service.js';
import { ApiRouter } from './api.router.js';
import { WebSocketService } from './websocket.service.js';
import { CONFIG_SERVICE_TOKEN } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import { EVENTS_SERVICE_TOKEN } from '@omnitron-dev/titan/module/events';

// Import service tokens from other modules
import { UNIFIED_ORCHESTRON_TOKEN } from '../core/core.module.js';
import { CLAUDE_SERVICE_TOKEN } from '../claude/claude.module.js';
import { PROJECT_SERVICE_TOKEN } from '../project/project.module.js';
import { SESSION_SERVICE_TOKEN } from '../session/session.module.js';

// Export HTTP service tokens
export const HTTP_SERVICE_TOKEN: Token<any> = createToken<HttpService>('HttpService');
export const API_ROUTER_TOKEN: Token<any> = createToken<ApiRouter>('ApiRouter');
export const WEBSOCKET_SERVICE_TOKEN: Token<any> = createToken<WebSocketService>('WebSocketService');

@Module({
  providers: [
    // API Router
    {
      provide: API_ROUTER_TOKEN,
      useFactory: (
        unifiedOrchestron: any,
        claudeService: any,
        projectService: any,
        sessionService: any,
        logger: any
      ) => {
        return new ApiRouter(
          unifiedOrchestron,
          claudeService,
          projectService,
          sessionService,
          logger
        );
      },
      inject: [
        { token: UNIFIED_ORCHESTRON_TOKEN, optional: true },
        { token: CLAUDE_SERVICE_TOKEN, optional: true },
        { token: PROJECT_SERVICE_TOKEN, optional: true },
        { token: SESSION_SERVICE_TOKEN, optional: true },
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    },

    // WebSocket Service
    {
      provide: WEBSOCKET_SERVICE_TOKEN,
      useFactory: (eventsService: any, logger: any) => {
        return new WebSocketService(eventsService, logger);
      },
      inject: [
        { token: EVENTS_SERVICE_TOKEN, optional: true },
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    },

    // Main HTTP Service
    {
      provide: HTTP_SERVICE_TOKEN,
      useFactory: (
        configService: any,
        apiRouter: ApiRouter,
        websocketService: WebSocketService,
        logger: any
      ) => {
        return new HttpService(configService, apiRouter, websocketService, logger);
      },
      inject: [
        { token: CONFIG_SERVICE_TOKEN, optional: true },
        API_ROUTER_TOKEN,
        WEBSOCKET_SERVICE_TOKEN,
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    }
  ],
  exports: [
    HTTP_SERVICE_TOKEN,
    API_ROUTER_TOKEN,
    WEBSOCKET_SERVICE_TOKEN
  ]
})
export class HttpModule {
  readonly name = 'HttpModule';
  readonly version = '1.0.0';
  readonly dependencies = ['CoreModule', 'ClaudeModule'];

  constructor(
    private httpService?: HttpService,
    private websocketService?: WebSocketService
  ) {}

  async onStart() {
    // Start HTTP server
    if (this.httpService) {
      await this.httpService.start();
    }

    // Start WebSocket server
    if (this.websocketService) {
      await this.websocketService.start();
    }
  }

  async onStop() {
    // Stop WebSocket server
    if (this.websocketService) {
      await this.websocketService.stop();
    }

    // Stop HTTP server
    if (this.httpService) {
      await this.httpService.stop();
    }
  }
}