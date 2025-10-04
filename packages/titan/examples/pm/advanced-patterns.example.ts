/**
 * Advanced Process Manager Patterns
 *
 * This example demonstrates different architectural patterns for using
 * the Process Manager, from simple services to complex applications.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createProcessManager } from '../../src/modules/pm/index.js';

// Import types
import type CalculatorProcess from './processes/calculator.process.js';
import type DatabaseProcess from './processes/database.process.js';
import type TitanAppProcess from './processes/titan-app.process.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('='.repeat(60));
  console.log('Process Manager: Architectural Patterns');
  console.log('='.repeat(60));

  // Create PM with minimal config - let processes handle their own complexity
  const pm = createProcessManager({
    isolation: 'worker',  // Use worker threads for speed
    transport: 'ipc',     // Fast local communication
    monitoring: {
      healthCheck: true,
      metrics: true
    }
  } as any);

  // ============================================================================
  // Pattern 1: Simple Stateless Service
  // ============================================================================
  console.log('\n1. SIMPLE STATELESS SERVICE');
  console.log('-'.repeat(40));

  const calculator = await pm.spawn<CalculatorProcess>(
    resolve(__dirname, './processes/calculator.process.js')
  );

  console.log('✓ Calculator service started');
  const result = await calculator.add(10, 20);
  console.log(`  10 + 20 = ${result}`);

  // ============================================================================
  // Pattern 2: Stateful Service with Dependencies
  // ============================================================================
  console.log('\n2. STATEFUL SERVICE WITH DEPENDENCIES');
  console.log('-'.repeat(40));

  const database = await pm.spawn<DatabaseProcess>(
    resolve(__dirname, './processes/database.process.js'),
    {
      dependencies: {
        config: {
          host: 'localhost',
          port: 5432,
          database: 'example'
        }
      }
    }
  );

  console.log('✓ Database service started with configuration');
  const user = await database.createUser({
    name: 'Alice',
    email: 'alice@example.com'
  });
  console.log(`  Created user: ${user.name} (${user.id})`);

  // ============================================================================
  // Pattern 3: Process as Full Titan Application
  // ============================================================================
  console.log('\n3. PROCESS AS FULL TITAN APPLICATION');
  console.log('-'.repeat(40));

  const titanApp = await pm.spawn<TitanAppProcess>(
    resolve(__dirname, './processes/titan-app.process.js'),
    {
      dependencies: {
        config: {
          // Could pass Redis config, Discovery config, etc.
          // The process will create its own Titan app with these configs
        }
      }
    }
  );

  console.log('✓ Titan application process started');

  // The process is a full microservice with business logic
  const newUser = await titanApp.onboardUser({
    name: 'Bob Smith',
    email: 'bob@example.com',
    phone: '+1234567890'
  });
  console.log(`  Onboarded user: ${newUser.name}`);

  const dashboard = await titanApp.getUserDashboard(newUser.id);
  console.log(`  Dashboard stats: ${dashboard.stats.loginCount} logins`);

  const appInfo = await titanApp.getAppInfo();
  console.log(`  Internal modules: ${appInfo.modules.join(', ')}`);

  // ============================================================================
  // Pattern 4: Service Discovery (Local)
  // ============================================================================
  console.log('\n4. SERVICE DISCOVERY');
  console.log('-'.repeat(40));

  // Services can discover each other locally
  const discoveredCalc = await pm.discover<CalculatorProcess>('calculator');
  if (discoveredCalc) {
    console.log('✓ Found calculator service via local discovery');
    const sum = await discoveredCalc.multiply(5, 5);
    console.log(`  5 × 5 = ${sum}`);
  }

  // For distributed discovery, use the Discovery module at app level
  console.log('  Note: For distributed discovery, integrate Discovery module');

  // ============================================================================
  // Pattern 5: Process Pools for Scaling
  // ============================================================================
  console.log('\n5. PROCESS POOLS');
  console.log('-'.repeat(40));

  // Create a pool of calculator processes
  const calcPool = await pm.pool<CalculatorProcess>(
    resolve(__dirname, './processes/calculator.process.js'),
    {
      size: 3,
      strategy: 'round-robin' as any
    }
  );

  console.log(`✓ Created pool with ${calcPool.size} calculator workers`);

  // Requests are automatically load-balanced
  const poolResults = await Promise.all([
    calcPool['add'](1, 1),
    calcPool['add'](2, 2),
    calcPool['add'](3, 3),
    calcPool['add'](4, 4),
    calcPool['add'](5, 5)
  ]);

  console.log(`  Pool results: ${poolResults.join(', ')}`);

  // ============================================================================
  // Pattern 6: Health Monitoring
  // ============================================================================
  console.log('\n6. HEALTH MONITORING');
  console.log('-'.repeat(40));

  const calcHealth = await pm.getHealth(calculator.__processId);
  console.log(`  Calculator: ${calcHealth?.status}`);

  const dbHealth = await pm.getHealth(database.__processId);
  console.log(`  Database: ${dbHealth?.status}`);

  const appHealth = await pm.getHealth(titanApp.__processId);
  console.log(`  Titan App: ${appHealth?.status}`);
  if (appHealth) {
    for (const check of appHealth.checks) {
      console.log(`    - ${check.name}: ${check.status} (${check.message})`);
    }
  }

  // ============================================================================
  // Pattern 7: Metrics Collection
  // ============================================================================
  console.log('\n7. METRICS');
  console.log('-'.repeat(40));

  const processes = pm.listProcesses();
  console.log(`Total processes: ${processes.length}`);

  for (const proc of processes) {
    const metrics = await pm.getMetrics(proc.id);
    if (metrics) {
      console.log(`  ${proc.name}:`);
      console.log(`    CPU: ${metrics.cpu.toFixed(2)}%`);
      console.log(`    Memory: ${(metrics.memory / 1024 / 1024).toFixed(2)}MB`);
    }
  }

  // ============================================================================
  // Key Architecture Insights
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('KEY INSIGHTS');
  console.log('='.repeat(60));

  console.log(`
1. SEPARATION OF CONCERNS:
   - PM handles: process lifecycle, IPC, monitoring, scaling
   - Process handles: business logic, services, application

2. FLEXIBILITY:
   - Process can be as simple as a single function
   - Process can be as complex as a full Titan application
   - Same PM interface works for both

3. NO DISCOVERY IN PM:
   - PM only provides local process registry
   - For distributed discovery, use Discovery module in your app/process
   - This keeps PM focused on process orchestration

4. BUSINESS LOGIC FREEDOM:
   - Each process can use any framework/library
   - Each process can have its own DI container
   - Each process can integrate with any external service

5. SCALABILITY:
   - Start with simple processes
   - Evolve to complex microservices as needed
   - PM scales with your architecture
`);

  // ============================================================================
  // Cleanup
  // ============================================================================
  console.log('SHUTTING DOWN...');
  console.log('-'.repeat(40));

  await pm.shutdown({ timeout: 5000 });
  console.log('✓ All processes shut down gracefully');
}

// Run the examples
main().catch(console.error);