/**
 * TaskManager Unit Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskManager, DEFAULT_TASK_MANAGER_OPTIONS } from '../../src/core/task-manager.js';

describe('TaskManager', () => {
  let manager: TaskManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new TaskManager({ timeout: 1000 });
  });

  afterEach(() => {
    manager.clear();
    vi.useRealTimers();
  });

  describe('task registration', () => {
    it('should register a task', () => {
      function myTask() {
        return 'result';
      }
      manager.addTask(myTask);
      expect(manager.hasTask('myTask')).toBe(true);
    });

    it('should reject non-function tasks', () => {
      expect(() => manager.addTask('not a function' as any)).toThrow('Task must be a function');
    });

    it('should reject anonymous functions', () => {
      expect(() => manager.addTask(() => {})).toThrow('Task function must have a name');
    });

    it('should get task names', () => {
      function task1() {}
      function task2() {}
      manager.addTask(task1);
      manager.addTask(task2);

      const names = manager.getTaskNames();
      expect(names).toContain('task1');
      expect(names).toContain('task2');
    });

    it('should report size correctly', () => {
      expect(manager.size).toBe(0);
      function task1() {}
      manager.addTask(task1);
      expect(manager.size).toBe(1);
    });
  });

  describe('overwrite strategies', () => {
    it('should replace existing task with replace strategy', async () => {
      const replaceManager = new TaskManager({ overwriteStrategy: 'replace' });
      function replaceTask() {
        return 'first';
      }
      replaceManager.addTask(replaceTask);

      // Create a new function with the same name
      function replaceTask2() {
        return 'second';
      }
      // Rename function to have same name
      Object.defineProperty(replaceTask2, 'name', { value: 'replaceTask' });
      replaceManager.addTask(replaceTask2);

      expect(replaceManager.hasTask('replaceTask')).toBe(true);
      const result = await replaceManager.runTask('replaceTask');
      expect(result).toBe('second');
    });

    it('should skip existing task with skip strategy', async () => {
      const skipManager = new TaskManager({ overwriteStrategy: 'skip' });
      function skipTask() {
        return 'first';
      }
      skipManager.addTask(skipTask);

      function skipTask2() {
        return 'second';
      }
      Object.defineProperty(skipTask2, 'name', { value: 'skipTask' });
      skipManager.addTask(skipTask2); // Should silently skip

      expect(skipManager.size).toBe(1);
      const result = await skipManager.runTask('skipTask');
      expect(result).toBe('first'); // Original task is still there
    });

    it('should throw for existing task with throw strategy', () => {
      const throwManager = new TaskManager({ overwriteStrategy: 'throw' });
      function throwTask() {
        return 'first';
      }
      throwManager.addTask(throwTask);

      function throwTask2() {
        return 'second';
      }
      Object.defineProperty(throwTask2, 'name', { value: 'throwTask' });

      expect(() => throwManager.addTask(throwTask2)).toThrow();
    });
  });

  describe('task execution', () => {
    it('should execute sync task', async () => {
      function syncTask(a: number, b: number) {
        return a + b;
      }
      manager.addTask(syncTask);

      const result = await manager.runTask('syncTask', 2, 3);
      expect(result).toBe(5);
    });

    it('should execute async task', async () => {
      async function asyncTask(value: string) {
        return `result: ${value}`;
      }
      manager.addTask(asyncTask);

      const resultPromise = manager.runTask('asyncTask', 'test');
      vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toBe('result: test');
    });

    it('should throw for non-existent task', async () => {
      await expect(manager.runTask('nonexistent')).rejects.toThrow('not found');
    });

    it('should timeout long-running task', async () => {
      async function slowTask() {
        return new Promise((resolve) => setTimeout(resolve, 5000));
      }
      manager.addTask(slowTask);

      const resultPromise = manager.runTask('slowTask');
      vi.advanceTimersByTime(2000); // Past the 1000ms timeout

      await expect(resultPromise).rejects.toThrow();
    });

    it('should not timeout fast task', async () => {
      async function fastTask() {
        return new Promise((resolve) => setTimeout(() => resolve('done'), 100));
      }
      manager.addTask(fastTask);

      const resultPromise = manager.runTask('fastTask');
      vi.advanceTimersByTime(200);

      const result = await resultPromise;
      expect(result).toBe('done');
    });
  });

  describe('task removal', () => {
    it('should remove task', () => {
      function myTask() {}
      manager.addTask(myTask);
      expect(manager.hasTask('myTask')).toBe(true);

      const removed = manager.removeTask('myTask');
      expect(removed).toBe(true);
      expect(manager.hasTask('myTask')).toBe(false);
    });

    it('should return false when removing non-existent task', () => {
      const removed = manager.removeTask('nonexistent');
      expect(removed).toBe(false);
    });

    it('should clear all tasks', () => {
      function task1() {}
      function task2() {}
      manager.addTask(task1);
      manager.addTask(task2);

      manager.clear();
      expect(manager.size).toBe(0);
    });
  });

  describe('default options', () => {
    it('should have correct defaults', () => {
      expect(DEFAULT_TASK_MANAGER_OPTIONS.timeout).toBe(5000);
      expect(DEFAULT_TASK_MANAGER_OPTIONS.overwriteStrategy).toBe('replace');
    });
  });
});
