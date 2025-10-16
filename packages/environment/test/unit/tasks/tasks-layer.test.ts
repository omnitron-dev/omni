import { describe, it, expect } from 'vitest';
import { TasksLayer } from '../../../src/tasks/tasks-layer.js';
import { resolveDependencies } from '../../../src/tasks/dependency-resolver.js';

describe('TasksLayer', () => {
  it('should define and get tasks', () => {
    const layer = new TasksLayer();

    layer.define('hello', {
      command: 'echo "Hello World"',
      description: 'Print hello'
    });

    const task = layer.get('hello');
    expect(task).toBeDefined();
    expect(task?.config.command).toBe('echo "Hello World"');
  });

  it('should check if task exists', () => {
    const layer = new TasksLayer();

    layer.define('existing', { command: 'ls' });

    expect(layer.has('existing')).toBe(true);
    expect(layer.has('nonexistent')).toBe(false);
  });

  it('should delete tasks', () => {
    const layer = new TasksLayer();

    layer.define('temp', { command: 'pwd' });
    expect(layer.has('temp')).toBe(true);

    layer.delete('temp');
    expect(layer.has('temp')).toBe(false);
  });

  it('should run a simple task', async () => {
    const layer = new TasksLayer();

    layer.define('test', {
      command: 'echo "test output"'
    });

    const result = await layer.run('test');

    expect(result.success).toBe(true);
    expect(result.output).toContain('test output');
  });

  it('should get task dependencies', () => {
    const layer = new TasksLayer();

    layer.define('dep1', { command: 'echo "dep1"' });
    layer.define('dep2', { command: 'echo "dep2"' });
    layer.define('main', {
      command: 'echo "main"',
      dependsOn: ['dep1', 'dep2']
    });

    const deps = layer.getDependencies('main');

    expect(deps).toContain('dep1');
    expect(deps).toContain('dep2');
  });

  it('should get execution order', () => {
    const layer = new TasksLayer();

    layer.define('a', { command: 'echo "a"' });
    layer.define('b', { command: 'echo "b"', dependsOn: ['a'] });
    layer.define('c', { command: 'echo "c"', dependsOn: ['b'] });

    const order = layer.getExecutionOrder(['c']);

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('should list all tasks', () => {
    const layer = new TasksLayer();

    layer.define('task1', { command: 'echo "1"', description: 'Task 1' });
    layer.define('task2', { command: 'echo "2"', description: 'Task 2' });

    const list = layer.list();

    expect(list).toHaveLength(2);
    expect(list.some(t => t.name === 'task1')).toBe(true);
    expect(list.some(t => t.name === 'task2')).toBe(true);
  });

  it('should explain task execution order', () => {
    const layer = new TasksLayer();

    layer.define('build', { command: 'npm run build' });
    layer.define('test', { command: 'npm test', dependsOn: ['build'] });

    const explanation = layer.explain('test');

    // The explanation is an array of strings
    const explanationText = explanation.join('\n');
    expect(explanationText).toContain('build');
    expect(explanationText).toContain('test');
  });

  describe('dependency resolver', () => {
    it('should resolve dependencies in correct order', () => {
      const graph = {
        a: [],
        b: ['a'],
        c: ['a', 'b'],
        d: ['c']
      };

      const order = resolveDependencies(graph);

      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    });

    it('should throw on circular dependencies', () => {
      const graph = {
        a: ['b'],
        b: ['c'],
        c: ['a']
      };

      expect(() => resolveDependencies(graph)).toThrow(/circular dependency/i);
    });
  });
});
