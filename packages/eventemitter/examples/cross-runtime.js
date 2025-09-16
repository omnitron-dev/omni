#!/usr/bin/env node

/**
 * Cross-runtime EventEmitter example
 * Works in Node.js, Bun, and Deno
 */

// Runtime detection
const runtime = (() => {
  if (typeof Bun !== 'undefined') return 'Bun';
  if (typeof Deno !== 'undefined') return 'Deno';
  if (typeof process !== 'undefined' && process.versions?.node) return 'Node.js';
  return 'Unknown';
})();

console.log(`Running in ${runtime} runtime`);

// Import EventEmitter (adjust path for your setup)
import { EventEmitter, EnhancedEmitter } from '../dist/index.js';

// Create instances
const emitter = new EventEmitter();
const enhanced = new EnhancedEmitter();

// Basic usage example
console.log('\n--- Basic EventEmitter ---');

emitter.on('hello', (name) => {
  console.log(`Hello, ${name}!`);
});

emitter.emit('hello', runtime);

// Async example
console.log('\n--- Async Events ---');

emitter.on('async-task', async (task) => {
  console.log(`Starting ${task}...`);
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(`Completed ${task}!`);
});

await emitter.emitAsync('async-task', 'data processing');

// Enhanced emitter with namespaces
console.log('\n--- Enhanced Features ---');

enhanced.on('app:user:login', (user) => {
  console.log(`User logged in: ${user}`);
});

enhanced.on('app:user:logout', (user) => {
  console.log(`User logged out: ${user}`);
});

// Emit to all user events
enhanced.emit('app:user:*', 'John Doe');

// Wildcard support
console.log('\n--- Wildcard Events ---');

enhanced.on('system.*', (event, data) => {
  console.log(`System event: ${event} with data:`, data);
});

enhanced.emit('system.startup', { time: Date.now() });
enhanced.emit('system.ready', { status: 'ok' });

// Once listener
console.log('\n--- Once Listener ---');

const promise = emitter.once('data');
setTimeout(() => {
  emitter.emit('data', 'async value');
}, 50);

const [result] = await promise;
console.log(`Received once: ${result}`);

// Metrics example
console.log('\n--- Metrics ---');

if (enhanced.metrics) {
  enhanced.metrics.enable();
  
  // Generate some events
  for (let i = 0; i < 5; i++) {
    enhanced.emit('metric-test', i);
  }
  
  const summary = enhanced.metrics.getSummary();
  console.log('Event metrics:', summary);
}

// Error handling
console.log('\n--- Error Handling ---');

enhanced.on('error', (error) => {
  console.error('Error caught:', error.message);
});

enhanced.on('risky-operation', () => {
  throw new Error('Something went wrong!');
});

try {
  enhanced.emit('risky-operation');
} catch (error) {
  console.log('Error handled gracefully');
}

// Cleanup
console.log('\n--- Cleanup ---');

emitter.removeAllListeners();
enhanced.removeAllListeners();

console.log(`\n✅ All examples completed successfully in ${runtime}!`);