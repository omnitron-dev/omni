/**
 * E2E Test: Deployment Workflow
 *
 * Simulates a realistic deployment workflow:
 * - Base configuration + environment-specific overrides
 * - Secret management
 * - Task execution with dependencies
 * - Target execution (local simulation)
 * - Success validation
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../../src/core/environment.js';
import { LocalSecretsProvider } from '../../src/secrets/providers/local.js';
import { z } from 'zod';

describe('E2E: Deployment Workflow', () => {
  const testDir = path.join(process.cwd(), 'test-data', 'e2e', 'deployment');
  const baseConfigPath = path.join(testDir, 'base.yaml');
  const prodConfigPath = path.join(testDir, 'production.yaml');

  beforeEach(async () => {
    // Clean up and create test directory
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

  it('should execute complete deployment workflow', async () => {
    // ============================================================
    // Phase 1: Create Base Configuration
    // ============================================================

    const schema = z.object({
      app: z.object({
        name: z.string(),
        version: z.string(),
        environment: z.string(),
      }),
      server: z.object({
        host: z.string(),
        port: z.number(),
        workers: z.number(),
      }),
      database: z.object({
        host: z.string(),
        port: z.number(),
        name: z.string(),
        poolSize: z.number(),
      }),
      features: z.object({
        metrics: z.boolean(),
        tracing: z.boolean(),
        debug: z.boolean(),
      }),
    });

    const baseEnv = Environment.create({
      name: 'base',
      version: '1.0.0',
      schema,
      config: {
        app: {
          name: 'MyApplication',
          version: '2.1.0',
          environment: 'development',
        },
        server: {
          host: '0.0.0.0',
          port: 3000,
          workers: 2,
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'myapp',
          poolSize: 10,
        },
        features: {
          metrics: false,
          tracing: false,
          debug: true,
        },
      },
    });

    await baseEnv.save(baseConfigPath);

    // ============================================================
    // Phase 2: Create Production Overrides
    // ============================================================

    const prodOverrides = Environment.create({
      name: 'production-overrides',
      schema,
      config: {
        app: {
          name: 'MyApplication',
          version: '2.1.0',
          environment: 'production',
        },
        server: {
          host: '0.0.0.0',
          port: 8080,
          workers: 8,
        },
        database: {
          host: 'prod-db.example.com',
          port: 5432,
          name: 'myapp_prod',
          poolSize: 50,
        },
        features: {
          metrics: true,
          tracing: true,
          debug: false,
        },
      },
    });

    await prodOverrides.save(prodConfigPath);

    // ============================================================
    // Phase 3: Merge Base + Production
    // ============================================================

    const base = await Environment.fromFile(baseConfigPath, { schema });
    const prod = await Environment.fromFile(prodConfigPath, { schema });

    const deployment = base.merge(prod);

    // Verify merged configuration
    expect(deployment.get('app.environment')).toBe('production');
    expect(deployment.get('server.workers')).toBe(8);
    expect(deployment.get('database.host')).toBe('prod-db.example.com');
    expect(deployment.get('database.poolSize')).toBe(50);
    expect(deployment.get('features.debug')).toBe(false);
    expect(deployment.get('features.metrics')).toBe(true);

    // ============================================================
    // Phase 4: Configure Secrets
    // ============================================================

    const secretsProvider = new LocalSecretsProvider({
      storagePath: path.join(testDir, '.secrets'),
      password: 'test-password-123',
    });
    (deployment as any).secrets = await import('../../src/secrets/secrets-layer.js').then(
      (m) => new m.SecretsLayer(secretsProvider)
    );

    await deployment.secrets!.set('database.password', 'prod-db-password-123');
    await deployment.secrets!.set('api.key', 'sk-prod-api-key-xyz');
    await deployment.secrets!.set('jwt.secret', 'jwt-signing-key-abc');
    await deployment.secrets!.set('encryption.key', 'aes-256-key-def');

    // Verify secrets
    const dbPassword = await deployment.secrets!.get('database.password');
    expect(dbPassword).toBe('prod-db-password-123');

    // ============================================================
    // Phase 5: Configure Variables
    // ============================================================

    deployment.variables.define('DEPLOY_TIME', new Date().toISOString());
    deployment.variables.define('GIT_COMMIT', 'abc123def456');
    deployment.variables.define('BUILD_NUMBER', '42');
    deployment.variables.define('DEPLOYER', 'ci-cd-bot');

    // Define database variables from config
    deployment.variables.define('DB_HOST', deployment.get('database.host'));
    deployment.variables.define('DB_PORT', deployment.get('database.port'));
    deployment.variables.define('DB_NAME', deployment.get('database.name'));

    // Template variables
    deployment.variables.define('DATABASE_URL', 'postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}');

    // Verify interpolation
    const dbUrl = deployment.variables.interpolate(deployment.variables.get('DATABASE_URL'));
    expect(dbUrl).toBe('postgresql://prod-db.example.com:5432/myapp_prod');

    // ============================================================
    // Phase 6: Define Deployment Tasks
    // ============================================================

    // Task execution tracking
    const executedTasks: string[] = [];

    deployment.tasks.define('validate-config', {
      command: 'echo "Validating configuration..."',
      description: 'Validate deployment configuration',
    });

    deployment.tasks.define('backup-database', {
      command: 'echo "Backing up database ${database.name}..."',
      description: 'Create database backup before deployment',
      dependsOn: ['validate-config'],
    });

    deployment.tasks.define('build-assets', {
      command: 'echo "Building production assets..."',
      description: 'Build and optimize assets',
      dependsOn: ['validate-config'],
    });

    deployment.tasks.define('run-migrations', {
      command: 'echo "Running database migrations..."',
      description: 'Apply database migrations',
      dependsOn: ['backup-database'],
    });

    deployment.tasks.define('deploy-app', {
      command: 'echo "Deploying ${app.name} v${app.version}..."',
      description: 'Deploy application',
      dependsOn: ['build-assets', 'run-migrations'],
    });

    deployment.tasks.define('smoke-test', {
      command: 'echo "Running smoke tests..."',
      description: 'Run post-deployment smoke tests',
      dependsOn: ['deploy-app'],
    });

    deployment.tasks.define('notify-team', {
      command: 'echo "Deployment completed! Build: ${BUILD_NUMBER}, Commit: ${GIT_COMMIT}"',
      description: 'Notify team of deployment status',
      dependsOn: ['smoke-test'],
    });

    // Verify task dependencies
    const deployDeps = deployment.tasks.getDependencies('deploy-app');
    expect(deployDeps).toEqual(['build-assets', 'run-migrations']);

    const notifyDeps = deployment.tasks.getDependencies('notify-team');
    expect(notifyDeps).toEqual(['smoke-test']);

    // Get execution order
    const executionOrder = deployment.tasks.getExecutionOrder([
      'validate-config',
      'backup-database',
      'build-assets',
      'run-migrations',
      'deploy-app',
      'smoke-test',
      'notify-team',
    ]);

    // Verify execution order respects dependencies
    expect(executionOrder.indexOf('validate-config')).toBeLessThan(executionOrder.indexOf('backup-database'));
    expect(executionOrder.indexOf('backup-database')).toBeLessThan(executionOrder.indexOf('run-migrations'));
    expect(executionOrder.indexOf('run-migrations')).toBeLessThan(executionOrder.indexOf('deploy-app'));
    expect(executionOrder.indexOf('deploy-app')).toBeLessThan(executionOrder.indexOf('smoke-test'));

    // ============================================================
    // Phase 7: Configure Targets
    // ============================================================

    deployment.targets.define('local', {
      type: 'local',
      description: 'Local execution for testing',
    });

    deployment.targets.define('prod-server-1', {
      type: 'ssh',
      host: 'prod-1.example.com',
      port: 22,
      username: 'deploy',
    });

    deployment.targets.define('prod-server-2', {
      type: 'ssh',
      host: 'prod-2.example.com',
      port: 22,
      username: 'deploy',
    });

    // ============================================================
    // Phase 8: Execute Deployment (Simulated)
    // ============================================================

    // Activate environment
    await deployment.activate();
    expect(deployment.isActive()).toBe(true);

    // Verify execution order was properly calculated
    const taskNames = [
      'validate-config',
      'backup-database',
      'build-assets',
      'run-migrations',
      'deploy-app',
      'smoke-test',
      'notify-team',
    ];

    expect(executionOrder.length).toBe(taskNames.length);
    expect(executionOrder).toContain('validate-config');
    expect(executionOrder).toContain('deploy-app');
    expect(executionOrder).toContain('notify-team');

    // Verify order dependencies
    expect(executionOrder.indexOf('validate-config')).toBeLessThan(executionOrder.indexOf('backup-database'));
    expect(executionOrder.indexOf('backup-database')).toBeLessThan(executionOrder.indexOf('run-migrations'));

    // ============================================================
    // Phase 9: Validate Deployment Success
    // ============================================================

    // Verify configuration is correct
    const validation = await deployment.validate();
    expect(validation.valid).toBe(true);

    // Verify all secrets are accessible
    const apiKey = await deployment.secrets!.get('api.key');
    expect(apiKey).toBe('sk-prod-api-key-xyz');

    // Verify variables are set
    expect(deployment.variables.get('BUILD_NUMBER')).toBe('42');
    expect(deployment.variables.get('GIT_COMMIT')).toBe('abc123def456');

    // Verify all tasks exist
    expect(deployment.tasks.has('validate-config')).toBe(true);
    expect(deployment.tasks.has('deploy-app')).toBe(true);
    expect(deployment.tasks.has('smoke-test')).toBe(true);

    // ============================================================
    // Phase 10: Save Deployment State
    // ============================================================

    const deploymentStatePath = path.join(testDir, 'deployment-state.yaml');
    await deployment.save(deploymentStatePath);

    expect(fs.existsSync(deploymentStatePath)).toBe(true);

    // Verify state can be reloaded
    const reloadedDeployment = await Environment.fromFile(deploymentStatePath, { schema });
    expect(reloadedDeployment.get('app.environment')).toBe('production');
    expect(reloadedDeployment.get('server.workers')).toBe(8);

    // ============================================================
    // Phase 11: Cleanup
    // ============================================================

    await deployment.deactivate();
    expect(deployment.isActive()).toBe(false);
  });

  it('should handle deployment rollback scenario', async () => {
    const schema = z.object({
      app: z.object({
        version: z.string(),
        deployed: z.boolean(),
      }),
    });

    // Create deployment environment
    const deployment = Environment.create({
      name: 'rollback-test',
      schema,
      config: {
        app: {
          version: '2.0.0',
          deployed: false,
        },
      },
    });

    // Save initial state
    const statePath = path.join(testDir, 'rollback-state.yaml');
    await deployment.save(statePath);

    // Simulate deployment
    deployment.set('app.deployed', true);
    deployment.set('app.version', '2.1.0');

    // Create backup before risky operation
    const backupPath = path.join(testDir, 'rollback-backup.yaml');
    await deployment.save(backupPath);

    // Simulate deployment failure - rollback to previous state
    const rolledBack = await Environment.fromFile(statePath, { schema });
    expect(rolledBack.get('app.version')).toBe('2.0.0');
    expect(rolledBack.get('app.deployed')).toBe(false);
  });

  it('should handle multi-stage deployment pipeline', async () => {
    const schema = z.object({
      stage: z.string(),
      deployed: z.boolean(),
    });

    // Create environments for each stage
    const stages = ['development', 'staging', 'production'];
    const environments: Environment<typeof schema>[] = [];

    for (const stage of stages) {
      const env = Environment.create({
        name: `${stage}-env`,
        schema,
        config: {
          stage,
          deployed: false,
        },
      });

      // Define stage-specific deployment task
      env.tasks.define('deploy', {
        command: `echo "Deploying to ${stage}..."`,
        description: `Deploy to ${stage} environment`,
      });

      environments.push(env);
    }

    // Execute pipeline: dev -> staging -> prod
    for (let i = 0; i < environments.length; i++) {
      const env = environments[i];
      const stage = stages[i];

      // Activate environment
      await env.activate();

      // Run deployment task
      const result = await env.tasks.run('deploy', { environment: env });
      expect(result.success).toBe(true);

      // Mark as deployed
      env.set('deployed', true);

      // Save state
      const stagePath = path.join(testDir, `${stage}.yaml`);
      await env.save(stagePath);

      // Deactivate
      await env.deactivate();

      // Verify deployment
      expect(env.get('deployed')).toBe(true);
    }

    // Verify all stages were deployed
    for (const stage of stages) {
      const stagePath = path.join(testDir, `${stage}.yaml`);
      const env = await Environment.fromFile(stagePath, { schema });
      expect(env.get('deployed')).toBe(true);
      expect(env.get('stage')).toBe(stage);
    }
  });

  it('should handle deployment with conditional tasks', async () => {
    const schema = z.object({
      skipTests: z.boolean(),
      runMigrations: z.boolean(),
    });

    const env = Environment.create({
      name: 'conditional-deploy',
      schema,
      config: {
        skipTests: false,
        runMigrations: true,
      },
    });

    env.tasks.define('test', {
      command: 'echo "Running tests..."',
      description: 'Run test suite',
    });

    env.tasks.define('migrate', {
      command: 'echo "Running migrations..."',
      description: 'Run database migrations',
    });

    env.tasks.define('deploy', {
      command: 'echo "Deploying application..."',
      description: 'Deploy application',
    });

    await env.activate();

    // Simulate conditional execution
    const tasksToRun: string[] = [];

    if (!env.get('skipTests')) {
      tasksToRun.push('test');
    }

    if (env.get('runMigrations')) {
      tasksToRun.push('migrate');
    }

    tasksToRun.push('deploy');

    // Execute tasks
    for (const taskName of tasksToRun) {
      const result = await env.tasks.run(taskName, { environment: env });
      expect(result.success).toBe(true);
    }

    expect(tasksToRun).toEqual(['test', 'migrate', 'deploy']);

    // Test with different conditions
    env.set('skipTests', true);
    env.set('runMigrations', false);

    const tasksToRun2: string[] = [];

    if (!env.get('skipTests')) {
      tasksToRun2.push('test');
    }

    if (env.get('runMigrations')) {
      tasksToRun2.push('migrate');
    }

    tasksToRun2.push('deploy');

    expect(tasksToRun2).toEqual(['deploy']);
  });
});
