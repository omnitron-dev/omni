/**
 * Fork Worker Script for VM Isolation
 *
 * This script runs in a forked child process for VM isolation.
 * It reads configuration from environment variables since fork doesn't support workerData.
 */

import 'reflect-metadata';
import type { MessageHandler } from './common-types.js';
import { isOperationalError } from '@omnitron-dev/titan/utils';

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

// Diagnostic catch-all. Operational errors (network/db disconnects)
// are logged at WARN and the worker keeps running — its underlying
// clients reconnect on their own. Programming errors trigger exit(1)
// so the supervisor restarts the worker per its policy. Classification
// is shared with titan/Application so behavior is uniform across the
// daemon AND every child process it forks.
process.on('uncaughtException', (error) => {
  if (isOperationalError(error)) {
    process.stderr.write(JSON.stringify({
      level: 40,
      time: new Date().toISOString(),
      pid: process.pid,
      msg: 'Uncaught operational exception in fork-worker — letting client recover',
      err: { message: error.message, stack: error.stack, type: error.name },
    }) + '\n');
    return;
  }
  process.stderr.write(JSON.stringify({
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    msg: 'Uncaught exception in fork-worker',
    err: { message: error.message, stack: error.stack, type: error.name },
  }) + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (isOperationalError(reason)) {
    process.stderr.write(JSON.stringify({
      level: 40,
      time: new Date().toISOString(),
      pid: process.pid,
      msg: 'Unhandled operational rejection in fork-worker — letting client recover',
      err: reason instanceof Error
        ? { message: reason.message, stack: reason.stack, type: reason.name }
        : { message: String(reason) },
    }) + '\n');
    return;
  }
  process.stderr.write(JSON.stringify({
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    msg: 'Unhandled rejection in fork-worker',
    err: reason instanceof Error
      ? { message: reason.message, stack: reason.stack, type: reason.name }
      : { message: String(reason) },
  }) + '\n');
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
