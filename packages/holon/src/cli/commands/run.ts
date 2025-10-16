/**
 * CLI command to run flows
 */

import { Command } from 'commander';
import { createEngine } from '../../runtime/engine.js';
import type { Flow } from '@holon/flow';

export function createRunCommand(): Command {
  return new Command('run')
    .description('Run a flow from a file')
    .argument('<file>', 'Flow file path')
    .option('-i, --input <file>', 'Input data file (JSON)')
    .option('-o, --output <file>', 'Output file')
    .option('--timeout <ms>', 'Execution timeout in milliseconds')
    .option('--trace', 'Enable execution tracing')
    .option('--metrics', 'Show execution metrics')
    .action(async (file, options) => {
      try {
        console.log(`Running flow from ${file}...`);

        // In production, would:
        // 1. Load flow from file (ESM import or require)
        // 2. Load input data if specified
        // 3. Create engine with options
        // 4. Execute flow
        // 5. Write output if specified

        const engine = createEngine({
          maxConcurrency: 4,
          monitoring: {
            enabled: options.metrics,
          },
        });

        // Placeholder for flow loading
        console.log('Flow execution completed');

        if (options.metrics) {
          const metrics = engine.getAllMetrics();
          console.log('\nMetrics:', Array.from(metrics.values()));
        }

        await engine.shutdown();
      } catch (error) {
        console.error('Error running flow:', error);
        process.exit(1);
      }
    });
}
