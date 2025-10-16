import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Environment } from '../../src/core/environment.js';
import { LocalSecretsProvider } from '../../src/secrets/providers/local.js';

describe('Layers Integration', () => {
  const testDir = path.join(process.cwd(), 'test-data', 'integration');
  const secretsPath = path.join(testDir, 'secrets.json');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should create environment with all layers', () => {
    const secretsProvider = new LocalSecretsProvider({
      storagePath: secretsPath,
      password: 'test-password'
    });

    const env = Environment.create({
      name: 'test-env',
      secretsProvider
    });

    expect(env).toBeDefined();
    expect(env.secrets).toBeDefined();
    expect(env.variables).toBeDefined();
    expect(env.tasks).toBeDefined();
    expect(env.targets).toBeDefined();
  });

  it('should use variables with tasks', async () => {
    const env = Environment.create({
      name: 'test-env'
    });

    // Define variables
    env.variables.define('message', 'Hello from variables');

    // Define task that uses variables
    env.tasks.define('greet', {
      command: 'echo "${message}"'
    });

    // Execute task
    const result = await env.tasks.run('greet');

    expect(result.success).toBe(true);
    expect(result.output).toContain('Hello from variables');
  });

  it('should use targets with tasks', async () => {
    const env = Environment.create({
      name: 'test-env'
    });

    // Define local target
    env.targets.define('local', {
      type: 'local'
    });

    // Define task
    env.tasks.define('list', {
      command: 'ls -la'
    });

    // Execute task on target
    const result = await env.targets.execute('local', 'echo "target test"');

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('target test');
  });

  it('should chain dependencies', async () => {
    const env = Environment.create({
      name: 'test-env'
    });

    // Define tasks with dependencies
    env.tasks.define('init', {
      command: 'echo "initializing"'
    });

    env.tasks.define('build', {
      command: 'echo "building"',
      dependsOn: ['init']
    });

    env.tasks.define('test', {
      command: 'echo "testing"',
      dependsOn: ['build']
    });

    // Get execution order
    const order = env.tasks.getExecutionOrder(['test']);

    expect(order).toEqual(['init', 'build', 'test']);

    // Execute with dependencies
    const result = await env.tasks.run('test');

    expect(result.success).toBe(true);
  });

  it('should use computed variables', () => {
    const env = Environment.create({
      name: 'test-env'
    });

    // Define base variables
    env.variables.define('firstName', 'John');
    env.variables.define('lastName', 'Doe');

    // Define computed variable
    env.variables.defineComputed('fullName', () => {
      return `${env.variables.get('firstName')} ${env.variables.get('lastName')}`;
    });

    const fullName = env.variables.get('fullName');
    expect(fullName).toBe('John Doe');
  });

  it('should find targets by pattern', async () => {
    const env = Environment.create({
      name: 'test-env'
    });

    // Define multiple targets
    env.targets.define('prod-web-1', { type: 'local' });
    env.targets.define('prod-web-2', { type: 'local' });
    env.targets.define('staging-web-1', { type: 'local' });

    // Find production targets
    const prodTargets = await env.targets.find('prod-.*');

    expect(prodTargets).toHaveLength(2);
    expect(prodTargets.every(t => t.name.startsWith('prod-'))).toBe(true);
  });

  it('should integrate config with variables', () => {
    const env = Environment.create({
      name: 'test-env',
      config: {
        app: {
          name: 'MyApp',
          version: '1.0.0'
        }
      }
    });

    // Copy config to variables
    env.variables.define('appName', env.get('app.name'));
    env.variables.define('appVersion', env.get('app.version'));

    // Use in interpolation
    const result = env.variables.interpolate('${appName} v${appVersion}');

    expect(result).toBe('MyApp v1.0.0');
  });

  it('should list all tasks with metadata', () => {
    const env = Environment.create({
      name: 'test-env'
    });

    env.tasks.define('task1', {
      command: 'echo "1"',
      description: 'First task'
    });

    env.tasks.define('task2', {
      command: 'echo "2"',
      description: 'Second task',
      dependsOn: ['task1']
    });

    const tasks = env.tasks.list();

    expect(tasks).toHaveLength(2);
    expect(tasks.find(t => t.name === 'task1')?.description).toBe('First task');
    expect(tasks.find(t => t.name === 'task2')?.dependencies).toContain('task1');
  });
});
