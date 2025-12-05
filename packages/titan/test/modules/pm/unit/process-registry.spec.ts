/**
 * Unit tests for ProcessRegistry
 *
 * Tests process registration, lookup, and index management
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ProcessRegistry } from '../../../../src/modules/pm/process-registry.js';
import { ProcessStatus } from '../../../../src/modules/pm/types.js';
import type { IProcessInfo } from '../../../../src/modules/pm/types.js';

// Helper to create process info
let processCounter = 0;
const createProcessInfo = (overrides: Partial<IProcessInfo> = {}): IProcessInfo => ({
  id: `process-${++processCounter}`,
  name: 'test-service',
  pid: 12345,
  status: ProcessStatus.RUNNING,
  startTime: Date.now(),
  restartCount: 0,
  ...overrides,
});

describe('ProcessRegistry', () => {
  let registry: ProcessRegistry;

  beforeEach(() => {
    registry = new ProcessRegistry();
    processCounter = 0;
  });

  describe('Registration', () => {
    it('should register a process', () => {
      const processInfo = createProcessInfo({ id: 'proc-1', name: 'service-a' });

      registry.register(processInfo);

      expect(registry.get('proc-1')).toEqual(processInfo);
      expect(registry.size).toBe(1);
    });

    it('should register multiple processes', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'service-a' });
      const proc2 = createProcessInfo({ id: 'proc-2', name: 'service-b' });
      const proc3 = createProcessInfo({ id: 'proc-3', name: 'service-c' });

      registry.register(proc1);
      registry.register(proc2);
      registry.register(proc3);

      expect(registry.size).toBe(3);
      expect(registry.get('proc-1')).toEqual(proc1);
      expect(registry.get('proc-2')).toEqual(proc2);
      expect(registry.get('proc-3')).toEqual(proc3);
    });

    it('should register multiple processes with the same name', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'shared-service' });
      const proc2 = createProcessInfo({ id: 'proc-2', name: 'shared-service' });

      registry.register(proc1);
      registry.register(proc2);

      expect(registry.size).toBe(2);

      const allByName = registry.findAllByServiceName('shared-service');
      expect(allByName).toHaveLength(2);
      expect(allByName.map((p) => p.id).sort()).toEqual(['proc-1', 'proc-2'].sort());
    });

    it('should update existing process on re-registration', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'service-a', status: ProcessStatus.RUNNING });
      const proc1Updated = createProcessInfo({
        id: 'proc-1',
        name: 'service-a',
        status: ProcessStatus.STOPPED,
      });

      registry.register(proc1);
      registry.register(proc1Updated);

      expect(registry.size).toBe(1);
      expect(registry.get('proc-1')?.status).toBe(ProcessStatus.STOPPED);
    });

    it('should handle process without name', () => {
      const processInfo = createProcessInfo({ id: 'proc-1', name: '' });

      registry.register(processInfo);

      expect(registry.get('proc-1')).toEqual(processInfo);
      expect(registry.findByServiceName('')).toBeUndefined();
    });

    it('should update service index when name changes', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'old-name' });
      const proc1Updated = createProcessInfo({ id: 'proc-1', name: 'new-name' });

      registry.register(proc1);
      registry.register(proc1Updated);

      // Note: The current implementation doesn't remove the old name from index
      // This test documents current behavior
      expect(registry.findByServiceName('new-name')).toBeDefined();
    });
  });

  describe('Unregistration', () => {
    it('should unregister a process by ID', () => {
      const processInfo = createProcessInfo({ id: 'proc-1', name: 'service-a' });

      registry.register(processInfo);
      registry.unregister('proc-1');

      expect(registry.get('proc-1')).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it('should remove process from service name index', () => {
      const processInfo = createProcessInfo({ id: 'proc-1', name: 'service-a' });

      registry.register(processInfo);
      registry.unregister('proc-1');

      expect(registry.findByServiceName('service-a')).toBeUndefined();
    });

    it('should handle unregistering non-existent process', () => {
      // Should not throw
      registry.unregister('non-existent');
      expect(registry.size).toBe(0);
    });

    it('should keep other processes with same name when one is unregistered', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'shared-service' });
      const proc2 = createProcessInfo({ id: 'proc-2', name: 'shared-service' });

      registry.register(proc1);
      registry.register(proc2);
      registry.unregister('proc-1');

      expect(registry.size).toBe(1);
      expect(registry.findByServiceName('shared-service')).toEqual(proc2);
      expect(registry.findAllByServiceName('shared-service')).toHaveLength(1);
    });

    it('should cleanup empty service name index entries', () => {
      const processInfo = createProcessInfo({ id: 'proc-1', name: 'service-a' });

      registry.register(processInfo);
      registry.unregister('proc-1');

      // After unregistering the only process with that name,
      // the index entry should be cleaned up
      expect(registry.findAllByServiceName('service-a')).toHaveLength(0);
    });
  });

  describe('Lookup by ID', () => {
    it('should get process by ID', () => {
      const processInfo = createProcessInfo({ id: 'proc-1', name: 'service-a' });
      registry.register(processInfo);

      const result = registry.get('proc-1');

      expect(result).toEqual(processInfo);
    });

    it('should return undefined for non-existent ID', () => {
      const result = registry.get('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('Lookup by Service Name', () => {
    it('should find process by service name', () => {
      const processInfo = createProcessInfo({ id: 'proc-1', name: 'service-a' });
      registry.register(processInfo);

      const result = registry.findByServiceName('service-a');

      expect(result).toEqual(processInfo);
    });

    it('should return first available process when multiple exist', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'shared-service' });
      const proc2 = createProcessInfo({ id: 'proc-2', name: 'shared-service' });

      registry.register(proc1);
      registry.register(proc2);

      const result = registry.findByServiceName('shared-service');

      // Should return one of the processes
      expect(result).toBeDefined();
      expect(['proc-1', 'proc-2']).toContain(result?.id);
    });

    it('should return undefined for non-existent service name', () => {
      const result = registry.findByServiceName('non-existent');

      expect(result).toBeUndefined();
    });

    it('should return undefined for empty service name index', () => {
      // Register and then unregister to leave empty index
      const processInfo = createProcessInfo({ id: 'proc-1', name: 'service-a' });
      registry.register(processInfo);
      registry.unregister('proc-1');

      const result = registry.findByServiceName('service-a');

      expect(result).toBeUndefined();
    });
  });

  describe('Find All by Service Name', () => {
    it('should find all processes by service name', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'shared-service' });
      const proc2 = createProcessInfo({ id: 'proc-2', name: 'shared-service' });
      const proc3 = createProcessInfo({ id: 'proc-3', name: 'other-service' });

      registry.register(proc1);
      registry.register(proc2);
      registry.register(proc3);

      const results = registry.findAllByServiceName('shared-service');

      expect(results).toHaveLength(2);
      expect(results.map((p) => p.id).sort()).toEqual(['proc-1', 'proc-2'].sort());
    });

    it('should return empty array for non-existent service name', () => {
      const results = registry.findAllByServiceName('non-existent');

      expect(results).toEqual([]);
    });

    it('should return empty array after all processes unregistered', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'service-a' });
      const proc2 = createProcessInfo({ id: 'proc-2', name: 'service-a' });

      registry.register(proc1);
      registry.register(proc2);
      registry.unregister('proc-1');
      registry.unregister('proc-2');

      const results = registry.findAllByServiceName('service-a');

      expect(results).toEqual([]);
    });
  });

  describe('Get All Processes', () => {
    it('should return all registered processes', () => {
      const proc1 = createProcessInfo({ id: 'proc-1', name: 'service-a' });
      const proc2 = createProcessInfo({ id: 'proc-2', name: 'service-b' });
      const proc3 = createProcessInfo({ id: 'proc-3', name: 'service-c' });

      registry.register(proc1);
      registry.register(proc2);
      registry.register(proc3);

      const results = registry.getAll();

      expect(results).toHaveLength(3);
      expect(results).toContainEqual(proc1);
      expect(results).toContainEqual(proc2);
      expect(results).toContainEqual(proc3);
    });

    it('should return empty array when registry is empty', () => {
      const results = registry.getAll();

      expect(results).toEqual([]);
    });
  });

  describe('Size Property', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.size).toBe(0);
    });

    it('should return correct count after registrations', () => {
      registry.register(createProcessInfo({ id: 'proc-1' }));
      expect(registry.size).toBe(1);

      registry.register(createProcessInfo({ id: 'proc-2' }));
      expect(registry.size).toBe(2);

      registry.register(createProcessInfo({ id: 'proc-3' }));
      expect(registry.size).toBe(3);
    });

    it('should return correct count after unregistrations', () => {
      registry.register(createProcessInfo({ id: 'proc-1' }));
      registry.register(createProcessInfo({ id: 'proc-2' }));
      registry.register(createProcessInfo({ id: 'proc-3' }));

      registry.unregister('proc-2');
      expect(registry.size).toBe(2);

      registry.unregister('proc-1');
      expect(registry.size).toBe(1);

      registry.unregister('proc-3');
      expect(registry.size).toBe(0);
    });
  });

  describe('Clear', () => {
    it('should clear all processes', () => {
      registry.register(createProcessInfo({ id: 'proc-1', name: 'service-a' }));
      registry.register(createProcessInfo({ id: 'proc-2', name: 'service-b' }));

      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });

    it('should clear all indexes', () => {
      registry.register(createProcessInfo({ id: 'proc-1', name: 'service-a' }));
      registry.register(createProcessInfo({ id: 'proc-2', name: 'service-a' }));

      registry.clear();

      expect(registry.findByServiceName('service-a')).toBeUndefined();
      expect(registry.findAllByServiceName('service-a')).toEqual([]);
    });

    it('should allow re-registration after clear', () => {
      registry.register(createProcessInfo({ id: 'proc-1', name: 'service-a' }));
      registry.clear();

      const newProc = createProcessInfo({ id: 'proc-2', name: 'service-b' });
      registry.register(newProc);

      expect(registry.size).toBe(1);
      expect(registry.get('proc-2')).toEqual(newProc);
    });
  });

  describe('Edge Cases', () => {
    it('should handle process with all fields populated', () => {
      const processInfo: IProcessInfo = {
        id: 'full-process',
        name: 'full-service',
        pid: 54321,
        status: ProcessStatus.RUNNING,
        startTime: Date.now(),
        endTime: Date.now() + 1000,
        restartCount: 5,
        metrics: {
          cpu: 50,
          memory: 512,
          requests: 1000,
          errors: 10,
        },
        health: {
          status: 'healthy',
          checks: [{ name: 'test', status: 'pass' }],
          timestamp: Date.now(),
        },
        errors: [new Error('Previous error')],
      };

      registry.register(processInfo);

      expect(registry.get('full-process')).toEqual(processInfo);
    });

    it('should handle process with minimal fields', () => {
      const processInfo: IProcessInfo = {
        id: 'minimal-process',
        name: '',
        status: ProcessStatus.PENDING,
        startTime: 0,
        restartCount: 0,
      };

      registry.register(processInfo);

      expect(registry.get('minimal-process')).toEqual(processInfo);
    });

    it('should handle rapid register/unregister operations', () => {
      for (let i = 0; i < 100; i++) {
        const proc = createProcessInfo({ id: `proc-${i}`, name: `service-${i % 10}` });
        registry.register(proc);
      }

      expect(registry.size).toBe(100);

      for (let i = 0; i < 50; i++) {
        registry.unregister(`proc-${i}`);
      }

      expect(registry.size).toBe(50);
    });

    it('should handle concurrent-like operations', () => {
      const operations: Promise<void>[] = [];

      for (let i = 0; i < 50; i++) {
        operations.push(
          Promise.resolve().then(() => {
            const proc = createProcessInfo({ id: `proc-${i}`, name: 'concurrent-service' });
            registry.register(proc);
          })
        );
      }

      return Promise.all(operations).then(() => {
        expect(registry.size).toBe(50);
        expect(registry.findAllByServiceName('concurrent-service')).toHaveLength(50);
      });
    });
  });

  describe('Process Status Handling', () => {
    it('should register processes with any status', () => {
      const statuses = Object.values(ProcessStatus);

      statuses.forEach((status, index) => {
        const proc = createProcessInfo({ id: `proc-${index}`, status });
        registry.register(proc);
      });

      expect(registry.size).toBe(statuses.length);

      statuses.forEach((status, index) => {
        expect(registry.get(`proc-${index}`)?.status).toBe(status);
      });
    });

    it('should allow status updates via re-registration', () => {
      const proc = createProcessInfo({
        id: 'proc-1',
        name: 'service-a',
        status: ProcessStatus.STARTING,
      });

      registry.register(proc);
      expect(registry.get('proc-1')?.status).toBe(ProcessStatus.STARTING);

      registry.register({ ...proc, status: ProcessStatus.RUNNING });
      expect(registry.get('proc-1')?.status).toBe(ProcessStatus.RUNNING);

      registry.register({ ...proc, status: ProcessStatus.STOPPING });
      expect(registry.get('proc-1')?.status).toBe(ProcessStatus.STOPPING);

      registry.register({ ...proc, status: ProcessStatus.STOPPED });
      expect(registry.get('proc-1')?.status).toBe(ProcessStatus.STOPPED);
    });
  });
});
