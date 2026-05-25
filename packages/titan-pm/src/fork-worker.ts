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
// IPC backpressure tracking. `process.send` returns false when Node's
// channel buffer is full (typically because the parent is paused or
// the receiver hasn't drained recent frames). Pre-fix every postMessage
// fired without a callback or buffer check, so a frame storm (metrics
// drain, log forwarding) silently dropped messages — the parent would
// see counters freeze with no indication why. Now we count drops and
// log periodically so the symptom is observable.
let droppedFrames = 0;
let lastDropLogAt = 0;
const DROP_LOG_INTERVAL_MS = 30_000;

function noteDropped(reason: string, err?: Error): void {
  droppedFrames++;
  const now = Date.now();
  if (now - lastDropLogAt < DROP_LOG_INTERVAL_MS) return;
  lastDropLogAt = now;
  process.stderr.write(
    JSON.stringify({
      level: 40,
      time: new Date().toISOString(),
      pid: process.pid,
      msg: 'IPC frame dropped',
      reason,
      droppedTotal: droppedFrames,
      ...(err && { err: { message: err.message, type: err.name } }),
    }) + '\n',
  );
}

const parentPort = {
  postMessage: (message: any) => {
    if (!process.send) return;
    if (!process.connected) {
      noteDropped('parent disconnected');
      return;
    }
    const accepted = process.send(message, (err) => {
      if (err) noteDropped('callback error', err);
    });
    if (!accepted) noteDropped('channel full (process.send returned false)');
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

// IPC disconnect handling. Pre-fix the worker called `process.exit(0)`,
// which the supervisor reads as a clean stop (expected: true) — so an
// IPC-channel break (parent killed -9, OS killed the socket, the
// daemon crashed) looked indistinguishable from a successful
// terminate. Now we exit with 130 (shell convention for "killed by
// parent"), so the supervisor's crash path runs and respawns per
// restart policy instead of marking the worker cleanly stopped and
// going silent.
process.on('disconnect', () => {
  noteDropped('parent disconnected — terminating worker');
  process.exit(130);
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
