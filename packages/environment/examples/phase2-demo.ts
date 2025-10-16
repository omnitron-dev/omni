/**
 * Phase 2 Advanced Features Demo
 * Demonstrates secrets, variables, tasks, and targets layers
 */

import { Environment, LocalSecretsProvider } from '../src/index.js';
import * as path from 'node:path';

async function main() {
  console.log('=== Phase 2 Advanced Features Demo ===\n');

  // 1. Create environment with secrets provider
  console.log('1. Creating environment with secrets...');
  const secretsProvider = new LocalSecretsProvider({
    storagePath: path.join(process.cwd(), '.secrets.json'),
    password: 'demo-password',
  });

  await secretsProvider.initialize();

  const env = Environment.create({
    name: 'demo-environment',
    config: {
      app: {
        name: 'MyApp',
        version: '1.0.0',
      },
      database: {
        host: 'localhost',
        port: 5432,
      },
    },
    secretsProvider,
  });

  // 2. Work with secrets
  console.log('\n2. Managing secrets...');
  await env.secrets!.set('db.password', 'super-secret-password');
  await env.secrets!.set('api.key', 'api-key-12345');

  const dbPassword = await env.secrets!.get('db.password');
  console.log(`Database password stored: ${dbPassword ? '✓' : '✗'}`);

  // 3. Define variables
  console.log('\n3. Defining variables...');
  env.variables.define('environment', 'development');
  env.variables.define('appName', env.get('app.name'));
  env.variables.define('appVersion', env.get('app.version'));

  // Computed variable
  env.variables.defineComputed('appTitle', () => {
    return `${env.variables.get('appName')} v${env.variables.get('appVersion')}`;
  });

  console.log(`App title: ${env.variables.get('appTitle')}`);

  // Variable interpolation
  const interpolated = env.variables.interpolate('Running ${appName} in ${environment} mode');
  console.log(`Interpolated: ${interpolated}`);

  // 4. Define targets
  console.log('\n4. Defining execution targets...');
  env.targets.define('local', {
    type: 'local',
  });

  console.log('Local target defined ✓');

  // 5. Define tasks
  console.log('\n5. Defining tasks...');

  env.tasks.define('hello', {
    command: 'echo "Hello from task!"',
    description: 'Print a greeting',
  });

  env.tasks.define('info', {
    command: 'echo "App: ${appName}, Version: ${appVersion}"',
    description: 'Show app info',
  });

  env.tasks.define('build', {
    command: 'echo "Building application..."',
    description: 'Build the application',
    dependsOn: ['info'],
  });

  env.tasks.define('deploy', {
    command: 'echo "Deploying application..."',
    description: 'Deploy the application',
    dependsOn: ['build'],
  });

  // List all tasks
  const tasks = env.tasks.list();
  console.log(`Defined ${tasks.length} tasks:`);
  tasks.forEach((task) => {
    console.log(`  - ${task.name}: ${task.description}`);
  });

  // 6. Execute tasks
  console.log('\n6. Executing tasks...');

  // Execute simple task
  console.log('\nRunning "hello" task:');
  const helloResult = await env.tasks.run('hello');
  console.log(helloResult.output);

  // Execute task with dependencies
  console.log('\nRunning "deploy" task (with dependencies):');
  const executionOrder = env.tasks.getExecutionOrder(['deploy']);
  console.log(`Execution order: ${executionOrder.join(' → ')}`);

  const deployResult = await env.tasks.run('deploy');
  if (deployResult.success) {
    console.log('Deployment successful ✓');
  }

  // 7. Target execution
  console.log('\n7. Executing command on target...');
  const targetResult = await env.targets.execute('local', 'echo "Executed on target"');
  console.log(targetResult.stdout);

  // 8. Access logs
  console.log('\n8. Checking secret access logs...');
  const logs = await env.secrets!.getAccessLog('db.password');
  console.log(`Secret accessed ${logs.length} times`);

  console.log('\n=== Demo Complete ===');
}

main().catch(console.error);
