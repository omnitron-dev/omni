/**
 * Comprehensive benchmark comparing emit performance with different listener configurations
 */

import { EventEmitter } from '../dist/emitter.js';

function benchmark(name, fn) {
  const start = performance.now();
  fn();
  const end = performance.now();
  const duration = end - start;
  return duration;
}

console.log('EventEmitter emit() Optimization Benchmark');
console.log('==========================================\n');

// Test with different listener counts
const configs = [
  { listeners: 3, iterations: 1000000 },
  { listeners: 5, iterations: 1000000 },
  { listeners: 10, iterations: 500000 },
  { listeners: 20, iterations: 250000 },
];

console.log('Comparing regular listeners vs. mixed (with once listener)\n');

for (const { listeners, iterations } of configs) {
  console.log(`Configuration: ${listeners} listeners, ${iterations.toLocaleString()} emits`);

  // Test 1: All regular listeners
  const emitter1 = new EventEmitter();
  for (let i = 0; i < listeners; i++) {
    emitter1.on('data', () => {});
  }

  const regularTime = benchmark('  Regular only', () => {
    for (let i = 0; i < iterations; i++) {
      emitter1.emit('data', i);
    }
  });

  // Test 2: Regular + one once listener (persistent)
  const emitter2 = new EventEmitter();
  for (let i = 0; i < listeners - 1; i++) {
    emitter2.on('data', () => {});
  }
  emitter2.on('data', () => {}, undefined, true);

  const mixedTime = benchmark('  With once listener', () => {
    for (let i = 0; i < iterations; i++) {
      emitter2.emit('data', i);
    }
  });

  const improvement = (((mixedTime - regularTime) / mixedTime) * 100).toFixed(1);
  const opsRegular = Math.round((iterations / regularTime) * 1000);
  const opsMixed = Math.round((iterations / mixedTime) * 1000);

  console.log(`  Regular:  ${regularTime.toFixed(2)}ms (${opsRegular.toLocaleString()} ops/sec)`);
  console.log(`  Mixed:    ${mixedTime.toFixed(2)}ms (${opsMixed.toLocaleString()} ops/sec)`);
  console.log(`  Speedup:  ${improvement}% faster without once listeners`);
  console.log();
}

console.log('===========================================');
console.log('Summary:');
console.log('===========================================');
console.log('The optimization tracks whether once listeners exist for each event.');
console.log('When no once listeners are present, it avoids creating array copies,');
console.log('reducing memory allocations and GC pressure.');
console.log('\nBenefits:');
console.log('- Reduced memory allocations on emit()');
console.log('- Lower GC pressure for high-frequency events');
console.log('- Better cache locality (no array copying)');
console.log('- Measurable improvement for events with many listeners');
