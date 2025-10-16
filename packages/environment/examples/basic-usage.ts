/**
 * Basic Usage Example
 *
 * Demonstrates simple environment creation, configuration, and persistence.
 */

import { Environment } from '../src/index.js';
import { z } from 'zod';

// Define schema for type safety
const schema = z.object({
  app: z.object({
    name: z.string(),
    version: z.string(),
    port: z.number().min(1).max(65535),
  }),
  database: z.object({
    host: z.string(),
    port: z.number(),
    name: z.string(),
  }),
});

async function main() {
  console.log('=== Basic Environment Usage ===\n');

  // 1. Create a new environment
  console.log('1. Creating environment...');
  const env = Environment.create({
    name: 'my-app-dev',
    version: '1.0.0',
    schema,
    config: {
      app: {
        name: 'MyApplication',
        version: '1.0.0',
        port: 3000,
      },
      database: {
        host: 'localhost',
        port: 5432,
        name: 'myapp_dev',
      },
    },
  });

  console.log(`✓ Environment '${env.name}' created`);
  console.log(`  ID: ${env.id}`);
  console.log(`  Version: ${env.version}\n`);

  // 2. Read configuration values
  console.log('2. Reading configuration...');
  console.log(`  App Name: ${env.get('app.name')}`);
  console.log(`  App Port: ${env.get('app.port')}`);
  console.log(`  Database Host: ${env.get('database.host')}\n`);

  // 3. Update configuration
  console.log('3. Updating configuration...');
  env.set('app.port', 4000);
  env.set('database.host', 'dev-db.example.com');
  console.log(`  ✓ Port updated to: ${env.get('app.port')}`);
  console.log(`  ✓ Database host updated to: ${env.get('database.host')}\n`);

  // 4. Validate configuration
  console.log('4. Validating configuration...');
  const validation = await env.validate();
  if (validation.valid) {
    console.log('  ✓ Configuration is valid\n');
  } else {
    console.log('  ✗ Validation errors:');
    validation.errors?.forEach((err) => console.log(`    - ${err.message}`));
  }

  // 5. Save to disk
  console.log('5. Saving to disk...');
  const savePath = './examples/output/my-app-dev.yaml';
  await env.save(savePath);
  console.log(`  ✓ Saved to: ${savePath}\n`);

  // 6. Load from disk
  console.log('6. Loading from disk...');
  const loaded = await Environment.fromFile(savePath, { schema });
  console.log(`  ✓ Loaded environment: ${loaded.name}`);
  console.log(`  ✓ App port: ${loaded.get('app.port')}\n`);

  // 7. Clone environment
  console.log('7. Cloning environment...');
  const cloned = env.clone();
  console.log(`  ✓ Cloned as: ${cloned.name}`);
  console.log(`  ✓ Independent copy: ${cloned.id !== env.id}\n`);

  // 8. Export configuration
  console.log('8. Exporting configuration...');
  const yaml = env.toYAML();
  console.log('  YAML output:');
  console.log(
    yaml
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
  );

  console.log('\n=== Example Complete ===');
}

// Run the example
main().catch(console.error);
