/**
 * Tests for TemplateService
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Container } from '@omnitron-dev/nexus';
import { TemplateService } from '../src/services/template.service.js';
import { CacheService } from '../src/services/cache.service.js';
import { LoggerService } from '../src/services/logger.service.js';
import {
  TEMPLATE_MODULE_OPTIONS,
  TEMPLATE_CACHE_SERVICE,
  TEMPLATE_LOGGER,
  TEMPLATE_EVENTS
} from '../src/constants.js';
import type { TemplateModuleOptions, TemplateData } from '../src/types.js';

describe('TemplateService', () => {
  let container: Container;
  let service: TemplateService;
  let cacheService: CacheService;
  let loggerService: LoggerService;
  let options: TemplateModuleOptions;

  beforeEach(() => {
    // Create container
    container = new Container();

    // Create options
    options = {
      debug: false,
      prefix: 'test',
      enableCache: true,
      cacheTTL: 60
    };

    // Register dependencies
    container.register(TEMPLATE_MODULE_OPTIONS, { useValue: options });
    container.register(TEMPLATE_LOGGER, { useClass: LoggerService });
    container.register(TEMPLATE_CACHE_SERVICE, { useClass: CacheService });
    container.register(TemplateService, { useClass: TemplateService });

    // Resolve services
    service = container.resolve(TemplateService);
    cacheService = container.resolve(TEMPLATE_CACHE_SERVICE);
    loggerService = container.resolve(TEMPLATE_LOGGER);
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await service.initialize();
      expect(service.getStatus()).toBe('idle');
    });

    it('should emit initialization event', async () => {
      const listener = jest.fn();
      service.on(TEMPLATE_EVENTS.INITIALIZED, listener);

      await service.initialize();

      expect(listener).toHaveBeenCalled();
    });

    it('should handle multiple initialization calls', async () => {
      await service.initialize();
      await service.initialize(); // Should not throw
      expect(service.getStatus()).toBe('idle');
    });
  });

  describe('start/stop', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should start the service', async () => {
      await service.start();
      expect(service.getStatus()).toBe('running');
    });

    it('should stop the service', async () => {
      await service.start();
      await service.stop();
      expect(service.getStatus()).toBe('stopped');
    });

    it('should handle start when not initialized', async () => {
      const uninitializedService = new TemplateService(options, cacheService, loggerService);
      await expect(uninitializedService.start()).rejects.toThrow();
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      await service.initialize();
      await service.start();
    });

    describe('create', () => {
      it('should create a new data entry', async () => {
        const data = { name: 'Test Item' };
        const result = await service.create(data);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.name).toBe('Test Item');
        expect(result.data?.id).toBeDefined();
      });

      it('should emit create event', async () => {
        const listener = jest.fn();
        service.on(TEMPLATE_EVENTS.DATA_CREATED, listener);

        await service.create({ name: 'Test Item' });

        expect(listener).toHaveBeenCalled();
      });

      it('should cache created item when cache is enabled', async () => {
        const data = { name: 'Cached Item' };
        const result = await service.create(data);

        const cached = await cacheService.get(result.data!.id);
        expect(cached).toBeDefined();
      });
    });

    describe('get', () => {
      let createdItem: TemplateData;

      beforeEach(async () => {
        const result = await service.create({ name: 'Test Item' });
        createdItem = result.data!;
      });

      it('should get an existing item', async () => {
        const result = await service.get(createdItem.id);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.id).toBe(createdItem.id);
      });

      it('should return null for non-existent item', async () => {
        const result = await service.get('non-existent');

        expect(result.success).toBe(true);
        expect(result.data).toBeNull();
      });

      it('should emit cache hit event when item is cached', async () => {
        const listener = jest.fn();
        service.on(TEMPLATE_EVENTS.CACHE_HIT, listener);

        // First get to populate cache
        await service.get(createdItem.id);
        // Second get should hit cache
        await service.get(createdItem.id);

        expect(listener).toHaveBeenCalled();
      });
    });

    describe('update', () => {
      let createdItem: TemplateData;

      beforeEach(async () => {
        const result = await service.create({ name: 'Original Name' });
        createdItem = result.data!;
      });

      it('should update an existing item', async () => {
        const result = await service.update(createdItem.id, { name: 'Updated Name' });

        expect(result.success).toBe(true);
        expect(result.data?.name).toBe('Updated Name');
        expect(result.data?.updatedAt.getTime()).toBeGreaterThan(createdItem.updatedAt.getTime());
      });

      it('should emit update event', async () => {
        const listener = jest.fn();
        service.on(TEMPLATE_EVENTS.DATA_UPDATED, listener);

        await service.update(createdItem.id, { name: 'Updated Name' });

        expect(listener).toHaveBeenCalled();
      });

      it('should return null for non-existent item', async () => {
        const result = await service.update('non-existent', { name: 'New Name' });

        expect(result.success).toBe(true);
        expect(result.data).toBeNull();
      });
    });

    describe('delete', () => {
      let createdItem: TemplateData;

      beforeEach(async () => {
        const result = await service.create({ name: 'To Delete' });
        createdItem = result.data!;
      });

      it('should delete an existing item', async () => {
        const result = await service.delete(createdItem.id);

        expect(result.success).toBe(true);
        expect(result.data).toBe(true);

        // Verify it's deleted
        const getResult = await service.get(createdItem.id);
        expect(getResult.data).toBeNull();
      });

      it('should emit delete event', async () => {
        const listener = jest.fn();
        service.on(TEMPLATE_EVENTS.DATA_DELETED, listener);

        await service.delete(createdItem.id);

        expect(listener).toHaveBeenCalled();
      });

      it('should return false for non-existent item', async () => {
        const result = await service.delete('non-existent');

        expect(result.success).toBe(true);
        expect(result.data).toBe(false);
      });
    });

    describe('list', () => {
      beforeEach(async () => {
        await service.create({ name: 'Item 1' });
        await service.create({ name: 'Item 2' });
        await service.create({ name: 'Item 3' });
      });

      it('should list all items', async () => {
        const result = await service.list();

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(3);
      });
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      await service.initialize();
      await service.start();
    });

    it('should return healthy status when service is running', async () => {
      const result = await service.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.checks.service.status).toBe('up');
    });

    it('should include cache status in health check', async () => {
      const result = await service.healthCheck();

      expect(result.checks.cache).toBeDefined();
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await service.initialize();
      await service.start();
    });

    it('should return service statistics', async () => {
      await service.create({ name: 'Item 1' });
      await service.create({ name: 'Item 2' });

      const stats = service.getStats();

      expect(stats.status).toBe('running');
      expect(stats.dataCount).toBe(2);
      expect(stats.cacheEnabled).toBe(true);
      expect(stats.uptime).toBeGreaterThan(0);
    });
  });

  describe('executeWithRetry', () => {
    it('should retry failed operations', async () => {
      let attempts = 0;
      const operation = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
        return 'success';
      });

      await service.initialize();
      const result = await service.executeWithRetry(operation, {
        maxAttempts: 3,
        baseDelay: 10
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const operation = jest.fn(async () => {
        throw new Error('Always fails');
      });

      await service.initialize();

      await expect(
        service.executeWithRetry(operation, {
          maxAttempts: 2,
          baseDelay: 10
        })
      ).rejects.toThrow('Always fails');

      expect(operation).toHaveBeenCalledTimes(2);
    });
  });
});