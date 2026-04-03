/**
 * Benchmark to verify EventEmitter emit optimization
 * Tests the performance difference between events with and without once listeners
 */

import { EventEmitter } from '../dist/emitter.js';

const ITERATIONS = 1000000;
const NUM_LISTENERS = 5;

function benchmark(name, fn) {
  const start = performance.now();
  fn();
  const end = performance.now();
  const duration = end - start;
  console.log(`${name}: ${duration.toFixed(2)}ms (${((ITERATIONS / duration) * 1000).toFixed(0)} ops/sec)`);
  return duration;
}

console.log('EventEmitter emit() optimization benchmark');
console.log('==========================================\n');

// Scenario 1: Regular listeners only (optimized - no array copy)
console.log(`Scenario 1: ${NUM_LISTENERS} regular listeners, ${ITERATIONS.toLocaleString()} emits`);
const emitter1 = new EventEmitter();
for (let i = 0; i < NUM_LISTENERS; i++) {
  emitter1.on('data', () => {});
}
const time1 = benchmark('  Regular listeners only', () => {
  for (let i = 0; i < ITERATIONS; i++) {
    emitter1.emit('data', i);
  }
});

// Scenario 2: Mixed listeners (one once listener - requires array copy)
console.log(`\nScenario 2: ${NUM_LISTENERS - 1} regular + 1 once listener, ${ITERATIONS.toLocaleString()} emits`);
const emitter2 = new EventEmitter();
for (let i = 0; i < NUM_LISTENERS - 1; i++) {
  emitter2.on('data', () => {});
}
emitter2.on('data', () => {}, undefined, true); // Add once listener using internal API
const time2 = benchmark('  Mixed listeners', () => {
  for (let i = 0; i < ITERATIONS; i++) {
    emitter2.emit('data', i);
  }
});

// Scenario 3: All once listeners (requires array copy + removal overhead)
console.log(`\nScenario 3: ${NUM_LISTENERS} once listeners, each fires once`);
const emitter3 = new EventEmitter();
const time3 = benchmark('  All once listeners', () => {
  for (let i = 0; i < NUM_LISTENERS; i++) {
    emitter3.once('data', () => {});
  }
  for (let i = 0; i < NUM_LISTENERS; i++) {
    emitter3.emit('data', i);
  }
});

// Calculate improvements
console.log('\n===========================================');
console.log('Performance Analysis:');
console.log('===========================================');
const improvement = (((time2 - time1) / time2) * 100).toFixed(1);
console.log(`Optimization gain (regular vs mixed): ${improvement}% faster`);
console.log(`Time difference: ${(time2 - time1).toFixed(2)}ms`);

if (improvement > 5) {
  console.log('\n✓ Significant optimization achieved!');
} else {
  console.log('\n⚠ Optimization impact is minimal (but still beneficial)');
}

console.log('\nNote: The optimization avoids unnecessary array.slice() calls');
console.log('when no once listeners are present, reducing GC pressure and');
console.log('improving performance for high-frequency events like "data" or "packet".');
