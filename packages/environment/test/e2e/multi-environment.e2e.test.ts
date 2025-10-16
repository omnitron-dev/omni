/**
 * E2E Test: Multi-Environment Management
 *
 * Tests managing multiple environments with inheritance and composition:
 * - Create base, dev, staging, prod environments
 * - Test merging and inheritance
 * - Diff between environments
 * - Apply patches
 * - Validate configurations
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../../src/core/environment.js';
import { z } from 'zod';

describe('E2E: Multi-Environment Management', () => {
  const testDir = path.join(process.cwd(), 'test-data', 'e2e', 'multi-env');

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

  it('should manage multiple environments with inheritance', async () => {
    // ============================================================
    // Phase 1: Create Base Environment
    // ============================================================

    const schema = z.object({
      app: z.object({
        name: z.string(),
        version: z.string()
      }),
      server: z.object({
        host: z.string(),
        port: z.number(),
        timeout: z.number()
      }),
      database: z.object({
        host: z.string(),
        port: z.number(),
        name: z.string(),
        ssl: z.boolean()
      }),
      features: z.object({
        logging: z.boolean(),
        metrics: z.boolean(),
        debug: z.boolean()
      }),
      limits: z.object({
        maxConnections: z.number(),
        requestTimeout: z.number()
      })
    });

    const baseEnv = Environment.create({
      name: 'base',
      version: '1.0.0',
      schema,
      config: {
        app: {
          name: 'MultiEnvApp',
          version: '1.0.0'
        },
        server: {
          host: '0.0.0.0',
          port: 3000,
          timeout: 30000
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'myapp',
          ssl: false
        },
        features: {
          logging: true,
          metrics: false,
          debug: false
        },
        limits: {
          maxConnections: 100,
          requestTimeout: 5000
        }
      }
    });

    const basePath = path.join(testDir, 'base.yaml');
    await baseEnv.save(basePath);

    // ============================================================
    // Phase 2: Create Development Environment
    // ============================================================

    const devEnv = Environment.create({
      name: 'development',
      schema,
      config: {
        app: {
          name: 'MultiEnvApp',
          version: '1.0.0'
        },
        server: {
          host: '0.0.0.0',
          port: 3001,
          timeout: 30000
        },
        database: {
          host: 'localhost',
          port: 5432,
          name: 'myapp_dev',
          ssl: false
        },
        features: {
          logging: true,
          metrics: true,
          debug: true
        },
        limits: {
          maxConnections: 50,
          requestTimeout: 10000
        }
      }
    });

    const devPath = path.join(testDir, 'development.yaml');
    await devEnv.save(devPath);

    // ============================================================
    // Phase 3: Create Staging Environment
    // ============================================================

    const stagingEnv = Environment.create({
      name: 'staging',
      schema,
      config: {
        app: {
          name: 'MultiEnvApp',
          version: '1.0.0'
        },
        server: {
          host: '0.0.0.0',
          port: 8080,
          timeout: 30000
        },
        database: {
          host: 'staging-db.example.com',
          port: 5432,
          name: 'myapp_staging',
          ssl: true
        },
        features: {
          logging: true,
          metrics: true,
          debug: false
        },
        limits: {
          maxConnections: 200,
          requestTimeout: 5000
        }
      }
    });

    const stagingPath = path.join(testDir, 'staging.yaml');
    await stagingEnv.save(stagingPath);

    // ============================================================
    // Phase 4: Create Production Environment
    // ============================================================

    const prodEnv = Environment.create({
      name: 'production',
      schema,
      config: {
        app: {
          name: 'MultiEnvApp',
          version: '1.0.0'
        },
        server: {
          host: '0.0.0.0',
          port: 8080,
          timeout: 60000
        },
        database: {
          host: 'prod-db.example.com',
          port: 5432,
          name: 'myapp_prod',
          ssl: true
        },
        features: {
          logging: true,
          metrics: true,
          debug: false
        },
        limits: {
          maxConnections: 500,
          requestTimeout: 3000
        }
      }
    });

    const prodPath = path.join(testDir, 'production.yaml');
    await prodEnv.save(prodPath);

    // ============================================================
    // Phase 5: Test Merging
    // ============================================================

    // Load environments
    const base = await Environment.fromFile(basePath, { schema });
    const dev = await Environment.fromFile(devPath, { schema });
    const staging = await Environment.fromFile(stagingPath, { schema });
    const prod = await Environment.fromFile(prodPath, { schema });

    // Merge base with dev
    const mergedDev = base.merge(dev);
    expect(mergedDev.get('server.port')).toBe(3001);
    expect(mergedDev.get('database.name')).toBe('myapp_dev');
    expect(mergedDev.get('features.debug')).toBe(true);
    expect(mergedDev.get('limits.maxConnections')).toBe(50);

    // Merge base with staging
    const mergedStaging = base.merge(staging);
    expect(mergedStaging.get('server.port')).toBe(8080);
    expect(mergedStaging.get('database.host')).toBe('staging-db.example.com');
    expect(mergedStaging.get('database.ssl')).toBe(true);

    // Merge base with prod
    const mergedProd = base.merge(prod);
    expect(mergedProd.get('server.timeout')).toBe(60000);
    expect(mergedProd.get('database.host')).toBe('prod-db.example.com');
    expect(mergedProd.get('limits.maxConnections')).toBe(500);

    // ============================================================
    // Phase 6: Test Diff Between Environments
    // ============================================================

    // Diff dev vs prod
    const devVsProd = dev.diff(prod);

    // Check additions (keys in prod but not in dev)
    expect(devVsProd.added).toBeDefined();

    // Check modifications
    expect(devVsProd.modified).toBeDefined();
    expect(devVsProd.modified['server.port']).toBeDefined();
    expect(devVsProd.modified['server.port'].before).toBe(3001);
    expect(devVsProd.modified['server.port'].after).toBe(8080);

    expect(devVsProd.modified['database.host']).toBeDefined();
    expect(devVsProd.modified['database.host'].before).toBe('localhost');
    expect(devVsProd.modified['database.host'].after).toBe('prod-db.example.com');

    expect(devVsProd.modified['features.debug']).toBeDefined();
    expect(devVsProd.modified['features.debug'].before).toBe(true);
    expect(devVsProd.modified['features.debug'].after).toBe(false);

    // Diff staging vs prod
    const stagingVsProd = staging.diff(prod);

    expect(stagingVsProd.modified['database.host']).toBeDefined();
    expect(stagingVsProd.modified['database.host'].before).toBe('staging-db.example.com');
    expect(stagingVsProd.modified['database.host'].after).toBe('prod-db.example.com');

    // ============================================================
    // Phase 7: Apply Patches
    // ============================================================

    // Create a patch to upgrade dev to staging-like config
    const devToStagingDiff = dev.diff(staging);
    const upgradedDev = dev.patch(devToStagingDiff);

    // Verify patched environment
    expect(upgradedDev.get('server.port')).toBe(8080);
    expect(upgradedDev.get('database.host')).toBe('staging-db.example.com');
    expect(upgradedDev.get('database.ssl')).toBe(true);
    expect(upgradedDev.get('limits.maxConnections')).toBe(200);

    // ============================================================
    // Phase 8: Validate All Environments
    // ============================================================

    const environments = [base, dev, staging, prod];
    const names = ['base', 'development', 'staging', 'production'];

    for (let i = 0; i < environments.length; i++) {
      const env = environments[i];
      const name = names[i];

      const validation = await env.validate();
      expect(validation.valid).toBe(true, `${name} should be valid`);
      expect(validation.errors).toBeUndefined();
    }

    // ============================================================
    // Phase 9: Test Environment Comparison
    // ============================================================

    // Compare database configurations across environments
    const dbConfigs = environments.map((env) => ({
      name: env.name,
      host: env.get('database.host'),
      name: env.get('database.name'),
      ssl: env.get('database.ssl')
    }));

    expect(dbConfigs[0]).toEqual({
      name: 'base',
      host: 'localhost',
      name: 'myapp',
      ssl: false
    });

    expect(dbConfigs[1]).toEqual({
      name: 'development',
      host: 'localhost',
      name: 'myapp_dev',
      ssl: false
    });

    expect(dbConfigs[2]).toEqual({
      name: 'staging',
      host: 'staging-db.example.com',
      name: 'myapp_staging',
      ssl: true
    });

    expect(dbConfigs[3]).toEqual({
      name: 'production',
      host: 'prod-db.example.com',
      name: 'myapp_prod',
      ssl: true
    });

    // ============================================================
    // Phase 10: Test Progressive Deployment
    // ============================================================

    // Simulate progressive rollout: dev -> staging -> prod
    const deploymentChain = [dev, staging, prod];

    for (let i = 0; i < deploymentChain.length - 1; i++) {
      const current = deploymentChain[i];
      const next = deploymentChain[i + 1];

      // Calculate diff
      const diff = current.diff(next);

      // Verify there are differences
      const hasChanges =
        Object.keys(diff.modified).length > 0 ||
        Object.keys(diff.added).length > 0 ||
        diff.deleted.length > 0;

      expect(hasChanges).toBe(true);

      // Apply changes
      const promoted = current.patch(diff);

      // Verify key changes
      if (i === 0) {
        // dev -> staging
        expect(promoted.get('server.port')).toBe(next.get('server.port'));
        expect(promoted.get('database.host')).toBe(next.get('database.host'));
      } else {
        // staging -> prod
        expect(promoted.get('database.host')).toBe(next.get('database.host'));
        expect(promoted.get('limits.maxConnections')).toBe(next.get('limits.maxConnections'));
      }
    }
  });

  it('should handle environment cloning and isolation', async () => {
    const schema = z.object({
      value: z.number()
    });

    const original = Environment.create({
      name: 'original',
      schema,
      config: { value: 100 }
    });

    // Clone multiple times
    const clone1 = original.clone();
    const clone2 = original.clone();

    // Verify independence
    clone1.set('value', 200);
    clone2.set('value', 300);

    expect(original.get('value')).toBe(100);
    expect(clone1.get('value')).toBe(200);
    expect(clone2.get('value')).toBe(300);

    // Verify different instances
    expect(clone1.id).not.toBe(original.id);
    expect(clone2.id).not.toBe(original.id);
    expect(clone1.id).not.toBe(clone2.id);
  });

  it('should handle complex merge strategies', async () => {
    const schema = z.object({
      arrays: z.object({
        items: z.array(z.number())
      }),
      nested: z.object({
        deep: z.object({
          value: z.string()
        })
      })
    });

    const env1 = Environment.create({
      name: 'env1',
      schema,
      config: {
        arrays: {
          items: [1, 2, 3]
        },
        nested: {
          deep: {
            value: 'original'
          }
        }
      }
    });

    const env2 = Environment.create({
      name: 'env2',
      schema,
      config: {
        arrays: {
          items: [4, 5, 6]
        },
        nested: {
          deep: {
            value: 'updated'
          }
        }
      }
    });

    // Default merge (replace)
    const merged = env1.merge(env2);
    expect(merged.get('arrays.items')).toEqual([4, 5, 6]);
    expect(merged.get('nested.deep.value')).toBe('updated');
  });

  it('should support environment promotion workflow', async () => {
    const schema = z.object({
      version: z.string(),
      deployed: z.boolean(),
      promotedFrom: z.string().optional()
    });

    // Create development environment
    const dev = Environment.create({
      name: 'development',
      schema,
      config: {
        version: '1.2.3',
        deployed: true,
        promotedFrom: undefined
      }
    });

    // Promote to staging
    const staging = dev.clone();
    (staging as any).name = 'staging';
    staging.set('promotedFrom', 'development');
    staging.set('deployed', false);

    expect(staging.get('version')).toBe('1.2.3');
    expect(staging.get('promotedFrom')).toBe('development');
    expect(staging.get('deployed')).toBe(false);

    // Mark as deployed
    staging.set('deployed', true);

    // Promote to production
    const prod = staging.clone();
    (prod as any).name = 'production';
    prod.set('promotedFrom', 'staging');
    prod.set('deployed', false);

    expect(prod.get('version')).toBe('1.2.3');
    expect(prod.get('promotedFrom')).toBe('staging');

    // Complete promotion chain
    expect(dev.get('deployed')).toBe(true);
    expect(staging.get('deployed')).toBe(true);
    expect(prod.get('deployed')).toBe(false);
  });

  it('should handle environment comparison matrix', async () => {
    const schema = z.object({
      setting: z.string()
    });

    // Create multiple environments
    const envs = ['alpha', 'beta', 'gamma'].map((name) =>
      Environment.create({
        name,
        schema,
        config: { setting: `${name}-value` }
      })
    );

    // Build comparison matrix
    const matrix: Record<string, Record<string, boolean>> = {};

    for (const env1 of envs) {
      matrix[env1.name] = {};
      for (const env2 of envs) {
        const diff = env1.diff(env2);
        const identical =
          Object.keys(diff.modified).length === 0 &&
          Object.keys(diff.added).length === 0 &&
          diff.deleted.length === 0;
        matrix[env1.name][env2.name] = identical;
      }
    }

    // Verify diagonal (same environment)
    expect(matrix['alpha']['alpha']).toBe(true);
    expect(matrix['beta']['beta']).toBe(true);
    expect(matrix['gamma']['gamma']).toBe(true);

    // Verify off-diagonal (different environments)
    expect(matrix['alpha']['beta']).toBe(false);
    expect(matrix['alpha']['gamma']).toBe(false);
    expect(matrix['beta']['gamma']).toBe(false);
  });

  it('should handle cascading configuration changes', async () => {
    const schema = z.object({
      tier1: z.string(),
      tier2: z.string(),
      tier3: z.string()
    });

    // Base configuration
    const base = Environment.create({
      name: 'base',
      schema,
      config: {
        tier1: 'base-1',
        tier2: 'base-2',
        tier3: 'base-3'
      }
    });

    // First override (tier1)
    const override1 = base.clone();
    override1.set('tier1', 'override-1');

    // Second override (tier1 + tier2)
    const override2 = override1.clone();
    override2.set('tier2', 'override-2');

    // Third override (tier1 + tier2 + tier3)
    const override3 = override2.clone();
    override3.set('tier3', 'override-3');

    // Verify cascading
    expect(base.get('tier1')).toBe('base-1');
    expect(base.get('tier2')).toBe('base-2');
    expect(base.get('tier3')).toBe('base-3');

    expect(override1.get('tier1')).toBe('override-1');
    expect(override1.get('tier2')).toBe('base-2');
    expect(override1.get('tier3')).toBe('base-3');

    expect(override2.get('tier1')).toBe('override-1');
    expect(override2.get('tier2')).toBe('override-2');
    expect(override2.get('tier3')).toBe('base-3');

    expect(override3.get('tier1')).toBe('override-1');
    expect(override3.get('tier2')).toBe('override-2');
    expect(override3.get('tier3')).toBe('override-3');
  });
});
