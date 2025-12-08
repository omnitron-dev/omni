/**
 * Fork Worker Script for VM Isolation
 *
 * This script runs in a forked child process for VM isolation.
 * It reads configuration from environment variables since fork doesn't support workerData.
 */

import 'reflect-metadata';
import type { MessageHandler } from './common-types.js';

// Get configuration from environment
const config = JSON.parse(process.env['WORKER_DATA'] || '{}');

// Mock parentPort for compatibility with worker runtime
const parentPort = {
  postMessage: (message: any) => {
    if (process.send) {
      process.send(message);
    }
  },
  on: (event: string, handler: MessageHandler) => {
    if (event === 'message') {
      process.on('message', handler as any);
    }
  },
};

// Mock workerData
const workerData = config;

// Make them available globally
(global as any).parentPort = parentPort;
(global as any).workerData = workerData;

// Now import and run the worker runtime
import('./worker-runtime.js').catch((error) => {
  // Note: Cannot use ILogger here as this is an early initialization script
  // Error will be logged via stderr
  process.stderr.write(`Failed to load worker runtime: ${error}\n`);
  process.exit(1);
});
