/**
 * E2E Test: Environment Lifecycle
 *
 * Tests the complete lifecycle of an environment from creation to cleanup:
 * - Creating from scratch
 * - Configuring all layers (config, secrets, variables, tasks, targets)
 * - Saving to disk
 * - Loading from disk
 * - Validating integrity
 * - Cleanup
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../../src/core/environment.js';
import { LocalSecretsProvider } from '../../src/secrets/providers/local.js';
import { z } from 'zod';

describe('E2E: Environment Lifecycle', () => {
  const testDir = path.join(process.cwd(), 'test-data', 'e2e', 'lifecycle');
  const envPath = path.join(testDir, 'test-env.yaml');

  beforeEach(async () => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after tests
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should complete full environment lifecycle', async () => {
    // ============================================================
    // Phase 1: Create environment from scratch
    // ============================================================

    const schema = z.object({
      app: z.object({
        name: z.string(),
        version: z.string(),
        port: z.number().min(1).max(65535)
      }),
      database: z.object({
        host: z.string(),
        port: z.number(),
        name: z.string(),
        ssl: z.boolean().optional()
      }),
      features: z.object({
        auth: z.boolean(),
        logging: z.boolean()
      }).optional()
    });

    const env = Environment.create({
      name: 'test-production',
      version: '1.0.0',
      schema,
      config: {
        app: {
          name: 'TestApp',
          version: '1.0.0',
          port: 3000
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'testdb',
          ssl: true
        },
        features: {
          auth: true,
          logging: true
        }
      },
      secretsProvider: new LocalSecretsProvider({
        storagePath: path.join(testDir, '.secrets'),
        password: 'test-password-123'
      })
    });

    // Verify initial state
    expect(env.name).toBe('test-production');
    expect(env.version).toBe('1.0.0');
    expect(env.get('app.name')).toBe('TestApp');
    expect(env.get('database.port')).toBe(5432);
    expect(env.isActive()).toBe(false);

    // ============================================================
    // Phase 2: Configure Secrets Layer
    // ============================================================

    await env.secrets!.set('database.password', 'super-secret-password');
    await env.secrets!.set('api.key', 'test-api-key-12345');
    await env.secrets!.set('jwt.secret', 'jwt-signing-secret');

    // Verify secrets are stored
    const dbPassword = await env.secrets!.get('database.password');
    expect(dbPassword).toBe('super-secret-password');

    const allSecrets = await env.secrets!.getAll();
    expect(Object.keys(allSecrets)).toHaveLength(3);

    // ============================================================
    // Phase 3: Configure Variables Layer
    // ============================================================

    env.variables.define('ENV', 'production');
    env.variables.define('VERSION', '1.0.0');
    env.variables.define('BUILD_TIME', Date.now().toString());
    env.variables.define('DB_HOST', env.get('database.host'));
    env.variables.define('DB_PORT', env.get('database.port'));
    env.variables.define('DB_NAME', env.get('database.name'));
    env.variables.define('DB_URL', 'postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}');

    // Verify variables
    expect(env.variables.get('ENV')).toBe('production');
    expect(env.variables.get('VERSION')).toBe('1.0.0');

    // Test interpolation
    const dbUrl = env.variables.interpolate(env.variables.get('DB_URL'));
    expect(dbUrl).toBe('postgresql://localhost:5432/testdb');

    // ============================================================
    // Phase 4: Configure Tasks Layer
    // ============================================================

    env.tasks.define('build', {
      command: 'npm run build',
      description: 'Build the application',
      workdir: '/app'
    });

    env.tasks.define('test', {
      command: 'npm test',
      description: 'Run tests',
      workdir: '/app'
    });

    env.tasks.define('deploy', {
      command: 'echo "Deploying ${app.name} v${app.version}"',
      description: 'Deploy application',
      dependsOn: ['build', 'test']
    });

    // Verify tasks are defined
    expect(env.tasks.has('build')).toBe(true);
    expect(env.tasks.has('test')).toBe(true);
    expect(env.tasks.has('deploy')).toBe(true);

    const deployTask = env.tasks.get('deploy');
    expect(deployTask).toBeDefined();

    // ============================================================
    // Phase 5: Configure Targets Layer
    // ============================================================

    env.targets.define('local', {
      type: 'local',
      description: 'Local execution'
    });

    env.targets.define('staging', {
      type: 'ssh',
      host: 'staging.example.com',
      port: 22,
      username: 'deploy'
    });

    // Verify targets
    expect(env.targets.has('local')).toBe(true);
    expect(env.targets.has('staging')).toBe(true);

    // ============================================================
    // Phase 6: Save to Disk
    // ============================================================

    await env.save(envPath);

    // Verify file was created
    expect(fs.existsSync(envPath)).toBe(true);

    const fileContent = fs.readFileSync(envPath, 'utf-8');
    expect(fileContent).toContain('test-production');
    expect(fileContent).toContain('TestApp');

    // Verify metadata was updated
    expect(env.metadata.sourcePath).toBe(envPath);
    expect(env.metadata.source).toBe('file');

    // ============================================================
    // Phase 7: Load from Disk
    // ============================================================

    const loadedEnv = await Environment.fromFile(envPath, {
      schema,
      secretsProvider: new LocalSecretsProvider({
        storagePath: path.join(testDir, '.secrets'),
        password: 'test-password-123'
      })
    });

    // Verify loaded environment matches original
    expect(loadedEnv.name).toBe('test-production');
    expect(loadedEnv.version).toBe('1.0.0');
    expect(loadedEnv.get('app.name')).toBe('TestApp');
    expect(loadedEnv.get('app.port')).toBe(3000);
    expect(loadedEnv.get('database.host')).toBe('localhost');
    expect(loadedEnv.get('database.port')).toBe(5432);
    expect(loadedEnv.get('features.auth')).toBe(true);

    // ============================================================
    // Phase 8: Validate Integrity
    // ============================================================

    // Validate configuration
    const validation = await loadedEnv.validate();
    expect(validation.valid).toBe(true);
    expect(validation.errors).toBeUndefined();

    // Verify checksum
    expect(loadedEnv.metadata.checksum).toBeDefined();
    expect(loadedEnv.metadata.checksum).toBe(env.metadata.checksum);

    // ============================================================
    // Phase 9: Activate Environment
    // ============================================================

    await loadedEnv.activate();
    expect(loadedEnv.isActive()).toBe(true);

    // Verify secrets are accessible after loading
    const loadedPassword = await loadedEnv.secrets!.get('database.password');
    expect(loadedPassword).toBe('super-secret-password');

    // ============================================================
    // Phase 10: Make Changes and Verify
    // ============================================================

    const changeCount = loadedEnv.metadata.changeCount;
    loadedEnv.set('app.port', 4000);

    expect(loadedEnv.get('app.port')).toBe(4000);
    expect(loadedEnv.metadata.changeCount).toBe(changeCount + 1);

    // Save changes
    await loadedEnv.save();

    // Reload and verify
    const reloadedEnv = await Environment.fromFile(envPath, { schema });
    expect(reloadedEnv.get('app.port')).toBe(4000);

    // ============================================================
    // Phase 11: Deactivate and Cleanup
    // ============================================================

    await loadedEnv.deactivate();
    expect(loadedEnv.isActive()).toBe(false);

    // Clean up files
    fs.unlinkSync(envPath);
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('should handle environment cloning', async () => {
    const schema = z.object({
      service: z.string(),
      port: z.number()
    });

    const original = Environment.create({
      name: 'original',
      schema,
      config: {
        service: 'api',
        port: 3000
      }
    });

    // Clone environment
    const cloned = original.clone();

    expect(cloned.name).toBe('original-clone');
    expect(cloned.get('service')).toBe('api');
    expect(cloned.get('port')).toBe(3000);

    // Verify independence
    cloned.set('port', 4000);
    expect(cloned.get('port')).toBe(4000);
    expect(original.get('port')).toBe(3000);
  });

  it('should handle validation failures gracefully', async () => {
    const schema = z.object({
      port: z.number().min(1).max(65535)
    });

    const env = Environment.create({
      name: 'invalid',
      schema,
      config: {
        port: 999999 // Invalid port
      }
    });

    // Validation should fail
    const validation = await env.validate();
    expect(validation.valid).toBe(false);
    expect(validation.errors).toBeDefined();
    expect(validation.errors!.length).toBeGreaterThan(0);

    // Activation should fail
    await expect(env.activate()).rejects.toThrow();
  });

  it('should persist and restore metadata correctly', async () => {
    const schema = z.object({
      value: z.string()
    });

    const env = Environment.create({
      name: 'metadata-test',
      schema,
      config: { value: 'test' },
      metadata: {
        description: 'Test environment',
        tags: ['test', 'e2e'],
        labels: { team: 'platform', env: 'test' }
      }
    });

    // Save with metadata
    await env.save(envPath);

    // Load and verify metadata
    const loaded = await Environment.fromFile(envPath, { schema });

    expect(loaded.metadata.description).toBe('Test environment');
    expect(loaded.metadata.tags).toEqual(['test', 'e2e']);
    expect(loaded.metadata.labels.team).toBe('platform');
    expect(loaded.metadata.labels.env).toBe('test');
  });

  it('should handle change callbacks', async () => {
    const schema = z.object({
      counter: z.number()
    });

    const env = Environment.create({
      name: 'callback-test',
      schema,
      config: { counter: 0 }
    });

    let callbackCount = 0;
    let lastValue: any;
    let lastOldValue: any;

    // Register callback
    const disposable = env.onChange('counter', (newValue, oldValue) => {
      callbackCount++;
      lastValue = newValue;
      lastOldValue = oldValue;
    });

    // Trigger changes
    env.set('counter', 1);
    expect(callbackCount).toBe(1);
    expect(lastValue).toBe(1);
    expect(lastOldValue).toBe(0);

    env.set('counter', 2);
    expect(callbackCount).toBe(2);
    expect(lastValue).toBe(2);
    expect(lastOldValue).toBe(1);

    // Dispose and verify no more callbacks
    disposable.dispose();
    env.set('counter', 3);
    expect(callbackCount).toBe(2); // Should still be 2
  });
});
