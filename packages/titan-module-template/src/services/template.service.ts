/**
 * Main Template Service
 *
 * This is the core service of the template module.
 * It demonstrates service patterns, dependency injection, and lifecycle management.
 */

import { Inject, Injectable } from '@omnitron-dev/nexus';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import {
  ServiceStatus
} from '../types.js';
import type {
  TemplateModuleOptions,
  TemplateData,
  TemplateEvent,
  OperationResult,
  HealthCheckResult
} from '../types.js';
import {
  TEMPLATE_MODULE_OPTIONS,
  TEMPLATE_CACHE_SERVICE,
  TEMPLATE_LOGGER,
  TEMPLATE_EVENTS,
  ERROR_MESSAGES
} from '../constants.js';
import { CacheService } from './cache.service.js';
import { LoggerService } from './logger.service.js';
import { generateId, success, failure, retry } from '../utils.js';

@Injectable()
export class TemplateService extends EventEmitter {
  private status: ServiceStatus = ServiceStatus.IDLE;
  private dataStore: Map<string, TemplateData> = new Map();
  private initialized = false;

  constructor(
    @Inject(TEMPLATE_MODULE_OPTIONS) private readonly options: TemplateModuleOptions,
    @Inject(TEMPLATE_CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(TEMPLATE_LOGGER) private readonly logger: LoggerService
  ) {
    super();
    this.logger.debug('TemplateService constructor');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing TemplateService');

    try {
      // Perform initialization tasks
      await this.cache.initialize();

      // Emit initialization event
      await this.emit(TEMPLATE_EVENTS.INITIALIZED, {
        timestamp: new Date(),
        options: this.options
      });

      this.initialized = true;
      this.status = ServiceStatus.IDLE;

      this.logger.info('TemplateService initialized successfully');
    } catch (error) {
      this.status = ServiceStatus.ERROR;
      this.logger.error('Failed to initialize TemplateService', error as Error);
      throw error;
    }
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error(ERROR_MESSAGES.NOT_INITIALIZED);
    }

    if (this.status === ServiceStatus.RUNNING) {
      return;
    }

    this.logger.info('Starting TemplateService');
    this.status = ServiceStatus.RUNNING;
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    if (this.status !== ServiceStatus.RUNNING) {
      return;
    }

    this.logger.info('Stopping TemplateService');

    // Clean up resources
    this.dataStore.clear();
    await this.cache.clear();

    this.status = ServiceStatus.STOPPED;
  }

  /**
   * Create a new data entry
   */
  async create(data: Partial<TemplateData>): Promise<OperationResult<TemplateData>> {
    try {
      const id = data.id || generateId();
      const now = new Date();

      const newData: TemplateData = {
        id,
        name: data.name || 'Unnamed',
        description: data.description,
        metadata: data.metadata || {},
        createdAt: now,
        updatedAt: now
      };

      // Store in memory
      this.dataStore.set(id, newData);

      // Cache if enabled
      if (this.options.enableCache) {
        await this.cache.set(id, newData, this.options.cacheTTL);
      }

      // Emit event
      const event: TemplateEvent = {
        type: 'created',
        data: newData,
        timestamp: now
      };
      await this.emit(TEMPLATE_EVENTS.DATA_CREATED, event);

      this.logger.debug('Created data entry', { id });

      return success(newData);
    } catch (error) {
      this.logger.error('Failed to create data entry', error as Error);
      await this.emit(TEMPLATE_EVENTS.ERROR_OCCURRED, error);
      return failure(error as Error);
    }
  }

  /**
   * Get a data entry by ID
   */
  async get(id: string): Promise<OperationResult<TemplateData | null>> {
    try {
      // Check cache first
      if (this.options.enableCache) {
        const cached = await this.cache.get<TemplateData>(id);
        if (cached) {
          await this.emit(TEMPLATE_EVENTS.CACHE_HIT, { id });
          return success(cached);
        }
        await this.emit(TEMPLATE_EVENTS.CACHE_MISS, { id });
      }

      // Get from memory
      const data = this.dataStore.get(id);

      if (data && this.options.enableCache) {
        // Update cache
        await this.cache.set(id, data, this.options.cacheTTL);
      }

      return success(data || null);
    } catch (error) {
      this.logger.error('Failed to get data entry', error as Error);
      return failure(error as Error);
    }
  }

  /**
   * Update a data entry
   */
  async update(id: string, updates: Partial<TemplateData>): Promise<OperationResult<TemplateData | null>> {
    try {
      const existing = this.dataStore.get(id);
      if (!existing) {
        return success(null);
      }

      const updated: TemplateData = {
        ...existing,
        ...updates,
        id, // Ensure ID doesn't change
        createdAt: existing.createdAt, // Preserve creation time
        updatedAt: new Date()
      };

      // Update in memory
      this.dataStore.set(id, updated);

      // Update cache
      if (this.options.enableCache) {
        await this.cache.set(id, updated, this.options.cacheTTL);
      }

      // Emit event
      const event: TemplateEvent = {
        type: 'updated',
        data: updated,
        timestamp: new Date()
      };
      await this.emit(TEMPLATE_EVENTS.DATA_UPDATED, event);

      this.logger.debug('Updated data entry', { id });

      return success(updated);
    } catch (error) {
      this.logger.error('Failed to update data entry', error as Error);
      return failure(error as Error);
    }
  }

  /**
   * Delete a data entry
   */
  async delete(id: string): Promise<OperationResult<boolean>> {
    try {
      const data = this.dataStore.get(id);
      if (!data) {
        return success(false);
      }

      // Delete from memory
      this.dataStore.delete(id);

      // Delete from cache
      if (this.options.enableCache) {
        await this.cache.delete(id);
      }

      // Emit event
      const event: TemplateEvent = {
        type: 'deleted',
        data,
        timestamp: new Date()
      };
      await this.emit(TEMPLATE_EVENTS.DATA_DELETED, event);

      this.logger.debug('Deleted data entry', { id });

      return success(true);
    } catch (error) {
      this.logger.error('Failed to delete data entry', error as Error);
      return failure(error as Error);
    }
  }

  /**
   * List all data entries
   */
  async list(): Promise<OperationResult<TemplateData[]>> {
    try {
      const entries = Array.from(this.dataStore.values());
      return success(entries);
    } catch (error) {
      this.logger.error('Failed to list data entries', error as Error);
      return failure(error as Error);
    }
  }

  /**
   * Execute an operation with retry
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryOptions?: Parameters<typeof retry>[1]
  ): Promise<T> {
    return retry(operation, retryOptions);
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};

    // Check service status
    checks['service'] = {
      status: this.status === ServiceStatus.RUNNING ? 'up' : 'down',
      message: `Service status: ${this.status}`,
      details: {
        initialized: this.initialized,
        dataCount: this.dataStore.size
      }
    };

    // Check cache
    try {
      const cacheHealth = await this.cache.healthCheck();
      checks['cache'] = {
        status: cacheHealth ? 'up' : 'down',
        message: 'Cache service health'
      };
    } catch (error) {
      checks['cache'] = {
        status: 'down',
        message: (error as Error).message
      };
    }

    const allHealthy = Object.values(checks).every(check => check.status === 'up');

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date()
    };
  }

  /**
   * Get service status
   */
  getStatus(): ServiceStatus {
    return this.status;
  }

  /**
   * Get service statistics
   */
  getStats(): Record<string, any> {
    return {
      status: this.status,
      dataCount: this.dataStore.size,
      cacheEnabled: this.options.enableCache,
      uptime: process.uptime()
    };
  }
}