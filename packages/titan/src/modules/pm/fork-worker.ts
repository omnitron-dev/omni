/**
 * Fork Worker Script for VM Isolation
 *
 * This script runs in a forked child process for VM isolation.
 * It reads configuration from environment variables since fork doesn't support workerData.
 */

import 'reflect-metadata';

// Get configuration from environment
const config = JSON.parse(process.env['WORKER_DATA'] || '{}');

// Mock parentPort for compatibility with worker runtime
const parentPort = {
  postMessage: (message: any) => {
    if (process.send) {
      process.send(message);
    }
  },
  on: (event: string, handler: Function) => {
    if (event === 'message') {
      process.on('message', handler as any);
    }
  }
};

// Mock workerData
const workerData = config;

// Make them available globally
(global as any).parentPort = parentPort;
(global as any).workerData = workerData;

// Now import and run the worker runtime
import('./worker-runtime.js').catch((error) => {
  console.error('Failed to load worker runtime:', error);
  process.exit(1);
});