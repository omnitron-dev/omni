import path from 'path';

import { TaskManager } from '../src';
import { syncTask, asyncTask, failingTask, delayedTask } from './fixtures/tasks';

describe('TaskManager', () => {
  let manager: TaskManager;

  beforeEach(() => {
    manager = new TaskManager({ timeout: 1000 });
  });

  // ✅ Test adding tasks
  it('adding a task and execution', async () => {
    manager.addTask(asyncTask);
    await expect(manager.runTask('asyncTask', 5, 10)).resolves.toBe(15);
  });

  // ✅ Test adding a synchronous task
  it('adding a synchronous task', async () => {
    manager.addTask(syncTask);
    await expect(manager.runTask('syncTask', 5, 10)).resolves.toBe(50);
  });

  // ✅ Test error handling in tasks
  it('handling error in a task', async () => {
    manager.addTask(failingTask);
    await expect(manager.runTask('failingTask')).rejects.toThrow('Intentional task failure');
  });

  // ✅ Test timeout
  it('task execution timeout', async () => {
    manager.addTask(delayedTask);
    await expect(manager.runTask('delayedTask', 5000)).rejects.toThrow(/timed out/i);
  });

  // ✅ Test task overwrite
  it('task overwrite with overwriteStrategy = replace', async () => {
    manager = new TaskManager({ overwriteStrategy: 'replace' });

    manager.addTask(asyncTask);
    manager.addTask(syncTask); // Overwrites the previous task

    await expect(manager.runTask('syncTask', 5, 10)).resolves.toBe(50);
  });

  // ✅ Test "skip" strategy
  it('do not overwrite tasks with overwriteStrategy = skip', async () => {
    manager = new TaskManager({ overwriteStrategy: 'skip' });

    const task1 = async function testTask() {
      return 'task1';
    };
    const task2 = async function testTask() {
      return 'task2';
    };

    manager.addTask(task1);
    manager.addTask(task2); // Skips adding because task1 with the same name already exists

    await expect(manager.runTask('testTask')).resolves.toBe('task1');
  });

  // ✅ Test "throw" strategy
  it('error on task duplication with overwriteStrategy = throw', async () => {
    manager = new TaskManager({ overwriteStrategy: 'throw' });

    manager.addTask(syncTask);
    expect(() => manager.addTask(syncTask)).toThrow(/Task already exists/);
  });

  // ✅ Test loading tasks from directory
  it('loading tasks from directory', async () => {
    await manager.loadTasksFromDir(path.join(__dirname, './fixtures/tasks'));
    await expect(manager.runTask('asyncTask', 5, 10)).resolves.toBe(15);
    await expect(manager.runTask('syncTask', 5, 10)).resolves.toBe(50);
    await expect(manager.runTask('failingTask')).rejects.toThrow('Intentional task failure');
    await expect(manager.runTask('delayedTask', 1500)).rejects.toThrow(/timed out/i);
  });

  // ✅ Test error if task not found
  it('calling a non-existent task', async () => {
    await expect(manager.runTask('unknownTask')).rejects.toThrow(/Task not found/i);
  });
});
