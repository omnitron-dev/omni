/**
 * E2E Test: Real-World Scenarios
 *
 * Tests realistic use cases:
 * - Microservices configuration management
 * - CI/CD pipeline simulation
 * - Development workflow (start/stop/reset)
 * - Feature flags and A/B testing
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../../src/core/environment.js';
import { LocalSecretsProvider } from '../../src/secrets/providers/local.js';
import { z } from 'zod';

describe('E2E: Real-World Scenarios', () => {
  const testDir = path.join(process.cwd(), 'test-data', 'e2e', 'real-world');

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

  it('should manage microservices configuration', async () => {
    // ============================================================
    // Scenario: E-commerce platform with multiple microservices
    // ============================================================

    const serviceSchema = z.object({
      service: z.object({
        name: z.string(),
        version: z.string(),
        port: z.number()
      }),
      dependencies: z.array(z.string()),
      database: z.object({
        host: z.string(),
        port: z.number(),
        name: z.string()
      }).optional(),
      cache: z.object({
        host: z.string(),
        port: z.number()
      }).optional(),
      observability: z.object({
        tracing: z.boolean(),
        metrics: z.boolean()
      })
    });

    // Shared base configuration
    const baseConfig = {
      observability: {
        tracing: true,
        metrics: true
      }
    };

    // API Gateway Service
    const apiGateway = Environment.create({
      name: 'api-gateway',
      schema: serviceSchema,
      config: {
        service: {
          name: 'api-gateway',
          version: '2.0.0',
          port: 8080
        },
        dependencies: ['auth-service', 'user-service', 'order-service'],
        ...baseConfig
      }
    });

    // User Service
    const userService = Environment.create({
      name: 'user-service',
      schema: serviceSchema,
      config: {
        service: {
          name: 'user-service',
          version: '1.5.0',
          port: 3001
        },
        dependencies: ['auth-service'],
        database: {
          host: 'user-db.internal',
          port: 5432,
          name: 'users'
        },
        cache: {
          host: 'redis.internal',
          port: 6379
        },
        ...baseConfig
      },
      secretsProvider: new LocalSecretsProvider({
        storagePath: path.join(testDir, 'user-secrets'),
        password: 'test-password-123'
      })
    });

    await userService.secrets!.set('database.password', 'user-db-password');
    await userService.secrets!.set('jwt.secret', 'jwt-secret-key');

    // Order Service
    const orderService = Environment.create({
      name: 'order-service',
      schema: serviceSchema,
      config: {
        service: {
          name: 'order-service',
          version: '1.3.0',
          port: 3002
        },
        dependencies: ['user-service', 'payment-service', 'inventory-service'],
        database: {
          host: 'order-db.internal',
          port: 5432,
          name: 'orders'
        },
        ...baseConfig
      },
      secretsProvider: new LocalSecretsProvider({
        storagePath: path.join(testDir, 'order-secrets'),
        password: 'test-password-123'
      })
    });

    await orderService.secrets!.set('database.password', 'order-db-password');
    await orderService.secrets!.set('payment.api.key', 'payment-api-key');

    // Auth Service
    const authService = Environment.create({
      name: 'auth-service',
      schema: serviceSchema,
      config: {
        service: {
          name: 'auth-service',
          version: '2.1.0',
          port: 3003
        },
        dependencies: [],
        database: {
          host: 'auth-db.internal',
          port: 5432,
          name: 'auth'
        },
        cache: {
          host: 'redis.internal',
          port: 6379
        },
        ...baseConfig
      },
      secretsProvider: new LocalSecretsProvider({
        storagePath: path.join(testDir, 'auth-secrets'),
        password: 'test-password-123'
      })
    });

    await authService.secrets!.set('database.password', 'auth-db-password');
    await authService.secrets!.set('session.secret', 'session-secret-key');

    // Verify microservices configuration
    const services = [apiGateway, userService, orderService, authService];

    // Check all services have tracing enabled
    for (const service of services) {
      expect(service.get('observability.tracing')).toBe(true);
      expect(service.get('observability.metrics')).toBe(true);
    }

    // Verify dependency graph
    expect(apiGateway.get('dependencies')).toContain('auth-service');
    expect(apiGateway.get('dependencies')).toContain('user-service');
    expect(apiGateway.get('dependencies')).toContain('order-service');

    expect(userService.get('dependencies')).toContain('auth-service');
    expect(orderService.get('dependencies')).toContain('user-service');

    // Save all service configurations
    for (const service of services) {
      const servicePath = path.join(testDir, `${service.name}.yaml`);
      await service.save(servicePath);
    }

    // Verify all saved
    for (const service of services) {
      const servicePath = path.join(testDir, `${service.name}.yaml`);
      expect(fs.existsSync(servicePath)).toBe(true);
    }

    // Simulate service discovery
    const serviceRegistry: Record<string, { port: number; dependencies: string[] }> = {};

    for (const service of services) {
      serviceRegistry[service.get('service.name')] = {
        port: service.get('service.port'),
        dependencies: service.get('dependencies')
      };
    }

    expect(serviceRegistry['api-gateway'].port).toBe(8080);
    expect(serviceRegistry['user-service'].port).toBe(3001);
    expect(serviceRegistry['order-service'].dependencies).toContain('payment-service');
  });

  it('should simulate CI/CD pipeline workflow', async () => {
    // ============================================================
    // Scenario: Automated CI/CD pipeline for application deployment
    // ============================================================

    const pipelineSchema = z.object({
      pipeline: z.object({
        name: z.string(),
        trigger: z.string(),
        branch: z.string()
      }),
      build: z.object({
        enabled: z.boolean(),
        cache: z.boolean()
      }),
      test: z.object({
        unit: z.boolean(),
        integration: z.boolean(),
        e2e: z.boolean()
      }),
      deploy: z.object({
        enabled: z.boolean(),
        target: z.string(),
        autoApprove: z.boolean()
      })
    });

    const pipeline = Environment.create({
      name: 'ci-cd-pipeline',
      schema: pipelineSchema,
      config: {
        pipeline: {
          name: 'main-pipeline',
          trigger: 'push',
          branch: 'main'
        },
        build: {
          enabled: true,
          cache: true
        },
        test: {
          unit: true,
          integration: true,
          e2e: true
        },
        deploy: {
          enabled: true,
          target: 'production',
          autoApprove: false
        }
      }
    });

    // Configure pipeline variables
    pipeline.variables.define('GIT_BRANCH', 'main');
    pipeline.variables.define('GIT_COMMIT', 'abc123');
    pipeline.variables.define('BUILD_NUMBER', '42');
    pipeline.variables.define('DEPLOY_ENV', 'production');

    // Define pipeline stages
    pipeline.tasks.define('checkout', {
      command: 'echo "Checking out ${GIT_BRANCH}..."',
      description: 'Checkout source code'
    });

    pipeline.tasks.define('install', {
      command: 'echo "Installing dependencies..."',
      description: 'Install dependencies',
      dependsOn: ['checkout']
    });

    pipeline.tasks.define('lint', {
      command: 'echo "Running linter..."',
      description: 'Run code linting',
      dependsOn: ['install']
    });

    pipeline.tasks.define('unit-test', {
      command: 'echo "Running unit tests..."',
      description: 'Run unit tests',
      dependsOn: ['install']
    });

    pipeline.tasks.define('integration-test', {
      command: 'echo "Running integration tests..."',
      description: 'Run integration tests',
      dependsOn: ['unit-test']
    });

    pipeline.tasks.define('build', {
      command: 'echo "Building application..."',
      description: 'Build application',
      dependsOn: ['lint', 'integration-test']
    });

    pipeline.tasks.define('security-scan', {
      command: 'echo "Running security scan..."',
      description: 'Security vulnerability scan',
      dependsOn: ['build']
    });

    pipeline.tasks.define('deploy-staging', {
      command: 'echo "Deploying to staging..."',
      description: 'Deploy to staging environment',
      dependsOn: ['security-scan']
    });

    pipeline.tasks.define('e2e-test', {
      command: 'echo "Running E2E tests..."',
      description: 'Run end-to-end tests',
      dependsOn: ['deploy-staging']
    });

    pipeline.tasks.define('deploy-production', {
      command: 'echo "Deploying to production..."',
      description: 'Deploy to production environment',
      dependsOn: ['e2e-test']
    });

    pipeline.tasks.define('smoke-test', {
      command: 'echo "Running smoke tests..."',
      description: 'Run production smoke tests',
      dependsOn: ['deploy-production']
    });

    pipeline.tasks.define('notify', {
      command: 'echo "Pipeline completed! Build #${BUILD_NUMBER}"',
      description: 'Notify team of pipeline status',
      dependsOn: ['smoke-test']
    });

    // Get execution order
    const stages = [
      'checkout',
      'install',
      'lint',
      'unit-test',
      'integration-test',
      'build',
      'security-scan',
      'deploy-staging',
      'e2e-test',
      'deploy-production',
      'smoke-test',
      'notify'
    ];

    const executionOrder = pipeline.tasks.getExecutionOrder(stages);

    // Verify order respects dependencies
    expect(executionOrder.indexOf('checkout')).toBeLessThan(executionOrder.indexOf('install'));
    expect(executionOrder.indexOf('install')).toBeLessThan(executionOrder.indexOf('lint'));
    expect(executionOrder.indexOf('install')).toBeLessThan(executionOrder.indexOf('unit-test'));
    expect(executionOrder.indexOf('unit-test')).toBeLessThan(
      executionOrder.indexOf('integration-test')
    );
    expect(executionOrder.indexOf('build')).toBeGreaterThan(executionOrder.indexOf('lint'));
    expect(executionOrder.indexOf('build')).toBeGreaterThan(
      executionOrder.indexOf('integration-test')
    );

    // Execute pipeline (simulated)
    await pipeline.activate();

    const results: Record<string, boolean> = {};

    for (const stage of executionOrder) {
      const result = await pipeline.tasks.run(stage, {
        environment: pipeline,
        dryRun: false
      });
      results[stage] = result.success;
    }

    // Verify all stages completed
    for (const stage of stages) {
      expect(results[stage]).toBe(true);
    }

    await pipeline.deactivate();
  });

  it('should handle development workflow lifecycle', async () => {
    // ============================================================
    // Scenario: Developer local environment management
    // ============================================================

    const devSchema = z.object({
      services: z.object({
        database: z.boolean(),
        redis: z.boolean(),
        rabbitmq: z.boolean()
      }),
      app: z.object({
        hotReload: z.boolean(),
        debugMode: z.boolean(),
        mockExternal: z.boolean()
      }),
      data: z.object({
        seeded: z.boolean(),
        fixtures: z.array(z.string())
      })
    });

    const devEnv = Environment.create({
      name: 'local-dev',
      schema: devSchema,
      config: {
        services: {
          database: false,
          redis: false,
          rabbitmq: false
        },
        app: {
          hotReload: true,
          debugMode: true,
          mockExternal: true
        },
        data: {
          seeded: false,
          fixtures: ['users', 'products', 'orders']
        }
      }
    });

    // Define workflow tasks
    devEnv.tasks.define('start-db', {
      command: 'echo "Starting PostgreSQL..."',
      description: 'Start PostgreSQL database'
    });

    devEnv.tasks.define('start-redis', {
      command: 'echo "Starting Redis..."',
      description: 'Start Redis cache'
    });

    devEnv.tasks.define('start-rabbitmq', {
      command: 'echo "Starting RabbitMQ..."',
      description: 'Start RabbitMQ message broker'
    });

    devEnv.tasks.define('migrate-db', {
      command: 'echo "Running migrations..."',
      description: 'Run database migrations',
      dependsOn: ['start-db']
    });

    devEnv.tasks.define('seed-db', {
      command: 'echo "Seeding database..."',
      description: 'Seed database with fixtures',
      dependsOn: ['migrate-db']
    });

    devEnv.tasks.define('start-app', {
      command: 'echo "Starting application..."',
      description: 'Start application server',
      dependsOn: ['seed-db', 'start-redis', 'start-rabbitmq']
    });

    devEnv.tasks.define('stop-all', {
      command: 'echo "Stopping all services..."',
      description: 'Stop all services'
    });

    devEnv.tasks.define('reset', {
      command: 'echo "Resetting environment..."',
      description: 'Reset development environment',
      dependsOn: ['stop-all']
    });

    // Start workflow
    await devEnv.activate();

    // Execute start sequence
    const startTasks = [
      'start-db',
      'start-redis',
      'start-rabbitmq',
      'migrate-db',
      'seed-db',
      'start-app'
    ];

    const startOrder = devEnv.tasks.getExecutionOrder(startTasks);

    for (const task of startOrder) {
      const result = await devEnv.tasks.run(task, { environment: devEnv });
      expect(result.success).toBe(true);

      // Update service status
      if (task === 'start-db') devEnv.set('services.database', true);
      if (task === 'start-redis') devEnv.set('services.redis', true);
      if (task === 'start-rabbitmq') devEnv.set('services.rabbitmq', true);
      if (task === 'seed-db') devEnv.set('data.seeded', true);
    }

    // Verify services are running
    expect(devEnv.get('services.database')).toBe(true);
    expect(devEnv.get('services.redis')).toBe(true);
    expect(devEnv.get('services.rabbitmq')).toBe(true);
    expect(devEnv.get('data.seeded')).toBe(true);

    // Stop workflow
    const stopResult = await devEnv.tasks.run('stop-all', { environment: devEnv });
    expect(stopResult.success).toBe(true);

    devEnv.set('services.database', false);
    devEnv.set('services.redis', false);
    devEnv.set('services.rabbitmq', false);

    // Reset workflow
    const resetResult = await devEnv.tasks.run('reset', { environment: devEnv });
    expect(resetResult.success).toBe(true);

    devEnv.set('data.seeded', false);

    // Verify reset state
    expect(devEnv.get('services.database')).toBe(false);
    expect(devEnv.get('data.seeded')).toBe(false);

    await devEnv.deactivate();
  });

  it('should handle feature flags and A/B testing', async () => {
    // ============================================================
    // Scenario: Feature flag management for gradual rollout
    // ============================================================

    const featureSchema = z.object({
      features: z.record(
        z.object({
          enabled: z.boolean(),
          rollout: z.number().min(0).max(100),
          audiences: z.array(z.string())
        })
      ),
      experiments: z.record(
        z.object({
          variant: z.string(),
          weight: z.number()
        })
      )
    });

    const features = Environment.create({
      name: 'feature-flags',
      schema: featureSchema,
      config: {
        features: {
          'new-checkout': {
            enabled: true,
            rollout: 25, // 25% rollout
            audiences: ['beta-users', 'internal']
          },
          'dark-mode': {
            enabled: true,
            rollout: 100, // Full rollout
            audiences: ['all']
          },
          'ai-recommendations': {
            enabled: false,
            rollout: 0,
            audiences: []
          },
          'social-login': {
            enabled: true,
            rollout: 50, // 50% rollout
            audiences: ['mobile-users', 'new-users']
          }
        },
        experiments: {
          'pricing-page-v2': {
            variant: 'control',
            weight: 50
          },
          'onboarding-flow': {
            variant: 'variant-b',
            weight: 33
          }
        }
      }
    });

    // Check feature availability
    const newCheckout = features.get('features.new-checkout');
    expect(newCheckout.enabled).toBe(true);
    expect(newCheckout.rollout).toBe(25);
    expect(newCheckout.audiences).toContain('beta-users');

    // Simulate feature toggle
    features.set('features.ai-recommendations.enabled', true);
    features.set('features.ai-recommendations.rollout', 10);
    features.set('features.ai-recommendations.audiences', ['premium-users']);

    expect(features.get('features.ai-recommendations.enabled')).toBe(true);
    expect(features.get('features.ai-recommendations.rollout')).toBe(10);

    // Simulate gradual rollout increase
    const rolloutSteps = [25, 50, 75, 100];

    for (const rollout of rolloutSteps) {
      features.set('features.new-checkout.rollout', rollout);
      expect(features.get('features.new-checkout.rollout')).toBe(rollout);

      // Save state at each step
      const statePath = path.join(testDir, `rollout-${rollout}.yaml`);
      await features.save(statePath);
    }

    // Verify all rollout states were saved
    for (const rollout of rolloutSteps) {
      const statePath = path.join(testDir, `rollout-${rollout}.yaml`);
      expect(fs.existsSync(statePath)).toBe(true);

      const state = await Environment.fromFile(statePath, { schema: featureSchema });
      expect(state.get('features.new-checkout.rollout')).toBe(rollout);
    }

    // Verify experiment configuration
    const pricingExperiment = features.get('experiments.pricing-page-v2');
    expect(pricingExperiment.variant).toBe('control');
    expect(pricingExperiment.weight).toBe(50);
  });

  it('should handle multi-tenant configuration', async () => {
    // ============================================================
    // Scenario: SaaS application with multiple tenants
    // ============================================================

    const tenantSchema = z.object({
      tenant: z.object({
        id: z.string(),
        name: z.string(),
        tier: z.enum(['free', 'pro', 'enterprise'])
      }),
      limits: z.object({
        users: z.number(),
        storage: z.number(),
        apiCalls: z.number()
      }),
      features: z.object({
        customBranding: z.boolean(),
        sso: z.boolean(),
        analytics: z.boolean(),
        support: z.enum(['community', 'email', '24x7'])
      })
    });

    // Create tenant configurations
    const tenants = [
      {
        id: 'tenant-1',
        name: 'Acme Corp',
        tier: 'enterprise' as const,
        limits: { users: 1000, storage: 1000000, apiCalls: 1000000 },
        features: {
          customBranding: true,
          sso: true,
          analytics: true,
          support: '24x7' as const
        }
      },
      {
        id: 'tenant-2',
        name: 'Startup Inc',
        tier: 'pro' as const,
        limits: { users: 50, storage: 100000, apiCalls: 100000 },
        features: {
          customBranding: true,
          sso: false,
          analytics: true,
          support: 'email' as const
        }
      },
      {
        id: 'tenant-3',
        name: 'Hobbyist LLC',
        tier: 'free' as const,
        limits: { users: 5, storage: 10000, apiCalls: 10000 },
        features: {
          customBranding: false,
          sso: false,
          analytics: false,
          support: 'community' as const
        }
      }
    ];

    const tenantEnvs = tenants.map((config) =>
      Environment.create({
        name: config.id,
        schema: tenantSchema,
        config: {
          tenant: {
            id: config.id,
            name: config.name,
            tier: config.tier
          },
          limits: config.limits,
          features: config.features
        }
      })
    );

    // Verify tenant configurations
    expect(tenantEnvs[0].get('tenant.tier')).toBe('enterprise');
    expect(tenantEnvs[0].get('features.sso')).toBe(true);
    expect(tenantEnvs[0].get('limits.users')).toBe(1000);

    expect(tenantEnvs[1].get('tenant.tier')).toBe('pro');
    expect(tenantEnvs[1].get('features.sso')).toBe(false);
    expect(tenantEnvs[1].get('limits.users')).toBe(50);

    expect(tenantEnvs[2].get('tenant.tier')).toBe('free');
    expect(tenantEnvs[2].get('features.customBranding')).toBe(false);
    expect(tenantEnvs[2].get('limits.users')).toBe(5);

    // Save all tenant configurations
    for (const env of tenantEnvs) {
      const tenantPath = path.join(testDir, `${env.name}.yaml`);
      await env.save(tenantPath);
    }

    // Verify all saved
    for (const tenant of tenants) {
      const tenantPath = path.join(testDir, `${tenant.id}.yaml`);
      expect(fs.existsSync(tenantPath)).toBe(true);
    }
  });
});
