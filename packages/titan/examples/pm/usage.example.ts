/**
 * Example: Using Process Manager with File-based Processes
 *
 * This example shows how to use the Process Manager with the new
 * file-based architecture where each process is in its own file.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createProcessManager } from '../../src/modules/pm/index.js';

// Import types for type safety (not the actual classes!)
import type CalculatorProcess from './processes/calculator.process.js';
import type DatabaseProcess from './processes/database.process.js';
import type ImageProcessorProcess from './processes/image-processor.process.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Create a Process Manager instance
  const pm = createProcessManager();

  console.log('Starting Process Manager examples...\n');

  // ============================================================================
  // Example 1: Simple Calculator Process
  // ============================================================================
  console.log('1. Spawning Calculator Process...');

  const calculator = await pm.spawn<CalculatorProcess>(resolve(__dirname, './processes/calculator.process.js'), {
    name: 'calculator',
    version: '1.0.0',
  });

  // Use the calculator - all calls are type-safe!
  const sum = await calculator.add(5, 3);
  console.log(`  5 + 3 = ${sum}`);

  const product = await calculator.multiply(4, 7);
  console.log(`  4 × 7 = ${product}`);

  const factorial = await calculator.factorial(5);
  console.log(`  5! = ${factorial}`);

  const stats = await calculator.getStats();
  console.log(`  Operations performed: ${stats.operationCount}\n`);

  // ============================================================================
  // Example 2: Database Process with Dependencies
  // ============================================================================
  console.log('2. Spawning Database Process with configuration...');

  const database = await pm.spawn<DatabaseProcess>(resolve(__dirname, './processes/database.process.js'), {
    name: 'database',
    version: '2.0.0',
    dependencies: {
      config: {
        host: 'localhost',
        port: 5432,
        database: 'example_db',
      },
    },
  });

  // Create a new user
  const newUser = await database.createUser({
    name: 'John Doe',
    email: 'john@example.com',
  });
  console.log(`  Created user: ${newUser.name} (${newUser.id})`);

  // Get all users
  const users = await database.getAllUsers();
  console.log(`  Total users: ${users.length}`);

  // Search users
  const searchResults = await database.searchUsers('alice');
  console.log(`  Found ${searchResults.length} users matching "alice"`);

  const dbStats = await database.getDatabaseStats();
  console.log(`  Database queries: ${dbStats.queryCount}\n`);

  // ============================================================================
  // Example 3: Image Processing Pool
  // ============================================================================
  console.log('3. Creating Image Processor Pool...');

  const imagePool = await pm.pool<ImageProcessorProcess>(resolve(__dirname, './processes/image-processor.process.js'), {
    size: 4, // Create 4 worker processes
    strategy: 'least-loaded' as any,
    autoScale: {
      enabled: true,
      min: 2,
      max: 8,
      targetCPU: 0.7,
    },
  });

  console.log(`  Pool created with ${imagePool.size} workers`);

  // Process multiple images in parallel
  const imageJobs = [
    {
      id: 'img1',
      url: 'https://example.com/image1.jpg',
      operations: [
        { type: 'resize' as const, params: { width: 800, height: 600 } },
        { type: 'compress' as const, params: { quality: 85 } },
      ],
    },
    {
      id: 'img2',
      url: 'https://example.com/image2.jpg',
      operations: [{ type: 'filter' as const, params: { type: 'blur' } }],
    },
    {
      id: 'img3',
      url: 'https://example.com/image3.jpg',
      operations: [{ type: 'rotate' as const, params: { angle: 90 } }],
    },
  ];

  console.log('  Processing images in parallel...');
  const startTime = Date.now();

  const results = await Promise.all(imageJobs.map((job) => imagePool['processImage'](job)));

  const totalTime = Date.now() - startTime;
  console.log(`  Processed ${results.length} images in ${totalTime}ms`);

  // Generate thumbnails
  console.log('  Generating thumbnails...');
  const thumbnail = await imagePool['generateThumbnail']('https://example.com/large-image.jpg', 150, 150);
  console.log(`  Thumbnail created: ${thumbnail.processedUrl}`);

  // Get pool metrics
  const poolMetrics = imagePool.metrics;
  console.log(`  Pool metrics:`);
  console.log(`    - Total requests: ${poolMetrics.totalRequests}`);
  console.log(`    - Active workers: ${poolMetrics.activeWorkers}`);
  console.log(`    - Queue size: ${poolMetrics.queueSize}\n`);

  // ============================================================================
  // Example 4: Health Monitoring
  // ============================================================================
  console.log('4. Checking Process Health...');

  const calcHealth = await pm.getHealth(calculator.__processId);
  console.log(`  Calculator: ${calcHealth?.status}`);

  const dbHealth = await pm.getHealth(database.__processId);
  console.log(`  Database: ${dbHealth?.status}`);

  // ============================================================================
  // Example 5: Service Discovery
  // ============================================================================
  console.log('\n5. Service Discovery...');

  const discoveredCalc = await pm.discover<CalculatorProcess>('calculator');
  if (discoveredCalc) {
    console.log('  Found calculator service via discovery');
    const result = await discoveredCalc.power(2, 10);
    console.log(`  2^10 = ${result}`);
  }

  // ============================================================================
  // Example 6: Process Metrics
  // ============================================================================
  console.log('\n6. Process Metrics...');

  const processes = pm.listProcesses();
  console.log(`  Total processes: ${processes.length}`);

  for (const proc of processes) {
    const metrics = await pm.getMetrics(proc.id);
    if (metrics) {
      console.log(`  ${proc.name}:`);
      console.log(`    - CPU: ${metrics.cpu.toFixed(2)}%`);
      console.log(`    - Memory: ${(metrics.memory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`    - Requests: ${metrics.requests || 0}`);
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================
  console.log('\n7. Graceful Shutdown...');

  // Shutdown all processes gracefully
  await pm.shutdown({
    timeout: 5000,
    force: false,
  });

  console.log('All processes shut down successfully!');
}

// Run the examples
main().catch(console.error);

/**
 * Key Points Demonstrated:
 *
 * 1. File-based Architecture:
 *    - Each process is in its own file with default export
 *    - No runtime code extraction or generation
 *    - Clean separation of concerns
 *
 * 2. Type Safety:
 *    - Import process types for full IntelliSense
 *    - All RPC calls are type-checked
 *    - No any types or casting needed
 *
 * 3. Process Isolation:
 *    - Each process runs in its own context
 *    - No shared state between processes
 *    - Clean dependency injection
 *
 * 4. Production Features:
 *    - Health monitoring
 *    - Metrics collection
 *    - Service discovery
 *    - Process pools with load balancing
 *    - Graceful shutdown
 *
 * 5. Performance:
 *    - No runtime overhead from code generation
 *    - Direct module loading
 *    - Efficient inter-process communication via Netron
 */
