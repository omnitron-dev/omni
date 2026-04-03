/**
 * Fork Worker Script for VM Isolation
 *
 * This script runs in a forked child process for VM isolation.
 * It reads configuration from environment variables since fork doesn't support workerData.
 */

import 'reflect-metadata';
import type { MessageHandler } from './common-types.js';

// Get configuration from environment (spawner passes TITAN_WORKER_CONTEXT)
const config = JSON.parse(process.env['TITAN_WORKER_CONTEXT'] || process.env['WORKER_DATA'] || '{}');

// Validate required fields (D3)
if (!config || !config.processId || !config.processPath) {
  const entry = JSON.stringify({
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    msg: 'Invalid TITAN_WORKER_CONTEXT — missing processId or processPath',
  });
  process.stderr.write(entry + '\n');
  process.exit(1);
}

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

// Exit when parent process disconnects (prevents orphaned processes)
process.on('disconnect', () => {
  process.exit(0);
});

// Catch unhandled errors for diagnostics
process.on('uncaughtException', (error) => {
  const entry = JSON.stringify({
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    msg: 'Uncaught exception in fork-worker',
    err: { message: error.message, stack: error.stack, type: error.name },
  });
  process.stderr.write(entry + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const entry = JSON.stringify({
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    msg: 'Unhandled rejection in fork-worker',
    err:
      reason instanceof Error
        ? { message: reason.message, stack: reason.stack, type: reason.name }
        : { message: String(reason) },
  });
  process.stderr.write(entry + '\n');
  process.exit(1);
});

// Now import and run the worker runtime
import('./worker-runtime.js').catch((error) => {
  const entry = JSON.stringify({
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    msg: 'Failed to load worker runtime',
    err: { message: error.message, stack: error.stack, type: error.name },
  });
  process.stderr.write(entry + '\n');
  process.exit(1);
});
