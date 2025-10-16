/**
 * Multi-Environment Management Example
 *
 * Demonstrates managing multiple environments (dev, staging, prod)
 * with inheritance, merging, and diffing.
 */

import { Environment } from '../src/index.js';
import { z } from 'zod';

const schema = z.object({
  environment: z.string(),
  app: z.object({
    name: z.string(),
    version: z.string(),
    debug: z.boolean()
  }),
  server: z.object({
    host: z.string(),
    port: z.number(),
    workers: z.number()
  }),
  database: z.object({
    host: z.string(),
    port: z.number(),
    name: z.string(),
    poolSize: z.number()
  })
});

async function main() {
  console.log('=== Multi-Environment Management ===\n');

  // 1. Create base configuration
  console.log('1. Creating base environment...');
  const base = Environment.create({
    name: 'base',
    schema,
    config: {
      environment: 'base',
      app: {
        name: 'MyApp',
        version: '2.0.0',
        debug: false
      },
      server: {
        host: '0.0.0.0',
        port: 3000,
        workers: 2
      },
      database: {
        host: 'localhost',
        port: 5432,
        name: 'myapp',
        poolSize: 10
      }
    }
  });
  console.log('  ✓ Base environment created\n');

  // 2. Create development environment
  console.log('2. Creating development environment...');
  const dev = Environment.create({
    name: 'development',
    schema,
    config: {
      environment: 'development',
      app: {
        name: 'MyApp',
        version: '2.0.0',
        debug: true
      },
      server: {
        host: '0.0.0.0',
        port: 3001,
        workers: 2
      },
      database: {
        host: 'localhost',
        port: 5432,
        name: 'myapp_dev',
        poolSize: 5
      }
    }
  });
  console.log('  ✓ Development environment created\n');

  // 3. Create production environment
  console.log('3. Creating production environment...');
  const prod = Environment.create({
    name: 'production',
    schema,
    config: {
      environment: 'production',
      app: {
        name: 'MyApp',
        version: '2.0.0',
        debug: false
      },
      server: {
        host: '0.0.0.0',
        port: 8080,
        workers: 16
      },
      database: {
        host: 'prod-db.example.com',
        port: 5432,
        name: 'myapp_prod',
        poolSize: 100
      }
    }
  });
  console.log('  ✓ Production environment created\n');

  // 4. Merge base with dev
  console.log('4. Merging base + development...');
  const mergedDev = base.merge(dev);
  console.log(`  ✓ Environment: ${mergedDev.get('environment')}`);
  console.log(`  ✓ Debug mode: ${mergedDev.get('app.debug')}`);
  console.log(`  ✓ Database: ${mergedDev.get('database.name')}\n`);

  // 5. Diff development vs production
  console.log('5. Comparing development vs production...');
  const diff = dev.diff(prod);
  console.log(`  Modified keys:`);
  Object.keys(diff.modified).forEach((key) => {
    const change = diff.modified[key];
    console.log(`    ${key}: ${change.before} → ${change.after}`);
  });
  console.log('');

  // 6. Apply diff (promote dev to prod-like)
  console.log('6. Applying diff to development...');
  const promoted = dev.patch(diff);
  console.log(`  ✓ Environment: ${promoted.get('environment')}`);
  console.log(`  ✓ Server port: ${promoted.get('server.port')}`);
  console.log(`  ✓ Workers: ${promoted.get('server.workers')}\n`);

  // 7. Compare multiple environments
  console.log('7. Environment comparison matrix:');
  const environments = [
    { name: 'Development', env: dev },
    { name: 'Production', env: prod }
  ];

  console.log('  Feature              | Development  | Production');
  console.log('  ---------------------|--------------|-------------');
  console.log(`  Debug Mode          | ${dev.get('app.debug') ? 'Yes' : 'No '} | ${prod.get('app.debug') ? 'Yes' : 'No '}`);
  console.log(`  Server Port         | ${dev.get('server.port')}        | ${prod.get('server.port')}`);
  console.log(`  Workers             | ${dev.get('server.workers')}           | ${prod.get('server.workers')}`);
  console.log(`  DB Pool Size        | ${dev.get('database.poolSize')}           | ${prod.get('database.poolSize')}`);
  console.log('');

  // 8. Clone for testing
  console.log('8. Cloning production for testing...');
  const testEnv = prod.clone();
  testEnv.set('environment', 'testing');
  testEnv.set('database.name', 'myapp_test');
  console.log(`  ✓ Created: ${testEnv.name}`);
  console.log(`  ✓ Database: ${testEnv.get('database.name')}\n`);

  console.log('=== Example Complete ===');
}

// Run the example
main().catch(console.error);
