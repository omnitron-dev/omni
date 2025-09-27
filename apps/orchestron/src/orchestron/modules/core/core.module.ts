/**
 * Core Module for Orchestron
 * Provides the main orchestration engine, task management, and analytics
 */

import { Module, Global } from '@omnitron-dev/titan/nexus';
import { createToken, Token } from '@omnitron-dev/titan';
import { OrchestronEngine } from '../../../core/engine.js';
import { TaskManager } from '../../../core/task-manager.js';
import { SprintManager } from '../../../core/sprint-manager.js';
import { Analytics } from '../../../core/analytics.js';
import { MLPredictor } from '../../../core/ml-predictor.js';
import { UnifiedOrchestron } from '../../../core/unified-orchestron.js';
import { STORAGE_SERVICE_TOKEN } from '../storage/storage.module.js';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import { CONFIG_SERVICE_TOKEN } from '@omnitron-dev/titan/module/config';

// Export tokens for core services
export const ORCHESTRON_ENGINE_TOKEN: Token<any> = createToken<OrchestronEngine>('OrchestronEngine');
export const TASK_MANAGER_TOKEN: Token<any> = createToken<TaskManager>('TaskManager');
export const SPRINT_MANAGER_TOKEN: Token<any> = createToken<SprintManager>('SprintManager');
export const ANALYTICS_TOKEN: Token<any> = createToken<Analytics>('Analytics');
export const ML_PREDICTOR_TOKEN: Token<any> = createToken<MLPredictor>('MLPredictor');
export const UNIFIED_ORCHESTRON_TOKEN: Token<any> = createToken<UnifiedOrchestron>('UnifiedOrchestron');

// Export classes for type imports
export { UnifiedOrchestron } from '../../../core/unified-orchestron.js';

@Global()
@Module({
  providers: [
    // Orchestron Engine
    {
      provide: ORCHESTRON_ENGINE_TOKEN,
      useFactory: (storage: any, logger: any) => {
        const engine = new OrchestronEngine(storage);
        logger?.info('OrchestronEngine created');
        return engine;
      },
      inject: [STORAGE_SERVICE_TOKEN, { token: LOGGER_SERVICE_TOKEN, optional: true }]
    },

    // Task Manager
    {
      provide: TASK_MANAGER_TOKEN,
      useFactory: (engine: OrchestronEngine, logger: any) => {
        const taskManager = new TaskManager(engine);
        logger?.info('TaskManager created');
        return taskManager;
      },
      inject: [ORCHESTRON_ENGINE_TOKEN, { token: LOGGER_SERVICE_TOKEN, optional: true }]
    },

    // Sprint Manager
    {
      provide: SPRINT_MANAGER_TOKEN,
      useFactory: (engine: OrchestronEngine, taskManager: TaskManager, logger: any) => {
        const sprintManager = new SprintManager(engine, taskManager);
        logger?.info('SprintManager created');
        return sprintManager;
      },
      inject: [ORCHESTRON_ENGINE_TOKEN, TASK_MANAGER_TOKEN, { token: LOGGER_SERVICE_TOKEN, optional: true }]
    },

    // Analytics
    {
      provide: ANALYTICS_TOKEN,
      useFactory: (engine: OrchestronEngine, taskManager: TaskManager, sprintManager: SprintManager, logger: any) => {
        const analytics = new Analytics(engine, taskManager, sprintManager);
        logger?.info('Analytics created');
        return analytics;
      },
      inject: [
        ORCHESTRON_ENGINE_TOKEN,
        TASK_MANAGER_TOKEN,
        SPRINT_MANAGER_TOKEN,
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    },

    // ML Predictor
    {
      provide: ML_PREDICTOR_TOKEN,
      useFactory: (engine: OrchestronEngine, logger: any) => {
        const mlPredictor = new MLPredictor(engine);
        logger?.info('MLPredictor created');
        return mlPredictor;
      },
      inject: [ORCHESTRON_ENGINE_TOKEN, { token: LOGGER_SERVICE_TOKEN, optional: true }]
    },

    // Unified Orchestron
    {
      provide: UNIFIED_ORCHESTRON_TOKEN,
      useFactory: (storage: any, logger: any) => {
        const unified = new UnifiedOrchestron(storage);
        logger?.info('UnifiedOrchestron created');
        return unified;
      },
      inject: [STORAGE_SERVICE_TOKEN, { token: LOGGER_SERVICE_TOKEN, optional: true }]
    }
  ],
  exports: [
    ORCHESTRON_ENGINE_TOKEN,
    TASK_MANAGER_TOKEN,
    SPRINT_MANAGER_TOKEN,
    ANALYTICS_TOKEN,
    ML_PREDICTOR_TOKEN,
    UNIFIED_ORCHESTRON_TOKEN
  ]
})
export class CoreModule {
  readonly name = 'CoreModule';
  readonly version = '1.0.0';
  readonly dependencies = ['StorageModule'];

  constructor(
    private engine?: OrchestronEngine,
    private unified?: UnifiedOrchestron,
    private logger?: any
  ) {}

  async onStart() {
    this.logger?.info('CoreModule starting');

    // Initialize engine
    if (this.engine) {
      await this.engine.ensureInitialized();
    }

    // Initialize unified orchestron
    if (this.unified) {
      await this.unified.initialize();
    }

    this.logger?.info('CoreModule started');
  }

  async onStop() {
    this.logger?.info('CoreModule stopping');

    // Cleanup unified orchestron
    if (this.unified) {
      await this.unified.close();
    }

    this.logger?.info('CoreModule stopped');
  }
}