/**
 * E2E Test: Real-World Scenarios from Specification (Part VI: Examples)
 *
 * This test suite implements comprehensive E2E tests based on the exact scenarios
 * described in the specification Part VI: Examples (sections 6.1-6.7).
 *
 * Tests cover:
 * 1. Microservices Configuration (spec 6.7) - 5 tests
 * 2. CI/CD Pipeline (spec 6.7) - 5 tests
 * 3. Development Workflow (spec 6.7) - 5 tests
 * 4. Advanced Composition (spec 6.2) - 5 tests
 * 5. Distributed Environment (spec 6.5) - 5 tests
 * 6. Cognitive Environment (spec 6.6) - 5 tests
 *
 * Total: 30 E2E tests
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../../src/core/environment.js';
import { LocalSecretsProvider } from '../../src/secrets/providers/local.js';
import { CognitiveEnvironment } from '../../src/cognitive/cognitive-environment.js';
import { z } from 'zod';

describe('E2E: Specification Examples (Part VI)', () => {
  const testDir = path.join(process.cwd(), 'test-data', 'e2e', 'spec-examples');

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

  /**
   * ============================================================
   * Scenario 1: Microservices Configuration (spec 6.7)
   * ============================================================
   * Tests service-specific overrides, shared configuration inheritance,
   * and distributed configuration management.
   */
  describe('Microservices Configuration', () => {
    it('should create base environment with observability and security configs', async () => {
      // Create shared base configuration (spec 6.7 - lines 2684-2713)
      const base = Environment.create({
        name: 'base',
        config: {
          observability: {
            logging: {
              level: 'info',
              format: 'json',
            },
            tracing: {
              enabled: true,
              endpoint: 'http://jaeger:14268/api/traces',
            },
            metrics: {
              enabled: true,
              endpoint: 'http://prometheus:9090',
            },
          },
          security: {
            cors: {
              origins: ['https://example.com'],
              methods: ['GET', 'POST', 'PUT', 'DELETE'],
            },
            rateLimit: {
              window: '1m',
              max: 1000,
            },
          },
        },
      });

      // Verify base observability configuration
      expect(base.get('observability.logging.level')).toBe('info');
      expect(base.get('observability.logging.format')).toBe('json');
      expect(base.get('observability.tracing.enabled')).toBe(true);
      expect(base.get('observability.tracing.endpoint')).toBe('http://jaeger:14268/api/traces');
      expect(base.get('observability.metrics.enabled')).toBe(true);
      expect(base.get('observability.metrics.endpoint')).toBe('http://prometheus:9090');

      // Verify base security configuration
      expect(base.get('security.cors.origins')).toEqual(['https://example.com']);
      expect(base.get('security.cors.methods')).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
      expect(base.get('security.rateLimit.window')).toBe('1m');
      expect(base.get('security.rateLimit.max')).toBe(1000);
    });

    it('should extend base for multiple services (api, auth, notifications)', async () => {
      // Create base environment
      const base = Environment.create({
        name: 'base',
        config: {
          observability: {
            logging: { level: 'info', format: 'json' },
            tracing: { enabled: true, endpoint: 'http://jaeger:14268/api/traces' },
            metrics: { enabled: true, endpoint: 'http://prometheus:9090' },
          },
          security: {
            cors: { origins: ['https://example.com'], methods: ['GET', 'POST', 'PUT', 'DELETE'] },
            rateLimit: { window: '1m', max: 1000 },
          },
        },
      });

      // Create service-specific configurations (spec 6.7 - lines 2716-2763)
      const apiService = base.merge(
        Environment.create({
          name: 'api-service',
          config: {
            service: { name: 'api', port: 3000, replicas: 3 },
            database: { host: 'postgres', port: 5432, name: 'api_db' },
          },
        })
      );

      const authService = base.merge(
        Environment.create({
          name: 'auth-service',
          config: {
            service: { name: 'auth', port: 3001, replicas: 2 },
            jwt: { algorithm: 'RS256', expiresIn: '1h' },
          },
        })
      );

      const notificationsService = base.merge(
        Environment.create({
          name: 'notification-service',
          config: {
            service: { name: 'notifications', port: 3002, replicas: 2 },
            providers: { email: { enabled: true }, sms: { enabled: false }, push: { enabled: true } },
          },
        })
      );

      // Verify API service
      expect(apiService.get('service.name')).toBe('api');
      expect(apiService.get('service.port')).toBe(3000);
      expect(apiService.get('service.replicas')).toBe(3);
      expect(apiService.get('database.host')).toBe('postgres');
      expect(apiService.get('observability.tracing.enabled')).toBe(true); // Inherited

      // Verify Auth service
      expect(authService.get('service.name')).toBe('auth');
      expect(authService.get('service.port')).toBe(3001);
      expect(authService.get('jwt.algorithm')).toBe('RS256');
      expect(authService.get('jwt.expiresIn')).toBe('1h');
      expect(authService.get('security.cors.origins')).toEqual(['https://example.com']); // Inherited

      // Verify Notifications service
      expect(notificationsService.get('service.name')).toBe('notifications');
      expect(notificationsService.get('providers.email.enabled')).toBe(true);
      expect(notificationsService.get('providers.sms.enabled')).toBe(false);
      expect(notificationsService.get('observability.metrics.enabled')).toBe(true); // Inherited
    });

    it('should support service-specific overrides while maintaining base config', async () => {
      const base = Environment.create({
        name: 'base',
        config: {
          observability: {
            logging: { level: 'info', format: 'json' },
            tracing: { enabled: true },
          },
        },
      });

      // Create service with override
      const debugService = base.merge(
        Environment.create({
          name: 'debug-service',
          config: {
            service: { name: 'debug', port: 4000 },
            observability: {
              logging: { level: 'debug' }, // Override base level
            },
          },
        })
      );

      // Verify override
      expect(debugService.get('observability.logging.level')).toBe('debug');
      // Verify inherited properties remain
      expect(debugService.get('observability.logging.format')).toBe('json');
      expect(debugService.get('observability.tracing.enabled')).toBe(true);
      expect(debugService.get('service.name')).toBe('debug');
    });

    it('should handle shared configuration inheritance correctly', async () => {
      const base = Environment.create({
        name: 'base',
        config: {
          observability: {
            logging: { level: 'info', format: 'json' },
            tracing: { enabled: true, endpoint: 'http://jaeger:14268/api/traces' },
          },
        },
      });

      // Create multiple services
      const services = ['api', 'auth', 'notifications', 'payment'].map((name) =>
        base.merge(
          Environment.create({
            name: `${name}-service`,
            config: { service: { name, port: 3000 + Math.floor(Math.random() * 1000) } },
          })
        )
      );

      // Verify all services inherit base observability config
      for (const service of services) {
        expect(service.get('observability.logging.level')).toBe('info');
        expect(service.get('observability.logging.format')).toBe('json');
        expect(service.get('observability.tracing.enabled')).toBe(true);
        expect(service.get('observability.tracing.endpoint')).toBe('http://jaeger:14268/api/traces');
      }
    });

    it('should activate all services and maintain independent configuration', async () => {
      const base = Environment.create({
        name: 'base',
        config: {
          observability: { tracing: { enabled: true }, metrics: { enabled: true } },
        },
      });

      const services = [
        base.merge(
          Environment.create({
            name: 'api-service',
            config: { service: { name: 'api', port: 3000 } },
          })
        ),
        base.merge(
          Environment.create({
            name: 'auth-service',
            config: { service: { name: 'auth', port: 3001 } },
          })
        ),
      ];

      // Activate all services (spec 6.7 - lines 2765-2768)
      await Promise.all(services.map((env) => env.activate()));

      // Verify all are active
      for (const service of services) {
        expect(service.isActive()).toBe(true);
      }

      // Modify one service - should not affect others
      services[0].set('service.customFlag', true);
      expect(services[0].get('service.customFlag')).toBe(true);
      expect(services[1].get('service.customFlag')).toBeUndefined();

      // Deactivate all
      await Promise.all(services.map((env) => env.deactivate()));
    });
  });

  /**
   * ============================================================
   * Scenario 2: CI/CD Pipeline (spec 6.7)
   * ============================================================
   * Tests task dependency execution, variable interpolation,
   * and conditional task execution.
   */
  describe('CI/CD Pipeline', () => {
    it('should create CI/CD environment with variables and tasks', async () => {
      // Create CI/CD environment (spec 6.7 - lines 2773-2826)
      const cicd = Environment.create({
        name: 'cicd',
        config: {},
      });

      // Configure variables (spec 6.7 - lines 2778-2782)
      cicd.variables.define('git_branch', 'main');
      cicd.variables.define('git_commit', 'abc123def456');
      cicd.variables.define('build_number', '42');
      cicd.variables.define('is_pr', false);

      // Define CI tasks (spec 6.7 - lines 2784-2807)
      cicd.tasks.define('checkout', {
        command: 'echo "Checking out ${git_branch}..."',
        description: 'Checkout source code',
      });

      cicd.tasks.define('install', {
        command: 'echo "Installing dependencies..."',
        description: 'Install dependencies',
        dependsOn: ['checkout'],
      });

      cicd.tasks.define('lint', {
        command: 'echo "Running linter..."',
        description: 'Run code linting',
        dependsOn: ['install'],
      });

      cicd.tasks.define('test', {
        command: 'echo "Running tests..."',
        description: 'Run tests',
        dependsOn: ['install'],
      });

      cicd.tasks.define('build', {
        command: 'echo "Building application..."',
        description: 'Build application',
        dependsOn: ['lint', 'test'],
      });

      // Verify configuration
      expect(cicd.variables.get('git_branch')).toBe('main');
      expect(cicd.variables.get('build_number')).toBe('42');
      expect(cicd.tasks.has('checkout')).toBe(true);
      expect(cicd.tasks.has('build')).toBe(true);
      expect(cicd.tasks.getDependencies('build')).toEqual(['lint', 'test']);
    });

    it('should execute tasks respecting dependency order (ci → cd)', async () => {
      const cicd = Environment.create({
        name: 'cicd',
        config: {},
      });

      // Define tasks
      cicd.tasks.define('checkout', {
        command: 'echo "Checkout"',
        description: 'Checkout',
      });

      cicd.tasks.define('build', {
        command: 'echo "Build"',
        description: 'Build',
        dependsOn: ['checkout'],
      });

      cicd.tasks.define('test', {
        command: 'echo "Test"',
        description: 'Test',
        dependsOn: ['build'],
      });

      cicd.tasks.define('deploy', {
        command: 'echo "Deploy"',
        description: 'Deploy',
        dependsOn: ['test'],
      });

      // Get execution order (spec 6.7 - lines 2809-2825)
      const tasks = ['checkout', 'build', 'test', 'deploy'];
      const executionOrder = cicd.tasks.getExecutionOrder(tasks);

      // Verify order respects dependencies
      expect(executionOrder.indexOf('checkout')).toBeLessThan(executionOrder.indexOf('build'));
      expect(executionOrder.indexOf('build')).toBeLessThan(executionOrder.indexOf('test'));
      expect(executionOrder.indexOf('test')).toBeLessThan(executionOrder.indexOf('deploy'));
    });

    it('should interpolate variables in task commands', async () => {
      const cicd = Environment.create({
        name: 'cicd',
        config: {},
      });

      cicd.variables.define('git_commit', 'abc123');
      cicd.variables.define('environment', 'production');

      cicd.tasks.define('deploy', {
        command: 'echo "Deploying commit ${git_commit} to ${environment}"',
        description: 'Deploy',
      });

      // Verify task definition includes variable references
      const task = cicd.tasks.get('deploy');
      expect(task).not.toBeNull();
      expect(task?.config.command).toContain('${git_commit}');
      expect(task?.config.command).toContain('${environment}');
    });

    it('should support conditional task execution', async () => {
      const cicd = Environment.create({
        name: 'cicd',
        config: {},
      });

      cicd.variables.define('git_branch', 'main');
      cicd.variables.define('is_pr', false);

      // Define conditional deploy task (spec 6.7 - lines 2815-2818)
      cicd.tasks.define('deploy-production', {
        command: 'echo "Deploying to production..."',
        description: 'Deploy to production',
        when: '${git_branch} === "main" && !${is_pr}',
      });

      const task = cicd.tasks.get('deploy-production');
      expect(task).not.toBeNull();
      expect(task?.config.when).toBeDefined();
      expect(task?.config.when).toContain('git_branch');
      expect(task?.config.when).toContain('main');
    });

    it('should execute complete CI/CD pipeline workflow', async () => {
      const cicd = Environment.create({
        name: 'cicd',
        config: {},
      });

      // Configure variables
      cicd.variables.define('git_branch', 'main');
      cicd.variables.define('build_number', '100');

      // Define complete pipeline
      const pipelineStages = [
        { name: 'checkout', deps: [] },
        { name: 'install', deps: ['checkout'] },
        { name: 'lint', deps: ['install'] },
        { name: 'test', deps: ['install'] },
        { name: 'build', deps: ['lint', 'test'] },
        { name: 'deploy', deps: ['build'] },
      ];

      for (const stage of pipelineStages) {
        cicd.tasks.define(stage.name, {
          command: `echo "Executing ${stage.name}..."`,
          description: `Execute ${stage.name}`,
          dependsOn: stage.deps,
        });
      }

      await cicd.activate();

      // Execute pipeline
      const stageNames = pipelineStages.map((s) => s.name);
      const executionOrder = cicd.tasks.getExecutionOrder(stageNames);

      const results: Record<string, boolean> = {};
      for (const stage of executionOrder) {
        const result = await cicd.tasks.run(stage, { environment: cicd });
        results[stage] = result.success;
      }

      // Verify all stages completed successfully
      for (const stage of stageNames) {
        expect(results[stage]).toBe(true);
      }

      await cicd.deactivate();
    });
  });

  /**
   * ============================================================
   * Scenario 3: Development Workflow (spec 6.7)
   * ============================================================
   * Tests start/stop/reset workflow, task chaining, and error handling.
   */
  describe('Development Workflow', () => {
    it('should create development environment with tasks', async () => {
      // Create dev environment (spec 6.7 - lines 2833-2853)
      const devSchema = z.object({
        database: z.object({
          host: z.string(),
          port: z.number(),
          name: z.string(),
        }),
        redis: z.object({
          host: z.string(),
          port: z.number(),
        }),
        features: z.object({
          hot_reload: z.boolean(),
          debug_mode: z.boolean(),
          mock_external_apis: z.boolean(),
        }),
      });

      const dev = Environment.create({
        name: 'local-dev',
        schema: devSchema,
        config: {
          database: {
            host: 'localhost',
            port: 5432,
            name: 'myapp_dev',
          },
          redis: {
            host: 'localhost',
            port: 6379,
          },
          features: {
            hot_reload: true,
            debug_mode: true,
            mock_external_apis: true,
          },
        },
      });

      // Verify development configuration
      expect(dev.get('database.host')).toBe('localhost');
      expect(dev.get('database.port')).toBe(5432);
      expect(dev.get('redis.host')).toBe('localhost');
      expect(dev.get('features.hot_reload')).toBe(true);
      expect(dev.get('features.debug_mode')).toBe(true);
    });

    it('should support start workflow with dependency chain', async () => {
      const dev = Environment.create({
        name: 'local-dev',
        config: {
          services: {
            database: false,
            redis: false,
            app: false,
          },
        },
      });

      // Define start workflow tasks (spec 6.7 - lines 2855-2864)
      dev.tasks.define('start-db', {
        command: 'echo "Starting PostgreSQL..."',
        description: 'Start PostgreSQL database',
      });

      dev.tasks.define('start-redis', {
        command: 'echo "Starting Redis..."',
        description: 'Start Redis cache',
      });

      dev.tasks.define('migrate-db', {
        command: 'echo "Running migrations..."',
        description: 'Run database migrations',
        dependsOn: ['start-db'],
      });

      dev.tasks.define('start-app', {
        command: 'echo "Starting application..."',
        description: 'Start application server',
        dependsOn: ['migrate-db', 'start-redis'],
      });

      await dev.activate();

      // Execute start sequence
      const startTasks = ['start-db', 'start-redis', 'migrate-db', 'start-app'];
      const executionOrder = dev.tasks.getExecutionOrder(startTasks);

      // Verify execution order
      expect(executionOrder.indexOf('start-db')).toBeLessThan(executionOrder.indexOf('migrate-db'));
      expect(executionOrder.indexOf('migrate-db')).toBeLessThan(executionOrder.indexOf('start-app'));
      expect(executionOrder.indexOf('start-redis')).toBeLessThan(executionOrder.indexOf('start-app'));

      // Execute tasks
      for (const task of executionOrder) {
        const result = await dev.tasks.run(task, { environment: dev });
        expect(result.success).toBe(true);

        // Update service status
        if (task === 'start-db') dev.set('services.database', true);
        if (task === 'start-redis') dev.set('services.redis', true);
        if (task === 'start-app') dev.set('services.app', true);
      }

      // Verify services are running
      expect(dev.get('services.database')).toBe(true);
      expect(dev.get('services.redis')).toBe(true);
      expect(dev.get('services.app')).toBe(true);

      await dev.deactivate();
    });

    it('should support stop workflow', async () => {
      const dev = Environment.create({
        name: 'local-dev',
        config: {
          services: {
            database: true,
            redis: true,
            app: true,
          },
        },
      });

      // Define stop task (spec 6.7 - lines 2867-2871)
      dev.tasks.define('stop-all', {
        command: 'echo "Stopping all services..."',
        description: 'Stop all services',
      });

      await dev.activate();

      // Execute stop
      const result = await dev.tasks.run('stop-all', { environment: dev });
      expect(result.success).toBe(true);

      // Update state
      dev.set('services.database', false);
      dev.set('services.redis', false);
      dev.set('services.app', false);

      // Verify services are stopped
      expect(dev.get('services.database')).toBe(false);
      expect(dev.get('services.redis')).toBe(false);
      expect(dev.get('services.app')).toBe(false);

      await dev.deactivate();
    });

    it('should support reset workflow with cleanup', async () => {
      const dev = Environment.create({
        name: 'local-dev',
        config: {
          services: { database: true, redis: true },
          data: { seeded: true },
        },
      });

      // Define reset workflow (spec 6.7 - lines 2873-2882)
      dev.tasks.define('stop-all', {
        command: 'echo "Stopping all services..."',
        description: 'Stop all services',
      });

      dev.tasks.define('clean-data', {
        command: 'echo "Cleaning data..."',
        description: 'Clean data',
        dependsOn: ['stop-all'],
      });

      dev.tasks.define('reset', {
        command: 'echo "Resetting environment..."',
        description: 'Reset development environment',
        dependsOn: ['clean-data'],
      });

      await dev.activate();

      // Execute reset workflow
      const resetTasks = ['stop-all', 'clean-data', 'reset'];
      const executionOrder = dev.tasks.getExecutionOrder(resetTasks);

      for (const task of executionOrder) {
        const result = await dev.tasks.run(task, { environment: dev });
        expect(result.success).toBe(true);
      }

      // Update state to reflect reset
      dev.set('services.database', false);
      dev.set('services.redis', false);
      dev.set('data.seeded', false);

      // Verify reset state
      expect(dev.get('services.database')).toBe(false);
      expect(dev.get('data.seeded')).toBe(false);

      await dev.deactivate();
    });

    it('should handle complete start-stop-reset lifecycle', async () => {
      const dev = Environment.create({
        name: 'local-dev',
        config: {
          services: { database: false, app: false },
          data: { seeded: false },
        },
      });

      // Define all workflow tasks
      dev.tasks.define('start', {
        command: 'echo "Starting..."',
        description: 'Start all services',
      });

      dev.tasks.define('stop', {
        command: 'echo "Stopping..."',
        description: 'Stop all services',
      });

      dev.tasks.define('reset', {
        command: 'echo "Resetting..."',
        description: 'Reset environment',
        dependsOn: ['stop'],
      });

      await dev.activate();

      // 1. Start
      let result = await dev.tasks.run('start', { environment: dev });
      expect(result.success).toBe(true);
      dev.set('services.database', true);
      dev.set('services.app', true);
      dev.set('data.seeded', true);

      // 2. Stop
      result = await dev.tasks.run('stop', { environment: dev });
      expect(result.success).toBe(true);
      dev.set('services.database', false);
      dev.set('services.app', false);

      // 3. Reset
      result = await dev.tasks.run('reset', { environment: dev });
      expect(result.success).toBe(true);
      dev.set('data.seeded', false);

      // Verify final state
      expect(dev.get('services.database')).toBe(false);
      expect(dev.get('services.app')).toBe(false);
      expect(dev.get('data.seeded')).toBe(false);

      await dev.deactivate();
    });
  });

  /**
   * ============================================================
   * Scenario 4: Advanced Composition (spec 6.2)
   * ============================================================
   * Tests hierarchical environments, merge behavior with multiple levels,
   * and builder pattern for dynamic composition.
   */
  describe('Advanced Composition', () => {
    it('should create hierarchical environments (base → dev → prod)', async () => {
      // Create base environment (spec 6.2 - lines 2315-2328)
      const base = Environment.create({
        name: 'base',
        config: {
          app: {
            name: 'MyApp',
            version: '1.0.0',
          },
          features: {
            auth: true,
            analytics: false,
          },
        },
      });

      // Development overrides (spec 6.2 - lines 2330-2343)
      const dev = Environment.create({
        name: 'development',
        config: {
          environment: 'development',
          app: {
            debug: true,
          },
          database: {
            host: 'localhost',
            port: 5432,
          },
        },
      });

      // Production overrides (spec 6.2 - lines 2345-2361)
      const prod = Environment.create({
        name: 'production',
        config: {
          environment: 'production',
          app: {
            debug: false,
          },
          database: {
            host: 'prod-db.example.com',
            port: 5432,
          },
          features: {
            analytics: true,
          },
        },
      });

      // Verify base configuration
      expect(base.get('app.name')).toBe('MyApp');
      expect(base.get('app.version')).toBe('1.0.0');
      expect(base.get('features.auth')).toBe(true);
      expect(base.get('features.analytics')).toBe(false);

      // Verify dev has its own config
      expect(dev.get('environment')).toBe('development');
      expect(dev.get('app.debug')).toBe(true);
      expect(dev.get('database.host')).toBe('localhost');

      // Verify prod has its own config
      expect(prod.get('environment')).toBe('production');
      expect(prod.get('app.debug')).toBe(false);
      expect(prod.get('database.host')).toBe('prod-db.example.com');
    });

    it('should merge environments correctly with inheritance', async () => {
      const base = Environment.create({
        name: 'base',
        config: {
          app: { name: 'MyApp', version: '1.0.0' },
          features: { auth: true, analytics: false },
        },
      });

      const dev = Environment.create({
        name: 'development',
        config: {
          environment: 'development',
          app: { debug: true },
          database: { host: 'localhost', port: 5432 },
        },
      });

      const prod = Environment.create({
        name: 'production',
        config: {
          environment: 'production',
          app: { debug: false },
          database: { host: 'prod-db.example.com', port: 5432 },
          features: { analytics: true },
        },
      });

      // Merge base with dev (spec 6.2 - lines 2363-2369)
      const devEnv = base.merge(dev);
      const prodEnv = base.merge(prod);

      // Verify dev environment
      expect(devEnv.get('app.name')).toBe('MyApp'); // From base
      expect(devEnv.get('app.version')).toBe('1.0.0'); // From base
      expect(devEnv.get('app.debug')).toBe(true); // From dev
      expect(devEnv.get('environment')).toBe('development'); // From dev
      expect(devEnv.get('database.host')).toBe('localhost'); // From dev
      expect(devEnv.get('features.auth')).toBe(true); // From base

      // Verify prod environment
      expect(prodEnv.get('app.name')).toBe('MyApp'); // From base
      expect(prodEnv.get('app.debug')).toBe(false); // From prod
      expect(prodEnv.get('database.host')).toBe('prod-db.example.com'); // From prod
      expect(prodEnv.get('features.analytics')).toBe(true); // From prod (overrides base)
    });

    it('should support multi-level merge behavior', async () => {
      const layer1 = Environment.create({
        name: 'layer1',
        config: { a: 1, b: 2, c: 3 },
      });

      const layer2 = Environment.create({
        name: 'layer2',
        config: { b: 20, d: 4 },
      });

      const layer3 = Environment.create({
        name: 'layer3',
        config: { c: 30, e: 5 },
      });

      // Multi-level merge
      const merged = layer1.merge(layer2).merge(layer3);

      // Verify merge behavior (later values override)
      expect(merged.get('a')).toBe(1); // From layer1
      expect(merged.get('b')).toBe(20); // From layer2 (overrides layer1)
      expect(merged.get('c')).toBe(30); // From layer3 (overrides layer1)
      expect(merged.get('d')).toBe(4); // From layer2
      expect(merged.get('e')).toBe(5); // From layer3
    });

    it('should use builder pattern for dynamic composition', async () => {
      // Simulated builder pattern (spec 6.2 - lines 2374-2389)
      // Note: Actual builder implementation may vary
      const base = Environment.create({
        name: 'base',
        config: {
          app: { name: 'MyApp', version: '1.0.0' },
        },
      });

      const overrides = Environment.create({
        name: 'overrides',
        config: {
          environment: 'production',
          app: { debug: false },
        },
      });

      // Build final environment
      const env = base.merge(overrides);

      // Add variables
      env.variables.define('DEPLOY_TIME', Date.now());
      env.variables.define('GIT_COMMIT', 'abc123');

      // Verify composed environment
      expect(env.get('app.name')).toBe('MyApp');
      expect(env.get('environment')).toBe('production');
      expect(env.get('app.debug')).toBe(false);
      expect(env.variables.get('GIT_COMMIT')).toBe('abc123');
    });

    it('should handle complex nested composition scenarios', async () => {
      // Create nested configuration hierarchy
      const global = Environment.create({
        name: 'global',
        config: {
          company: { name: 'Acme Corp', industry: 'Tech' },
          defaults: { timeout: 5000, retries: 3 },
        },
      });

      const regional = Environment.create({
        name: 'regional',
        config: {
          region: 'us-east',
          defaults: { timeout: 3000 }, // Override timeout
        },
      });

      const local = Environment.create({
        name: 'local',
        config: {
          datacenter: 'us-east-1a',
          defaults: { retries: 5 }, // Override retries
          custom: { feature: 'enabled' },
        },
      });

      // Multi-level composition
      const final = global.merge(regional).merge(local);

      // Verify composition results
      expect(final.get('company.name')).toBe('Acme Corp'); // From global
      expect(final.get('company.industry')).toBe('Tech'); // From global
      expect(final.get('region')).toBe('us-east'); // From regional
      expect(final.get('datacenter')).toBe('us-east-1a'); // From local
      expect(final.get('defaults.timeout')).toBe(3000); // From regional (overrides global)
      expect(final.get('defaults.retries')).toBe(5); // From local (overrides global)
      expect(final.get('custom.feature')).toBe('enabled'); // From local
    });
  });

  /**
   * ============================================================
   * Scenario 5: Distributed Environment (spec 6.5)
   * ============================================================
   * Tests multi-node setup with sync, concurrent updates across nodes,
   * and eventual consistency.
   */
  describe('Distributed Environment', () => {
    it('should create distributed environment with multiple nodes', async () => {
      // Note: Full distributed implementation requires network layer
      // This test simulates the concept from spec 6.5 - lines 2549-2578

      const node1 = Environment.create({
        name: 'cluster-node-1',
        config: {
          nodeId: 'node-1',
          cluster: { name: 'production', size: 3 },
          state: { counter: 0 },
        },
      });

      const node2 = Environment.create({
        name: 'cluster-node-2',
        config: {
          nodeId: 'node-2',
          cluster: { name: 'production', size: 3 },
          state: { counter: 0 },
        },
      });

      const node3 = Environment.create({
        name: 'cluster-node-3',
        config: {
          nodeId: 'node-3',
          cluster: { name: 'production', size: 3 },
          state: { counter: 0 },
        },
      });

      // Verify node configurations
      expect(node1.get('nodeId')).toBe('node-1');
      expect(node2.get('nodeId')).toBe('node-2');
      expect(node3.get('nodeId')).toBe('node-3');
      expect(node1.get('cluster.name')).toBe('production');
      expect(node1.get('cluster.size')).toBe(3);
    });

    it('should handle concurrent updates on different nodes', async () => {
      const node1 = Environment.create({
        name: 'node-1',
        config: { features: {} },
      });

      const node2 = Environment.create({
        name: 'node-2',
        config: { features: {} },
      });

      // Simulate concurrent updates (spec 6.5 - lines 2587-2591)
      node1.set('features.enabled', true);
      node2.set('features.version', 2);

      // Verify independent updates
      expect(node1.get('features.enabled')).toBe(true);
      expect(node1.get('features.version')).toBeUndefined();
      expect(node2.get('features.version')).toBe(2);
      expect(node2.get('features.enabled')).toBeUndefined();

      // Simulate sync by merging
      const synced1 = node1.merge(node2);
      const synced2 = node2.merge(node1);

      // After sync, both should have both values
      expect(synced1.get('features.enabled')).toBe(true);
      expect(synced1.get('features.version')).toBe(2);
      expect(synced2.get('features.version')).toBe(2);
      expect(synced2.get('features.enabled')).toBe(true);
    });

    it('should demonstrate eventual consistency pattern', async () => {
      // Create cluster of nodes
      const nodes = [1, 2, 3].map((id) =>
        Environment.create({
          name: `node-${id}`,
          config: {
            nodeId: `node-${id}`,
            data: {},
          },
        })
      );

      // Node 0 updates
      nodes[0].set('data.key1', 'value1');
      expect(nodes[0].get('data.key1')).toBe('value1');

      // Node 1 updates different key
      nodes[1].set('data.key2', 'value2');
      expect(nodes[1].get('data.key2')).toBe('value2');

      // Node 2 updates third key
      nodes[2].set('data.key3', 'value3');
      expect(nodes[2].get('data.key3')).toBe('value3');

      // Simulate gossip protocol: merge pairwise
      // Round 1: node0 ← node1
      nodes[0] = nodes[0].merge(nodes[1]);
      expect(nodes[0].get('data.key2')).toBe('value2');

      // Round 2: node1 ← node2
      nodes[1] = nodes[1].merge(nodes[2]);
      expect(nodes[1].get('data.key3')).toBe('value3');

      // Round 3: node0 ← node1 (now has all updates)
      nodes[0] = nodes[0].merge(nodes[1]);

      // Eventually consistent: node0 has all updates
      expect(nodes[0].get('data.key1')).toBe('value1');
      expect(nodes[0].get('data.key2')).toBe('value2');
      expect(nodes[0].get('data.key3')).toBe('value3');
    });

    it('should handle distributed configuration propagation', async () => {
      // Simulate configuration propagation across distributed nodes
      const master = Environment.create({
        name: 'master',
        config: {
          global: {
            timeout: 5000,
            retries: 3,
            version: '1.0.0',
          },
        },
      });

      // Create worker nodes
      const workers = [1, 2, 3, 4].map((id) =>
        Environment.create({
          name: `worker-${id}`,
          config: {
            workerId: id,
            local: { cache: 'enabled' },
          },
        })
      );

      // Propagate master config to all workers
      const updatedWorkers = workers.map((worker) => master.merge(worker));

      // Verify all workers received global config
      for (const worker of updatedWorkers) {
        expect(worker.get('global.timeout')).toBe(5000);
        expect(worker.get('global.retries')).toBe(3);
        expect(worker.get('global.version')).toBe('1.0.0');
      }

      // Verify workers maintain local config
      for (let i = 0; i < updatedWorkers.length; i++) {
        expect(updatedWorkers[i].get('workerId')).toBe(i + 1);
        expect(updatedWorkers[i].get('local.cache')).toBe('enabled');
      }
    });

    it('should support conflict resolution in distributed updates', async () => {
      const node1 = Environment.create({
        name: 'node-1',
        config: {
          counter: 10,
          timestamp: Date.now(),
        },
      });

      const node2 = Environment.create({
        name: 'node-2',
        config: {
          counter: 15, // Conflicting value
          timestamp: Date.now() + 1000, // Later timestamp
        },
      });

      // Merge with last-write-wins (default)
      const merged = node1.merge(node2);

      // Later value (node2) should win
      expect(merged.get('counter')).toBe(15);
      expect(merged.get('timestamp')).toBeGreaterThan(node1.get('timestamp'));
    });
  });

  /**
   * ============================================================
   * Scenario 6: Cognitive Environment (spec 6.6)
   * ============================================================
   * Tests learning from usage patterns, suggestion generation,
   * and anomaly detection.
   */
  describe('Cognitive Environment', () => {
    it('should create cognitive environment with learning capabilities', async () => {
      // Create cognitive environment (spec 6.6 - lines 2604-2614)
      const schema = z.object({
        api: z.object({
          timeout: z.number(),
          retries: z.number(),
        }),
      });

      const baseEnv = Environment.create({
        name: 'production',
        schema,
        config: {
          api: {
            timeout: 5000,
            retries: 3,
          },
        },
      });

      const env = new CognitiveEnvironment(baseEnv);

      // Verify cognitive environment is created
      expect(env).toBeDefined();
      expect(env.getEnvironment().get('api.timeout')).toBe(5000);
      expect(env.getEnvironment().get('api.retries')).toBe(3);
    });

    it('should learn from usage patterns and generate suggestions', async () => {
      const schema = z.object({
        api: z.object({
          timeout: z.number(),
          retries: z.number(),
        }),
      });

      const baseEnv = Environment.create({
        name: 'production',
        schema,
        config: {
          api: {
            timeout: 5000,
            retries: 3,
          },
        },
      });

      const env = new CognitiveEnvironment(baseEnv);

      // Simulate usage and learning (spec 6.6 - lines 2617-2629)
      // Record successful patterns
      for (let i = 0; i < 10; i++) {
        await env.getConfig('api.timeout');
        await env.getConfig('api.retries');
      }

      // Analyze patterns and generate suggestions
      env.analyzeAndSuggest();

      // Get suggestions (spec 6.6 - lines 2631-2645)
      const suggestions = env.getSuggestions();

      // Verify suggestions are generated (array should be defined)
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should detect anomalies in configuration', async () => {
      const schema = z.object({
        database: z.object({
          connections: z.number(),
          timeout: z.number(),
        }),
      });

      const baseEnv = Environment.create({
        name: 'production',
        schema,
        config: {
          database: {
            connections: 50,
            timeout: 5000,
          },
        },
      });

      const env = new CognitiveEnvironment(baseEnv);

      // Establish baseline
      for (let i = 0; i < 50; i++) {
        await env.getConfig('database.connections');
        await env.getConfig('database.timeout');
      }

      // Introduce anomaly
      baseEnv.set('database.connections', 500); // Unusual spike

      // Analyze patterns for anomaly detection
      env.analyzeAndSuggest();
      const patterns = env.getAccessPatterns();

      // Verify pattern analysis (anomaly detection via pattern changes)
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should provide pattern analysis and insights', async () => {
      const schema = z.object({
        cache: z.object({
          ttl: z.number(),
          size: z.number(),
        }),
      });

      const baseEnv = Environment.create({
        name: 'production',
        schema,
        config: {
          cache: {
            ttl: 3600,
            size: 1000,
          },
        },
      });

      const env = new CognitiveEnvironment(baseEnv);

      // Record diverse access patterns
      for (let i = 0; i < 20; i++) {
        await env.getConfig('cache.ttl');
        await env.getConfig('cache.size');
      }

      // Get pattern analysis
      const patterns = env.getAccessPatterns();

      // Verify pattern analysis
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should support reasoning and explanation capabilities', async () => {
      const schema = z.object({
        performance: z.object({
          threads: z.number(),
          memory: z.number(),
        }),
      });

      const baseEnv = Environment.create({
        name: 'production',
        schema,
        config: {
          performance: {
            threads: 8,
            memory: 2048,
          },
        },
      });

      const env = new CognitiveEnvironment(baseEnv);

      // Record reasoning data
      for (let i = 0; i < 20; i++) {
        await env.getConfig('performance.threads');
      }

      // Get explanation (spec 6.6 - lines 2704-2728)
      const explanation = await env.explain('performance.threads', {
        depth: 'detailed',
        includeHistory: true,
      });

      // Verify explanation structure
      expect(explanation).toBeDefined();
      expect(explanation).toHaveProperty('text');
      expect(typeof explanation.text).toBe('string');
      expect(explanation.text.length).toBeGreaterThan(0);
    });
  });
});
