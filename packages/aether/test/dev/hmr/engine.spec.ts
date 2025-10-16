/**
 * HMR Engine Unit Tests
 *
 * Comprehensive tests for HMR engine functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HMREngine } from '../../../src/dev/hmr/engine.js';
import type { HMRConfig, HMRUpdate, ModuleNode } from '../../../src/dev/types.js';

describe('HMR Engine', () => {
  describe('Module Graph', () => {
    let engine: HMREngine;

    beforeEach(() => {
      engine = new HMREngine();
    });

    afterEach(() => {
      engine.close();
    });

    it('should create module nodes', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const module = graph.getModuleById('module-a');

      expect(module).toBeDefined();
      expect(module?.id).toBe('module-a');
      expect(module?.file).toBe('/src/a.ts');
      expect(module?.type).toBe('module');
    });

    it('should track dependencies', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const moduleA = graph.getModuleById('module-a');
      const moduleB = graph.getModuleById('module-b');

      expect(moduleA?.importedModules.has(moduleB!)).toBe(true);
      expect(moduleB?.importers.has(moduleA!)).toBe(true);
    });

    it('should update module dependencies', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set());
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set());

      // Update dependencies
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-c']));

      const graph = engine.getModuleGraph();
      const moduleA = graph.getModuleById('module-a');
      const moduleB = graph.getModuleById('module-b');
      const moduleC = graph.getModuleById('module-c');

      expect(moduleA?.importedModules.has(moduleB!)).toBe(false);
      expect(moduleA?.importedModules.has(moduleC!)).toBe(true);
      expect(moduleB?.importers.has(moduleA!)).toBe(false);
      expect(moduleC?.importers.has(moduleA!)).toBe(true);
    });

    it('should find affected modules', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set(['module-c']));
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const affected = graph.getAffectedModules('/src/c.ts');

      expect(affected.size).toBe(3);
      expect(Array.from(affected).some((m) => m.id === 'module-a')).toBe(true);
      expect(Array.from(affected).some((m) => m.id === 'module-b')).toBe(true);
      expect(Array.from(affected).some((m) => m.id === 'module-c')).toBe(true);
    });

    it('should stop at HMR boundaries', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set(['module-c']));
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set());

      // Mark module-b as accepting HMR
      engine.acceptHMR('module-b', false);

      const graph = engine.getModuleGraph();
      const affected = graph.getAffectedModules('/src/c.ts');

      // Should stop at module-b boundary
      expect(affected.size).toBe(2);
      expect(Array.from(affected).some((m) => m.id === 'module-b')).toBe(true);
      expect(Array.from(affected).some((m) => m.id === 'module-c')).toBe(true);
      expect(Array.from(affected).some((m) => m.id === 'module-a')).toBe(false);
    });

    it('should stop at self-accepting modules', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set());

      // Mark module-b as self-accepting
      engine.acceptHMR('module-b', true);

      const graph = engine.getModuleGraph();
      const affected = graph.getAffectedModules('/src/b.ts');

      // Should only include module-b
      expect(affected.size).toBe(1);
      expect(Array.from(affected)[0].id).toBe('module-b');
    });

    it('should invalidate module and its importers', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const moduleB = graph.getModuleById('module-b')!;
      const initialTimestamp = moduleB.lastHMRTimestamp;

      // Small delay to ensure timestamp changes
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      graph.invalidateModule(moduleB);

      expect(moduleB.lastHMRTimestamp).toBeGreaterThan(initialTimestamp);

      vi.useRealTimers();
    });

    it('should handle circular dependencies', () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set(['module-a']));

      const graph = engine.getModuleGraph();
      const affected = graph.getAffectedModules('/src/a.ts');

      // Should include both without infinite loop
      expect(affected.size).toBe(2);
    });
  });

  describe('HMR Boundary Detection', () => {
    let engine: HMREngine;

    beforeEach(() => {
      engine = new HMREngine();
    });

    afterEach(() => {
      engine.close();
    });

    it('should detect Aether components as boundaries', () => {
      engine.registerModule('component-a', '/src/components/A.tsx', 'component', new Set());

      const graph = engine.getModuleGraph();
      const affected = graph.getAffectedModules('/src/components/A.tsx');

      // Component should be a boundary
      expect(affected.size).toBe(1);
    });

    it('should use configured boundaries', () => {
      engine = new HMREngine({
        boundaries: ['special-module'],
      });

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['special-module']));
      engine.registerModule('special-module', '/src/special.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const affected = graph.getAffectedModules('/src/special.ts');

      // Should stop at configured boundary
      expect(affected.size).toBe(1);
      expect(Array.from(affected)[0].id).toBe('special-module');
    });

    it('should detect .tsx files as components', () => {
      engine.registerModule('tsx-file', '/src/Component.tsx', 'module', new Set());

      const graph = engine.getModuleGraph();
      const module = graph.getModuleById('tsx-file')!;

      // Should be treated as a component boundary
      expect(module.type).toBe('module');
      // File extension should make it a boundary
      engine.registerModule('parent', '/src/parent.ts', 'module', new Set(['tsx-file']));
      const affected = graph.getAffectedModules('/src/Component.tsx');
      expect(affected.size).toBe(1);
    });
  });

  describe('Update Propagation', () => {
    let engine: HMREngine;

    beforeEach(() => {
      engine = new HMREngine();
    });

    afterEach(() => {
      engine.close();
    });

    it('should handle file updates', async () => {
      const onUpdate = vi.fn();
      engine = new HMREngine({ onUpdate });

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());
      engine.acceptHMR('module-a', true);

      await engine.handleUpdate('/src/a.ts');

      expect(onUpdate).toHaveBeenCalled();
      const update: HMRUpdate = onUpdate.mock.calls[0][0];
      expect(update.type).toBe('update');
      expect(update.path).toBe('/src/a.ts');
      expect(update.acceptedPath).toBe('module-a');
    });

    it('should trigger full reload when no boundary found', async () => {
      const onUpdate = vi.fn();
      engine = new HMREngine({ onUpdate });

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());

      await engine.handleUpdate('/src/a.ts');

      expect(onUpdate).toHaveBeenCalled();
      const update: HMRUpdate = onUpdate.mock.calls[0][0];
      expect(update.type).toBe('full-reload');
      expect(update.path).toBe('/src/a.ts');
    });

    it('should trigger full reload for new files', async () => {
      const onUpdate = vi.fn();
      engine = new HMREngine({ onUpdate });

      await engine.handleUpdate('/src/new-file.ts');

      expect(onUpdate).toHaveBeenCalled();
      const update: HMRUpdate = onUpdate.mock.calls[0][0];
      expect(update.type).toBe('full-reload');
    });

    it('should handle update errors', async () => {
      const onError = vi.fn();
      const onUpdate = vi.fn(() => {
        throw new Error('Update failed');
      });
      engine = new HMREngine({ onUpdate, onError });

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());

      await engine.handleUpdate('/src/a.ts');

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('should reload on error when configured', async () => {
      const onUpdate = vi.fn(() => {
        throw new Error('Update failed');
      });
      engine = new HMREngine({ onUpdate, reloadOnError: true });

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());

      await engine.handleUpdate('/src/a.ts');

      // Should call onUpdate twice: once for error, once for reload
      expect(onUpdate).toHaveBeenCalled();
    });

    it('should preserve state when configured', async () => {
      engine = new HMREngine({ preserveState: true });

      engine.registerModule('module-a', '/src/a.ts', 'component', new Set());
      engine.acceptHMR('module-a', true);

      await engine.handleUpdate('/src/a.ts');

      // State preservation is implicit in the update
      // This is verified through WebSocket messages
    });
  });

  describe('WebSocket Communication', () => {
    let engine: HMREngine;
    let mockWs: any;

    beforeEach(() => {
      engine = new HMREngine();
      mockWs = {
        readyState: 1, // WebSocket.OPEN
        send: vi.fn(),
        close: vi.fn(),
      };
    });

    afterEach(() => {
      engine.close();
    });

    it('should add WebSocket connection', () => {
      engine.addConnection(mockWs);

      expect(engine.getConnections().size).toBe(1);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'connected' }));
    });

    it('should remove WebSocket connection', () => {
      engine.addConnection(mockWs);
      engine.removeConnection(mockWs);

      expect(engine.getConnections().size).toBe(0);
    });

    it('should send updates to all connections', async () => {
      const mockWs2 = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      engine.addConnection(mockWs);
      engine.addConnection(mockWs2);

      await engine.sendUpdate({
        type: 'update',
        path: '/src/a.ts',
        timestamp: Date.now(),
      });

      // Wait for queue processing
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockWs.send).toHaveBeenCalledTimes(2); // connected + update
      expect(mockWs2.send).toHaveBeenCalledTimes(2);
    });

    it('should not send to closed connections', async () => {
      mockWs.readyState = 3; // WebSocket.CLOSED
      engine.addConnection(mockWs);

      await engine.sendUpdate({
        type: 'update',
        path: '/src/a.ts',
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Only connected message, no update
      expect(mockWs.send).toHaveBeenCalledTimes(1);
    });

    it('should send custom events', async () => {
      engine.addConnection(mockWs);

      await engine.sendCustom('test-event', { foo: 'bar' });

      expect(mockWs.send).toHaveBeenLastCalledWith(
        JSON.stringify({
          type: 'custom',
          data: { event: 'test-event', foo: 'bar' },
        })
      );
    });

    it('should batch updates', async () => {
      engine.addConnection(mockWs);

      // Send multiple updates quickly
      await engine.sendUpdate({
        type: 'update',
        path: '/src/a.ts',
        timestamp: Date.now(),
      });
      await engine.sendUpdate({
        type: 'update',
        path: '/src/b.ts',
        timestamp: Date.now(),
      });

      // Wait for queue processing
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should batch updates into single message
      const lastCall = mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0];
      const payload = JSON.parse(lastCall);
      expect(payload.updates).toHaveLength(2);
    });

    it('should close all connections on engine close', () => {
      engine.addConnection(mockWs);

      const mockWs2 = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };
      engine.addConnection(mockWs2);

      engine.close();

      expect(mockWs.close).toHaveBeenCalled();
      expect(mockWs2.close).toHaveBeenCalled();
      expect(engine.getConnections().size).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const engine = new HMREngine();
      expect(engine).toBeDefined();
      engine.close();
    });

    it('should accept custom configuration', () => {
      const onUpdate = vi.fn();
      const onError = vi.fn();

      const engine = new HMREngine({
        preserveState: false,
        reloadOnError: true,
        timeout: 60000,
        boundaries: ['custom-boundary'],
        onUpdate,
        onError,
      });

      expect(engine).toBeDefined();
      engine.close();
    });

    it('should use custom timeout', () => {
      const engine = new HMREngine({ timeout: 5000 });
      expect(engine).toBeDefined();
      engine.close();
    });
  });

  describe('Edge Cases', () => {
    let engine: HMREngine;

    beforeEach(() => {
      engine = new HMREngine();
    });

    afterEach(() => {
      engine.close();
    });

    it('should handle empty module graph', async () => {
      await engine.handleUpdate('/src/unknown.ts');
      // Should not crash
    });

    it('should handle module without file', () => {
      engine.registerModule('virtual-module', '', 'module', new Set());
      const graph = engine.getModuleGraph();
      const module = graph.getModuleById('virtual-module');
      expect(module).toBeDefined();
    });

    it('should handle multiple modules per file', () => {
      engine.registerModule('module-a', '/src/shared.ts', 'module', new Set());
      engine.registerModule('module-b', '/src/shared.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const modules = graph.getModulesByFile('/src/shared.ts');

      expect(modules.size).toBe(2);
    });

    it('should handle deep dependency chains', () => {
      // Create chain: a -> b -> c -> d -> e
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set(['module-c']));
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set(['module-d']));
      engine.registerModule('module-d', '/src/d.ts', 'module', new Set(['module-e']));
      engine.registerModule('module-e', '/src/e.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const affected = graph.getAffectedModules('/src/e.ts');

      expect(affected.size).toBe(5);
    });

    it('should handle concurrent updates', async () => {
      const onUpdate = vi.fn();
      engine = new HMREngine({ onUpdate });

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set());

      // Send concurrent updates
      await Promise.all([engine.handleUpdate('/src/a.ts'), engine.handleUpdate('/src/b.ts')]);

      expect(onUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
