/**
 * Comprehensive Tests for Nexus Lifecycle Module
 *
 * Tests cover:
 * - LifecycleEvent enum values
 * - LifecycleManager registration, emission, and history
 * - PerformanceObserver metrics tracking
 * - MemoryObserver instance counting
 * - AuditObserver audit logging
 * - Edge cases and error handling
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  LifecycleEvent,
  LifecycleManager,
  PerformanceObserver,
  MemoryObserver,
  AuditObserver,
  type LifecycleHook,
  type LifecycleObserver,
} from '../../../src/nexus/lifecycle.js';
import { createToken } from '../../../src/nexus/token.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: false,
    setLevel: vi.fn(),
  } as unknown as ILogger;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// LifecycleEvent Tests
// ============================================================================

describe('LifecycleEvent', () => {
  describe('Container lifecycle events', () => {
    it('should have ContainerCreated event', () => {
      expect(LifecycleEvent.ContainerCreated).toBe('container:created');
    });

    it('should have ContainerInitialized event', () => {
      expect(LifecycleEvent.ContainerInitialized).toBe('container:initialized');
    });

    it('should have ContainerDisposing event', () => {
      expect(LifecycleEvent.ContainerDisposing).toBe('container:disposing');
    });

    it('should have ContainerDisposed event', () => {
      expect(LifecycleEvent.ContainerDisposed).toBe('container:disposed');
    });
  });

  describe('Registration lifecycle events', () => {
    it('should have BeforeRegister event', () => {
      expect(LifecycleEvent.BeforeRegister).toBe('register:before');
    });

    it('should have AfterRegister event', () => {
      expect(LifecycleEvent.AfterRegister).toBe('register:after');
    });
  });

  describe('Resolution lifecycle events', () => {
    it('should have BeforeResolve event', () => {
      expect(LifecycleEvent.BeforeResolve).toBe('resolve:before');
    });

    it('should have AfterResolve event', () => {
      expect(LifecycleEvent.AfterResolve).toBe('resolve:after');
    });

    it('should have ResolveFailed event', () => {
      expect(LifecycleEvent.ResolveFailed).toBe('resolve:failed');
    });
  });

  describe('Instance lifecycle events', () => {
    it('should have InstanceCreating event', () => {
      expect(LifecycleEvent.InstanceCreating).toBe('instance:creating');
    });

    it('should have InstanceCreated event', () => {
      expect(LifecycleEvent.InstanceCreated).toBe('instance:created');
    });

    it('should have InstanceInitializing event', () => {
      expect(LifecycleEvent.InstanceInitializing).toBe('instance:initializing');
    });

    it('should have InstanceInitialized event', () => {
      expect(LifecycleEvent.InstanceInitialized).toBe('instance:initialized');
    });

    it('should have InstanceDisposing event', () => {
      expect(LifecycleEvent.InstanceDisposing).toBe('instance:disposing');
    });

    it('should have InstanceDisposed event', () => {
      expect(LifecycleEvent.InstanceDisposed).toBe('instance:disposed');
    });
  });

  describe('Module lifecycle events', () => {
    it('should have ModuleLoading event', () => {
      expect(LifecycleEvent.ModuleLoading).toBe('module:loading');
    });

    it('should have ModuleLoaded event', () => {
      expect(LifecycleEvent.ModuleLoaded).toBe('module:loaded');
    });

    it('should have ModuleInitializing event', () => {
      expect(LifecycleEvent.ModuleInitializing).toBe('module:initializing');
    });

    it('should have ModuleInitialized event', () => {
      expect(LifecycleEvent.ModuleInitialized).toBe('module:initialized');
    });

    it('should have ModuleDestroying event', () => {
      expect(LifecycleEvent.ModuleDestroying).toBe('module:destroying');
    });

    it('should have ModuleDestroyed event', () => {
      expect(LifecycleEvent.ModuleDestroyed).toBe('module:destroyed');
    });
  });

  describe('Cache lifecycle events', () => {
    it('should have CacheHit event', () => {
      expect(LifecycleEvent.CacheHit).toBe('cache:hit');
    });

    it('should have CacheMiss event', () => {
      expect(LifecycleEvent.CacheMiss).toBe('cache:miss');
    });

    it('should have CacheSet event', () => {
      expect(LifecycleEvent.CacheSet).toBe('cache:set');
    });

    it('should have CacheClearing event', () => {
      expect(LifecycleEvent.CacheClearing).toBe('cache:clearing');
    });

    it('should have CacheCleared event', () => {
      expect(LifecycleEvent.CacheCleared).toBe('cache:cleared');
    });
  });

  describe('Scope lifecycle events', () => {
    it('should have ScopeCreated event', () => {
      expect(LifecycleEvent.ScopeCreated).toBe('scope:created');
    });

    it('should have ScopeDisposing event', () => {
      expect(LifecycleEvent.ScopeDisposing).toBe('scope:disposing');
    });

    it('should have ScopeDisposed event', () => {
      expect(LifecycleEvent.ScopeDisposed).toBe('scope:disposed');
    });
  });

  describe('Middleware lifecycle events', () => {
    it('should have MiddlewareAdded event', () => {
      expect(LifecycleEvent.MiddlewareAdded).toBe('middleware:added');
    });

    it('should have MiddlewareRemoved event', () => {
      expect(LifecycleEvent.MiddlewareRemoved).toBe('middleware:removed');
    });

    it('should have MiddlewareExecuting event', () => {
      expect(LifecycleEvent.MiddlewareExecuting).toBe('middleware:executing');
    });

    it('should have MiddlewareExecuted event', () => {
      expect(LifecycleEvent.MiddlewareExecuted).toBe('middleware:executed');
    });
  });

  describe('Plugin lifecycle events', () => {
    it('should have PluginInstalling event', () => {
      expect(LifecycleEvent.PluginInstalling).toBe('plugin:installing');
    });

    it('should have PluginInstalled event', () => {
      expect(LifecycleEvent.PluginInstalled).toBe('plugin:installed');
    });

    it('should have PluginUninstalling event', () => {
      expect(LifecycleEvent.PluginUninstalling).toBe('plugin:uninstalling');
    });

    it('should have PluginUninstalled event', () => {
      expect(LifecycleEvent.PluginUninstalled).toBe('plugin:uninstalled');
    });
  });
});

// ============================================================================
// LifecycleManager Tests
// ============================================================================

describe('LifecycleManager', () => {
  let manager: LifecycleManager;

  beforeEach(() => {
    manager = new LifecycleManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('Construction', () => {
    it('should create manager without logger', () => {
      const mgr = new LifecycleManager();
      expect(mgr).toBeInstanceOf(LifecycleManager);
      expect(mgr.isEnabled()).toBe(true);
    });

    it('should create manager with logger', () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);
      expect(mgr).toBeInstanceOf(LifecycleManager);
    });

    it('should set logger after construction', () => {
      const mgr = new LifecycleManager();
      const logger = createMockLogger();
      mgr.setLogger(logger);
      // Logger is set; test indirectly by triggering error logging
      expect(mgr).toBeDefined();
    });
  });

  describe('Hook Registration (on/off)', () => {
    it('should register a hook for an event', async () => {
      const hook = vi.fn();
      manager.on(LifecycleEvent.ContainerCreated, hook);

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('should register multiple hooks for the same event', async () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();
      const hook3 = vi.fn();

      manager.on(LifecycleEvent.ContainerCreated, hook1);
      manager.on(LifecycleEvent.ContainerCreated, hook2);
      manager.on(LifecycleEvent.ContainerCreated, hook3);

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook1).toHaveBeenCalledTimes(1);
      expect(hook2).toHaveBeenCalledTimes(1);
      expect(hook3).toHaveBeenCalledTimes(1);
    });

    it('should register hooks for different events', async () => {
      const createdHook = vi.fn();
      const disposedHook = vi.fn();

      manager.on(LifecycleEvent.ContainerCreated, createdHook);
      manager.on(LifecycleEvent.ContainerDisposed, disposedHook);

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(createdHook).toHaveBeenCalledTimes(1);
      expect(disposedHook).not.toHaveBeenCalled();
    });

    it('should unregister a hook', async () => {
      const hook = vi.fn();
      manager.on(LifecycleEvent.ContainerCreated, hook);
      manager.off(LifecycleEvent.ContainerCreated, hook);

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook).not.toHaveBeenCalled();
    });

    it('should handle unregistering non-existent hook', () => {
      const hook = vi.fn();
      // Should not throw
      expect(() => {
        manager.off(LifecycleEvent.ContainerCreated, hook);
      }).not.toThrow();
    });

    it('should handle unregistering from non-existent event', () => {
      const hook = vi.fn();
      // Should not throw
      expect(() => {
        manager.off(LifecycleEvent.PluginUninstalled, hook);
      }).not.toThrow();
    });

    it('should pass event data to hooks', async () => {
      const hook = vi.fn();
      const token = createToken<string>('TestService');

      manager.on(LifecycleEvent.InstanceCreated, hook);

      await manager.emit(LifecycleEvent.InstanceCreated, {
        token,
        instance: { value: 'test' },
        metadata: { custom: 'data' },
      });

      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({
          event: LifecycleEvent.InstanceCreated,
          token,
          instance: { value: 'test' },
          metadata: { custom: 'data' },
          timestamp: expect.any(Number),
        })
      );
    });
  });

  describe('One-time Hooks (once)', () => {
    it('should execute once hook only once', async () => {
      const hook = vi.fn();
      manager.once(LifecycleEvent.ContainerCreated, hook);

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('should execute once hook with event data', async () => {
      const hook = vi.fn();
      const token = createToken<string>('TestService');

      manager.once(LifecycleEvent.BeforeResolve, hook);

      await manager.emit(LifecycleEvent.BeforeResolve, { token });

      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({
          event: LifecycleEvent.BeforeResolve,
          token,
        })
      );
    });

    it('should handle async once hooks', async () => {
      let resolved = false;
      const hook: LifecycleHook = async () => {
        await delay(10);
        resolved = true;
      };

      manager.once(LifecycleEvent.ContainerCreated, hook);

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(resolved).toBe(true);
    });

    it('should allow multiple once hooks for same event', async () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();

      manager.once(LifecycleEvent.ContainerCreated, hook1);
      manager.once(LifecycleEvent.ContainerCreated, hook2);

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook1).toHaveBeenCalledTimes(1);
      expect(hook2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Async Event Emission (emit)', () => {
    it('should emit events asynchronously', async () => {
      let order: number[] = [];
      const hook1: LifecycleHook = async () => {
        await delay(20);
        order.push(1);
      };
      const hook2: LifecycleHook = async () => {
        await delay(10);
        order.push(2);
      };

      manager.on(LifecycleEvent.ContainerCreated, hook1);
      manager.on(LifecycleEvent.ContainerCreated, hook2);

      await manager.emit(LifecycleEvent.ContainerCreated);

      // Hooks are executed sequentially, so hook1 completes before hook2 starts
      expect(order).toEqual([1, 2]);
    });

    it('should include timestamp in event data', async () => {
      let receivedTimestamp: number | undefined;
      const hook: LifecycleHook = (data) => {
        receivedTimestamp = data.timestamp;
      };

      const beforeEmit = Date.now();
      manager.on(LifecycleEvent.ContainerCreated, hook);
      await manager.emit(LifecycleEvent.ContainerCreated);
      const afterEmit = Date.now();

      expect(receivedTimestamp).toBeGreaterThanOrEqual(beforeEmit);
      expect(receivedTimestamp).toBeLessThanOrEqual(afterEmit);
    });

    it('should handle hook errors gracefully', async () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const goodHook = vi.fn();
      const errorHook: LifecycleHook = () => {
        throw new Error('Hook error');
      };

      mgr.on(LifecycleEvent.ContainerCreated, errorHook);
      mgr.on(LifecycleEvent.ContainerCreated, goodHook);

      await mgr.emit(LifecycleEvent.ContainerCreated);

      expect(goodHook).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle async hook errors gracefully', async () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const goodHook = vi.fn();
      const errorHook: LifecycleHook = async () => {
        await delay(5);
        throw new Error('Async hook error');
      };

      mgr.on(LifecycleEvent.ContainerCreated, errorHook);
      mgr.on(LifecycleEvent.ContainerCreated, goodHook);

      await mgr.emit(LifecycleEvent.ContainerCreated);

      expect(goodHook).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should not emit when disabled', async () => {
      const hook = vi.fn();
      manager.on(LifecycleEvent.ContainerCreated, hook);
      manager.setEnabled(false);

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook).not.toHaveBeenCalled();
    });
  });

  describe('Sync Event Emission (emitSync)', () => {
    it('should emit events synchronously', () => {
      const hook = vi.fn();
      manager.on(LifecycleEvent.ContainerCreated, hook);

      manager.emitSync(LifecycleEvent.ContainerCreated);

      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('should pass event data in sync emission', () => {
      const hook = vi.fn();
      const token = createToken<string>('TestService');

      manager.on(LifecycleEvent.InstanceCreated, hook);

      manager.emitSync(LifecycleEvent.InstanceCreated, {
        token,
        instance: { value: 'sync-test' },
      });

      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({
          event: LifecycleEvent.InstanceCreated,
          token,
          instance: { value: 'sync-test' },
        })
      );
    });

    it('should handle sync hook errors gracefully', () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const goodHook = vi.fn();
      const errorHook: LifecycleHook = () => {
        throw new Error('Sync hook error');
      };

      mgr.on(LifecycleEvent.ContainerCreated, errorHook);
      mgr.on(LifecycleEvent.ContainerCreated, goodHook);

      mgr.emitSync(LifecycleEvent.ContainerCreated);

      expect(goodHook).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle async hooks in sync emission', async () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      let resolved = false;
      const asyncHook: LifecycleHook = async () => {
        await delay(10);
        resolved = true;
      };

      mgr.on(LifecycleEvent.ContainerCreated, asyncHook);
      mgr.emitSync(LifecycleEvent.ContainerCreated);

      // Sync emit returns immediately, async hook runs in background
      expect(resolved).toBe(false);

      // Wait for async hook to complete
      await delay(50);
      expect(resolved).toBe(true);
    });

    it('should log async errors in sync emission', async () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const asyncErrorHook: LifecycleHook = async () => {
        await delay(5);
        throw new Error('Async error in sync emit');
      };

      mgr.on(LifecycleEvent.ContainerCreated, asyncErrorHook);
      mgr.emitSync(LifecycleEvent.ContainerCreated);

      // Wait for async error
      await delay(50);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should not emit sync when disabled', () => {
      const hook = vi.fn();
      manager.on(LifecycleEvent.ContainerCreated, hook);
      manager.setEnabled(false);

      manager.emitSync(LifecycleEvent.ContainerCreated);

      expect(hook).not.toHaveBeenCalled();
    });
  });

  describe('Observer Management', () => {
    it('should add and notify observer', async () => {
      const observer: LifecycleObserver = {
        onEvent: vi.fn(),
      };

      manager.addObserver(observer);
      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(observer.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: LifecycleEvent.ContainerCreated,
        })
      );
    });

    it('should remove observer', async () => {
      const observer: LifecycleObserver = {
        onEvent: vi.fn(),
      };

      manager.addObserver(observer);
      manager.removeObserver(observer);
      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(observer.onEvent).not.toHaveBeenCalled();
    });

    it('should filter events for observer with events array', async () => {
      const observer: LifecycleObserver = {
        onEvent: vi.fn(),
        events: [LifecycleEvent.InstanceCreated, LifecycleEvent.InstanceDisposed],
      };

      manager.addObserver(observer);

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.InstanceCreated);
      await manager.emit(LifecycleEvent.ContainerDisposed);
      await manager.emit(LifecycleEvent.InstanceDisposed);

      expect(observer.onEvent).toHaveBeenCalledTimes(2);
      expect(observer.onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: LifecycleEvent.InstanceCreated }));
      expect(observer.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: LifecycleEvent.InstanceDisposed })
      );
    });

    it('should handle observer errors gracefully', async () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const errorObserver: LifecycleObserver = {
        onEvent: () => {
          throw new Error('Observer error');
        },
      };

      const goodObserver: LifecycleObserver = {
        onEvent: vi.fn(),
      };

      mgr.addObserver(errorObserver);
      mgr.addObserver(goodObserver);

      await mgr.emit(LifecycleEvent.ContainerCreated);

      expect(goodObserver.onEvent).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle async observer errors gracefully', async () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const errorObserver: LifecycleObserver = {
        onEvent: async () => {
          await delay(5);
          throw new Error('Async observer error');
        },
      };

      mgr.addObserver(errorObserver);
      await mgr.emit(LifecycleEvent.ContainerCreated);

      expect(logger.error).toHaveBeenCalled();
    });

    it('should notify observers in sync emission', () => {
      const observer: LifecycleObserver = {
        onEvent: vi.fn(),
      };

      manager.addObserver(observer);
      manager.emitSync(LifecycleEvent.ContainerCreated);

      expect(observer.onEvent).toHaveBeenCalled();
    });

    it('should handle sync observer errors gracefully', () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const errorObserver: LifecycleObserver = {
        onEvent: () => {
          throw new Error('Sync observer error');
        },
      };

      mgr.addObserver(errorObserver);
      mgr.emitSync(LifecycleEvent.ContainerCreated);

      expect(logger.error).toHaveBeenCalled();
    });

    it('should log async observer errors in sync emission', async () => {
      const logger = createMockLogger();
      const mgr = new LifecycleManager(logger);

      const asyncErrorObserver: LifecycleObserver = {
        onEvent: async () => {
          await delay(5);
          throw new Error('Async observer error in sync emit');
        },
      };

      mgr.addObserver(asyncErrorObserver);
      mgr.emitSync(LifecycleEvent.ContainerCreated);

      await delay(50);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('History Management', () => {
    it('should record events in history', async () => {
      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.InstanceCreated);
      await manager.emit(LifecycleEvent.ContainerDisposed);

      const history = manager.getHistory();
      expect(history).toHaveLength(3);
    });

    it('should filter history by event type', async () => {
      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.InstanceCreated);
      await manager.emit(LifecycleEvent.InstanceCreated);
      await manager.emit(LifecycleEvent.ContainerDisposed);

      const instanceHistory = manager.getHistory(LifecycleEvent.InstanceCreated);
      expect(instanceHistory).toHaveLength(2);
      expect(instanceHistory.every((e) => e.event === LifecycleEvent.InstanceCreated)).toBe(true);
    });

    it('should clear history', async () => {
      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.InstanceCreated);

      manager.clearHistory();

      expect(manager.getHistory()).toHaveLength(0);
    });

    it('should return copy of history array', async () => {
      await manager.emit(LifecycleEvent.ContainerCreated);

      const history1 = manager.getHistory();
      const history2 = manager.getHistory();

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });

    it('should respect max history size', async () => {
      manager.setMaxHistorySize(3);

      for (let i = 0; i < 10; i++) {
        await manager.emit(LifecycleEvent.InstanceCreated, { metadata: { index: i } });
      }

      const history = manager.getHistory();
      expect(history).toHaveLength(3);
      // Should keep the most recent events
      expect(history[0].metadata?.index).toBe(7);
      expect(history[1].metadata?.index).toBe(8);
      expect(history[2].metadata?.index).toBe(9);
    });

    it('should trim history when max size is reduced', async () => {
      for (let i = 0; i < 10; i++) {
        await manager.emit(LifecycleEvent.InstanceCreated, { metadata: { index: i } });
      }

      manager.setMaxHistorySize(2);

      const history = manager.getHistory();
      expect(history).toHaveLength(2);
    });

    it('should record sync events in history', () => {
      manager.emitSync(LifecycleEvent.ContainerCreated);
      manager.emitSync(LifecycleEvent.InstanceCreated);

      expect(manager.getHistory()).toHaveLength(2);
    });

    it('should not record events when disabled', async () => {
      manager.setEnabled(false);
      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(manager.getHistory()).toHaveLength(0);
    });

    it('should store event data in history', async () => {
      const token = createToken<string>('TestService');
      const instance = { value: 'test' };
      const error = new Error('test error');
      const metadata = { custom: 'data' };

      await manager.emit(LifecycleEvent.ResolveFailed, {
        token,
        instance,
        error,
        metadata,
      });

      const history = manager.getHistory();
      expect(history[0]).toMatchObject({
        event: LifecycleEvent.ResolveFailed,
        token,
        instance,
        error,
        metadata,
      });
    });
  });

  describe('Enabled State', () => {
    it('should be enabled by default', () => {
      expect(manager.isEnabled()).toBe(true);
    });

    it('should disable lifecycle events', async () => {
      const hook = vi.fn();
      manager.on(LifecycleEvent.ContainerCreated, hook);

      manager.setEnabled(false);
      expect(manager.isEnabled()).toBe(false);

      await manager.emit(LifecycleEvent.ContainerCreated);
      manager.emitSync(LifecycleEvent.ContainerCreated);

      expect(hook).not.toHaveBeenCalled();
    });

    it('should re-enable lifecycle events', async () => {
      const hook = vi.fn();
      manager.on(LifecycleEvent.ContainerCreated, hook);

      manager.setEnabled(false);
      manager.setEnabled(true);
      expect(manager.isEnabled()).toBe(true);

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook).toHaveBeenCalled();
    });
  });

  describe('Clear', () => {
    it('should clear all hooks', async () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();

      manager.on(LifecycleEvent.ContainerCreated, hook1);
      manager.on(LifecycleEvent.InstanceCreated, hook2);

      manager.clear();

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.InstanceCreated);

      expect(hook1).not.toHaveBeenCalled();
      expect(hook2).not.toHaveBeenCalled();
    });

    it('should clear all observers', async () => {
      const observer: LifecycleObserver = {
        onEvent: vi.fn(),
      };

      manager.addObserver(observer);
      manager.clear();

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(observer.onEvent).not.toHaveBeenCalled();
    });

    it('should clear history', async () => {
      await manager.emit(LifecycleEvent.ContainerCreated);
      manager.clear();

      expect(manager.getHistory()).toHaveLength(0);
    });
  });
});

// ============================================================================
// PerformanceObserver Tests
// ============================================================================

describe('PerformanceObserver', () => {
  let observer: PerformanceObserver;
  let manager: LifecycleManager;

  beforeEach(() => {
    observer = new PerformanceObserver();
    manager = new LifecycleManager();
    manager.addObserver(observer);
  });

  afterEach(() => {
    manager.clear();
    observer.clearMetrics();
  });

  describe('Construction', () => {
    it('should create observer without logger', () => {
      const obs = new PerformanceObserver();
      expect(obs).toBeInstanceOf(PerformanceObserver);
    });

    it('should create observer with logger', () => {
      const logger = createMockLogger();
      const obs = new PerformanceObserver(logger);
      expect(obs).toBeInstanceOf(PerformanceObserver);
    });

    it('should set logger after construction', () => {
      const obs = new PerformanceObserver();
      const logger = createMockLogger();
      obs.setLogger(logger);
      expect(obs).toBeDefined();
    });

    it('should observe resolve events', () => {
      expect(observer.events).toContain(LifecycleEvent.BeforeResolve);
      expect(observer.events).toContain(LifecycleEvent.AfterResolve);
      expect(observer.events).toContain(LifecycleEvent.ResolveFailed);
    });
  });

  describe('Metrics Tracking', () => {
    it('should track resolution time', () => {
      const token = createToken<string>('TestService');

      observer.onEvent({
        event: LifecycleEvent.BeforeResolve,
        timestamp: Date.now(),
        token,
      });

      observer.onEvent({
        event: LifecycleEvent.AfterResolve,
        timestamp: Date.now(),
        token,
      });

      const metrics = observer.getMetrics();
      expect(metrics.has('TestService')).toBe(true);
      expect(metrics.get('TestService')?.count).toBe(1);
    });

    it('should track multiple resolutions for same token', () => {
      const token = createToken<string>('TestService');

      for (let i = 0; i < 5; i++) {
        observer.onEvent({
          event: LifecycleEvent.BeforeResolve,
          timestamp: Date.now(),
          token,
        });
        observer.onEvent({
          event: LifecycleEvent.AfterResolve,
          timestamp: Date.now(),
          token,
        });
      }

      const metrics = observer.getMetrics();
      expect(metrics.get('TestService')?.count).toBe(5);
    });

    it('should track different tokens separately', () => {
      const token1 = createToken<string>('Service1');
      const token2 = createToken<string>('Service2');

      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token: token1 });
      observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token: token1 });

      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token: token2 });
      observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token: token2 });
      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token: token2 });
      observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token: token2 });

      const metrics = observer.getMetrics();
      expect(metrics.get('Service1')?.count).toBe(1);
      expect(metrics.get('Service2')?.count).toBe(2);
    });

    it('should calculate total time and average time', async () => {
      const token = createToken<string>('SlowService');

      // Simulate slow resolution
      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token });
      await delay(50);
      observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token });

      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token });
      await delay(30);
      observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token });

      const metrics = observer.getMetrics();
      const serviceMetrics = metrics.get('SlowService');

      expect(serviceMetrics?.count).toBe(2);
      expect(serviceMetrics?.totalTime).toBeGreaterThanOrEqual(70);
      expect(serviceMetrics?.avgTime).toBeGreaterThanOrEqual(35);
    });

    it('should track failed resolutions', () => {
      const token = createToken<string>('FailingService');

      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token });
      observer.onEvent({
        event: LifecycleEvent.ResolveFailed,
        timestamp: Date.now(),
        token,
        error: new Error('Resolution failed'),
      });

      const metrics = observer.getMetrics();
      expect(metrics.get('FailingService')?.count).toBe(1);
    });

    it('should warn about slow resolution', async () => {
      const logger = createMockLogger();
      const obs = new PerformanceObserver(logger);

      const token = createToken<string>('VerySlowService');

      obs.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token });
      await delay(150); // Exceed threshold (100ms)
      obs.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'VerySlowService' }),
        expect.stringContaining('Slow resolution')
      );
    });
  });

  describe('Metrics Management', () => {
    it('should return copy of metrics', () => {
      const token = createToken<string>('TestService');

      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token });
      observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token });

      const metrics1 = observer.getMetrics();
      const metrics2 = observer.getMetrics();

      expect(metrics1).not.toBe(metrics2);
    });

    it('should clear metrics', () => {
      const token = createToken<string>('TestService');

      observer.onEvent({ event: LifecycleEvent.BeforeResolve, timestamp: Date.now(), token });
      observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token });

      observer.clearMetrics();

      expect(observer.getMetrics().size).toBe(0);
    });

    it('should handle missing start timer gracefully', () => {
      const token = createToken<string>('TestService');

      // AfterResolve without BeforeResolve
      expect(() => {
        observer.onEvent({ event: LifecycleEvent.AfterResolve, timestamp: Date.now(), token });
      }).not.toThrow();
    });
  });

  describe('Integration with LifecycleManager', () => {
    it('should receive events from lifecycle manager', async () => {
      const token = createToken<string>('IntegrationService');

      await manager.emit(LifecycleEvent.BeforeResolve, { token });
      await manager.emit(LifecycleEvent.AfterResolve, { token });

      const metrics = observer.getMetrics();
      expect(metrics.has('IntegrationService')).toBe(true);
    });

    it('should only receive resolve events', async () => {
      const token = createToken<string>('TestService');

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.BeforeResolve, { token });
      await manager.emit(LifecycleEvent.AfterResolve, { token });
      await manager.emit(LifecycleEvent.InstanceCreated, { token });

      const metrics = observer.getMetrics();
      expect(metrics.size).toBe(1);
    });
  });
});

// ============================================================================
// MemoryObserver Tests
// ============================================================================

describe('MemoryObserver', () => {
  let observer: MemoryObserver;
  let manager: LifecycleManager;

  beforeEach(() => {
    observer = new MemoryObserver();
    manager = new LifecycleManager();
    manager.addObserver(observer);
  });

  afterEach(() => {
    manager.clear();
    observer.clearCounts();
  });

  describe('Construction', () => {
    it('should create observer without logger', () => {
      const obs = new MemoryObserver();
      expect(obs).toBeInstanceOf(MemoryObserver);
    });

    it('should create observer with logger', () => {
      const logger = createMockLogger();
      const obs = new MemoryObserver(logger);
      expect(obs).toBeInstanceOf(MemoryObserver);
    });

    it('should set logger after construction', () => {
      const obs = new MemoryObserver();
      const logger = createMockLogger();
      obs.setLogger(logger);
      expect(obs).toBeDefined();
    });

    it('should observe instance events', () => {
      expect(observer.events).toContain(LifecycleEvent.InstanceCreated);
      expect(observer.events).toContain(LifecycleEvent.InstanceDisposed);
    });
  });

  describe('Instance Counting', () => {
    it('should count created instances', () => {
      const token = createToken<string>('TestService');

      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token });
      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token });
      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token });

      const counts = observer.getInstanceCounts();
      expect(counts.get('TestService')).toBe(3);
    });

    it('should decrement on instance disposal', () => {
      const token = createToken<string>('TestService');

      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token });
      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token });
      observer.onEvent({ event: LifecycleEvent.InstanceDisposed, timestamp: Date.now(), token });

      const counts = observer.getInstanceCounts();
      expect(counts.get('TestService')).toBe(1);
    });

    it('should not go below zero', () => {
      const token = createToken<string>('TestService');

      // Disposing without prior creation should not add a count
      observer.onEvent({ event: LifecycleEvent.InstanceDisposed, timestamp: Date.now(), token });

      const counts = observer.getInstanceCounts();
      // The key is not added since count was 0 and disposal doesn't set values
      expect(counts.has('TestService')).toBe(false);
    });

    it('should track different tokens separately', () => {
      const token1 = createToken<string>('Service1');
      const token2 = createToken<string>('Service2');

      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token: token1 });
      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token: token2 });
      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token: token2 });

      const counts = observer.getInstanceCounts();
      expect(counts.get('Service1')).toBe(1);
      expect(counts.get('Service2')).toBe(2);
    });
  });

  describe('Counts Management', () => {
    it('should return copy of counts', () => {
      const token = createToken<string>('TestService');

      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token });

      const counts1 = observer.getInstanceCounts();
      const counts2 = observer.getInstanceCounts();

      expect(counts1).not.toBe(counts2);
    });

    it('should clear counts', () => {
      const token = createToken<string>('TestService');

      observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now(), token });
      observer.clearCounts();

      expect(observer.getInstanceCounts().size).toBe(0);
    });
  });

  describe('Integration with LifecycleManager', () => {
    it('should receive events from lifecycle manager', async () => {
      const token = createToken<string>('IntegrationService');

      await manager.emit(LifecycleEvent.InstanceCreated, { token });
      await manager.emit(LifecycleEvent.InstanceCreated, { token });

      const counts = observer.getInstanceCounts();
      expect(counts.get('IntegrationService')).toBe(2);
    });

    it('should only receive instance events', async () => {
      const token = createToken<string>('TestService');

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.BeforeResolve, { token });
      await manager.emit(LifecycleEvent.InstanceCreated, { token });
      await manager.emit(LifecycleEvent.AfterResolve, { token });

      const counts = observer.getInstanceCounts();
      expect(counts.size).toBe(1);
    });
  });
});

// ============================================================================
// AuditObserver Tests
// ============================================================================

describe('AuditObserver', () => {
  let observer: AuditObserver;
  let manager: LifecycleManager;

  beforeEach(() => {
    observer = new AuditObserver();
    manager = new LifecycleManager();
    manager.addObserver(observer);
  });

  afterEach(() => {
    manager.clear();
    observer.clearLog();
  });

  describe('Construction', () => {
    it('should create observer without user context', () => {
      const obs = new AuditObserver();
      expect(obs).toBeInstanceOf(AuditObserver);
    });

    it('should create observer with user context function', () => {
      const getUserContext = () => ({ user: 'admin' });
      const obs = new AuditObserver(getUserContext);
      expect(obs).toBeInstanceOf(AuditObserver);
    });
  });

  describe('Audit Logging', () => {
    it('should log events', async () => {
      await observer.onEvent({
        event: LifecycleEvent.ContainerCreated,
        timestamp: Date.now(),
      });

      const log = observer.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].event).toBe(LifecycleEvent.ContainerCreated);
    });

    it('should include token in log entry', async () => {
      const token = createToken<string>('TestService');

      await observer.onEvent({
        event: LifecycleEvent.InstanceCreated,
        timestamp: Date.now(),
        token,
      });

      const log = observer.getAuditLog();
      expect(log[0].token).toBe('TestService');
    });

    it('should include user context', async () => {
      const getUserContext = () => ({ user: 'admin', role: 'superuser' });
      const obs = new AuditObserver(getUserContext);

      await obs.onEvent({
        event: LifecycleEvent.ContainerCreated,
        timestamp: Date.now(),
      });

      const log = obs.getAuditLog();
      expect(log[0].user).toBe('admin');
      expect(log[0].metadata?.role).toBe('superuser');
    });

    it('should include event metadata', async () => {
      await observer.onEvent({
        event: LifecycleEvent.InstanceCreated,
        timestamp: Date.now(),
        metadata: { custom: 'data', info: 42 },
      });

      const log = observer.getAuditLog();
      expect(log[0].metadata?.custom).toBe('data');
      expect(log[0].metadata?.info).toBe(42);
    });

    it('should preserve timestamp', async () => {
      const timestamp = Date.now();

      await observer.onEvent({
        event: LifecycleEvent.ContainerCreated,
        timestamp,
      });

      const log = observer.getAuditLog();
      expect(log[0].timestamp).toBe(timestamp);
    });

    it('should log multiple events', async () => {
      await observer.onEvent({ event: LifecycleEvent.ContainerCreated, timestamp: Date.now() });
      await observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now() });
      await observer.onEvent({ event: LifecycleEvent.ContainerDisposed, timestamp: Date.now() });

      const log = observer.getAuditLog();
      expect(log).toHaveLength(3);
    });

    it('should merge user context with event metadata', async () => {
      const getUserContext = () => ({ user: 'admin', sessionId: '123' });
      const obs = new AuditObserver(getUserContext);

      await obs.onEvent({
        event: LifecycleEvent.InstanceCreated,
        timestamp: Date.now(),
        metadata: { action: 'create' },
      });

      const log = obs.getAuditLog();
      expect(log[0].metadata?.action).toBe('create');
      expect(log[0].metadata?.user).toBe('admin');
      expect(log[0].metadata?.sessionId).toBe('123');
    });
  });

  describe('Log Management', () => {
    it('should return copy of audit log', async () => {
      await observer.onEvent({ event: LifecycleEvent.ContainerCreated, timestamp: Date.now() });

      const log1 = observer.getAuditLog();
      const log2 = observer.getAuditLog();

      expect(log1).not.toBe(log2);
      expect(log1).toEqual(log2);
    });

    it('should clear audit log', async () => {
      await observer.onEvent({ event: LifecycleEvent.ContainerCreated, timestamp: Date.now() });
      await observer.onEvent({ event: LifecycleEvent.InstanceCreated, timestamp: Date.now() });

      observer.clearLog();

      expect(observer.getAuditLog()).toHaveLength(0);
    });
  });

  describe('Integration with LifecycleManager', () => {
    it('should receive all events from lifecycle manager', async () => {
      const token = createToken<string>('TestService');

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.BeforeResolve, { token });
      await manager.emit(LifecycleEvent.InstanceCreated, { token });
      await manager.emit(LifecycleEvent.AfterResolve, { token });

      const log = observer.getAuditLog();
      expect(log).toHaveLength(4);
    });

    it('should handle undefined token', async () => {
      await manager.emit(LifecycleEvent.ContainerCreated);

      const log = observer.getAuditLog();
      expect(log[0].token).toBeUndefined();
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  describe('LifecycleManager edge cases', () => {
    it('should handle emitting to non-existent event hooks', async () => {
      const manager = new LifecycleManager();

      // Should not throw
      await expect(manager.emit(LifecycleEvent.PluginUninstalled)).resolves.toBeUndefined();
    });

    it('should handle undefined event data', async () => {
      const manager = new LifecycleManager();
      const hook = vi.fn();

      manager.on(LifecycleEvent.ContainerCreated, hook);
      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({
          event: LifecycleEvent.ContainerCreated,
          timestamp: expect.any(Number),
        })
      );
    });

    it('should handle hooks that return promises', async () => {
      const manager = new LifecycleManager();
      let resolved = false;

      const asyncHook: LifecycleHook = async () => {
        await delay(10);
        resolved = true;
      };

      manager.on(LifecycleEvent.ContainerCreated, asyncHook);
      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(resolved).toBe(true);
    });

    it('should handle removing same hook twice', () => {
      const manager = new LifecycleManager();
      const hook = vi.fn();

      manager.on(LifecycleEvent.ContainerCreated, hook);
      manager.off(LifecycleEvent.ContainerCreated, hook);

      // Should not throw
      expect(() => manager.off(LifecycleEvent.ContainerCreated, hook)).not.toThrow();
    });

    it('should handle max history size of one', async () => {
      const manager = new LifecycleManager();
      manager.setMaxHistorySize(1);

      await manager.emit(LifecycleEvent.ContainerCreated);
      await manager.emit(LifecycleEvent.InstanceCreated);
      await manager.emit(LifecycleEvent.ContainerDisposed);

      // Only keeps the most recent event
      const history = manager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].event).toBe(LifecycleEvent.ContainerDisposed);
    });

    it('should handle adding same observer twice', async () => {
      const manager = new LifecycleManager();
      const observer: LifecycleObserver = {
        onEvent: vi.fn(),
      };

      manager.addObserver(observer);
      manager.addObserver(observer); // Set handles duplicates

      await manager.emit(LifecycleEvent.ContainerCreated);

      expect(observer.onEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Observer edge cases', () => {
    it('should handle undefined token in PerformanceObserver', () => {
      const observer = new PerformanceObserver();

      // Should not throw
      expect(() => {
        observer.onEvent({
          event: LifecycleEvent.BeforeResolve,
          timestamp: Date.now(),
        });
      }).not.toThrow();
    });

    it('should handle undefined token in MemoryObserver', () => {
      const observer = new MemoryObserver();

      // Should not throw
      expect(() => {
        observer.onEvent({
          event: LifecycleEvent.InstanceCreated,
          timestamp: Date.now(),
        });
      }).not.toThrow();
    });

    it('should handle user context function returning empty object', async () => {
      const getUserContext = () => ({});
      const observer = new AuditObserver(getUserContext);

      await observer.onEvent({
        event: LifecycleEvent.ContainerCreated,
        timestamp: Date.now(),
      });

      const log = observer.getAuditLog();
      expect(log[0].user).toBeUndefined();
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  it('should work with multiple observers simultaneously', async () => {
    const manager = new LifecycleManager();
    const perfObserver = new PerformanceObserver();
    const memObserver = new MemoryObserver();
    const auditObserver = new AuditObserver();

    manager.addObserver(perfObserver);
    manager.addObserver(memObserver);
    manager.addObserver(auditObserver);

    const token = createToken<string>('TestService');

    await manager.emit(LifecycleEvent.BeforeResolve, { token });
    await manager.emit(LifecycleEvent.InstanceCreated, { token });
    await manager.emit(LifecycleEvent.AfterResolve, { token });

    expect(perfObserver.getMetrics().has('TestService')).toBe(true);
    expect(memObserver.getInstanceCounts().get('TestService')).toBe(1);
    expect(auditObserver.getAuditLog()).toHaveLength(3);
  });

  it('should support full lifecycle flow', async () => {
    const manager = new LifecycleManager();
    const events: LifecycleEvent[] = [];

    const trackingHook: LifecycleHook = (data) => {
      events.push(data.event);
    };

    // Register for all container and instance events
    manager.on(LifecycleEvent.ContainerCreated, trackingHook);
    manager.on(LifecycleEvent.BeforeResolve, trackingHook);
    manager.on(LifecycleEvent.InstanceCreating, trackingHook);
    manager.on(LifecycleEvent.InstanceCreated, trackingHook);
    manager.on(LifecycleEvent.AfterResolve, trackingHook);
    manager.on(LifecycleEvent.ContainerDisposing, trackingHook);
    manager.on(LifecycleEvent.InstanceDisposing, trackingHook);
    manager.on(LifecycleEvent.InstanceDisposed, trackingHook);
    manager.on(LifecycleEvent.ContainerDisposed, trackingHook);

    // Simulate container lifecycle
    await manager.emit(LifecycleEvent.ContainerCreated);
    await manager.emit(LifecycleEvent.BeforeResolve);
    await manager.emit(LifecycleEvent.InstanceCreating);
    await manager.emit(LifecycleEvent.InstanceCreated);
    await manager.emit(LifecycleEvent.AfterResolve);
    await manager.emit(LifecycleEvent.ContainerDisposing);
    await manager.emit(LifecycleEvent.InstanceDisposing);
    await manager.emit(LifecycleEvent.InstanceDisposed);
    await manager.emit(LifecycleEvent.ContainerDisposed);

    expect(events).toEqual([
      LifecycleEvent.ContainerCreated,
      LifecycleEvent.BeforeResolve,
      LifecycleEvent.InstanceCreating,
      LifecycleEvent.InstanceCreated,
      LifecycleEvent.AfterResolve,
      LifecycleEvent.ContainerDisposing,
      LifecycleEvent.InstanceDisposing,
      LifecycleEvent.InstanceDisposed,
      LifecycleEvent.ContainerDisposed,
    ]);
  });

  it('should handle concurrent emissions', async () => {
    const manager = new LifecycleManager();
    let count = 0;

    const hook: LifecycleHook = async () => {
      await delay(10);
      count++;
    };

    manager.on(LifecycleEvent.InstanceCreated, hook);

    // Emit concurrently
    await Promise.all([
      manager.emit(LifecycleEvent.InstanceCreated),
      manager.emit(LifecycleEvent.InstanceCreated),
      manager.emit(LifecycleEvent.InstanceCreated),
    ]);

    expect(count).toBe(3);
  });

  it('should maintain history order across concurrent emissions', async () => {
    const manager = new LifecycleManager();

    // Sequential emissions to ensure order
    for (let i = 0; i < 5; i++) {
      await manager.emit(LifecycleEvent.InstanceCreated, { metadata: { index: i } });
    }

    const history = manager.getHistory();
    expect(history).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      expect(history[i].metadata?.index).toBe(i);
    }
  });
});
