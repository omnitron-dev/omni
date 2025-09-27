/**
 * Claude Module for Orchestron
 * Manages Claude Code sessions, projects, and interactions
 */

import { Module } from '@omnitron-dev/titan/nexus';
import { createToken, Token } from '@omnitron-dev/titan';
import { ClaudeService } from './claude.service.js';
import { ClaudeBinaryService } from './claude-binary.service.js';
import { ClaudeProcessManager } from './claude-process.manager.js';
import { STORAGE_SERVICE_TOKEN } from '../storage/storage.module.js';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import { EVENTS_SERVICE_TOKEN } from '@omnitron-dev/titan/module/events';

// Export tokens for Claude services
export const CLAUDE_SERVICE_TOKEN: Token<any> = createToken<ClaudeService>('ClaudeService');
export const CLAUDE_BINARY_SERVICE_TOKEN: Token<any> = createToken<ClaudeBinaryService>('ClaudeBinaryService');
export const CLAUDE_PROCESS_MANAGER_TOKEN: Token<any> = createToken<ClaudeProcessManager>('ClaudeProcessManager');

@Module({
  providers: [
    // Claude Binary Service (finds and manages Claude executable)
    {
      provide: CLAUDE_BINARY_SERVICE_TOKEN,
      useFactory: (logger: any) => {
        return new ClaudeBinaryService(logger);
      },
      inject: [{ token: LOGGER_SERVICE_TOKEN, optional: true }]
    },

    // Claude Process Manager (manages running Claude processes)
    {
      provide: CLAUDE_PROCESS_MANAGER_TOKEN,
      useFactory: (binaryService: ClaudeBinaryService, eventsService: any, logger: any) => {
        return new ClaudeProcessManager(binaryService, eventsService, logger);
      },
      inject: [
        CLAUDE_BINARY_SERVICE_TOKEN,
        { token: EVENTS_SERVICE_TOKEN, optional: true },
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    },

    // Main Claude Service
    {
      provide: CLAUDE_SERVICE_TOKEN,
      useFactory: (
        storage: any,
        binaryService: ClaudeBinaryService,
        processManager: ClaudeProcessManager,
        eventsService: any,
        logger: any
      ) => {
        return new ClaudeService(storage, binaryService, processManager, eventsService, logger);
      },
      inject: [
        STORAGE_SERVICE_TOKEN,
        CLAUDE_BINARY_SERVICE_TOKEN,
        CLAUDE_PROCESS_MANAGER_TOKEN,
        { token: EVENTS_SERVICE_TOKEN, optional: true },
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    }
  ],
  exports: [
    CLAUDE_SERVICE_TOKEN,
    CLAUDE_BINARY_SERVICE_TOKEN,
    CLAUDE_PROCESS_MANAGER_TOKEN
  ]
})
export class ClaudeModule {
  readonly name = 'ClaudeModule';
  readonly version = '1.0.0';
  readonly dependencies = ['StorageModule'];

  constructor(
    private claudeService?: ClaudeService,
    private processManager?: ClaudeProcessManager
  ) {}

  async onStart() {
    // Initialize Claude service
    if (this.claudeService) {
      await this.claudeService.initialize();
    }
  }

  async onStop() {
    // Stop all running Claude processes
    if (this.processManager) {
      await this.processManager.stopAll();
    }
  }
}