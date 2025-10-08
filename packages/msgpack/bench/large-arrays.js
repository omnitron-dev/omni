import * as msgpackr from 'msgpackr';
import { performance } from 'perf_hooks';
import { encode, decode } from '../dist/index.js';

// Create large array test data (like the test case that was failing)
const createLargeArray = (size) => {
  const array = [];
  for (let i = 0; i < size; i++) {
    array.push(42);
  }
  return array;
};

// Test data - same as the failing test
const testData = {
  first: createLargeArray(0xffff + 42),  // 65577 elements
  second: createLargeArray(0xffff + 42),
};

console.log('Testing with large arrays (65577 elements each)...\n');

// Warmup
for (let i = 0; i < 10; i++) {
  encode(testData);
  msgpackr.pack(testData);
}

// Function to measure performance
function measurePerformance(name, operation, iterations = 1000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    operation();
  }
  const end = performance.now();
  return {
    name,
    time: end - start,
    opsPerSec: iterations / ((end - start) / 1000)
  };
}

// Run benchmarks with fewer iterations due to large data
const results = [
  measurePerformance('Omnitron Serialize', () => encode(testData), 1000),
  measurePerformance('MessagePackR Serialize', () => msgpackr.pack(testData), 1000),
  measurePerformance('Omnitron Deserialize', () => decode(encode(testData)), 1000),
  measurePerformance('MessagePackR Deserialize', () => msgpackr.unpack(msgpackr.pack(testData)), 1000),
];

// Output results
console.log('Benchmark Results (Large Arrays):');
console.log('==================================');
results.forEach(result => {
  console.log(`${result.name}:`);
  console.log(`  Total Time: ${result.time.toFixed(2)}ms`);
  console.log(`  Ops/sec: ${result.opsPerSec.toFixed(2)}`);
  console.log(`  Avg per op: ${(result.time / 1000).toFixed(2)}ms`);
  console.log('----------------------------------');
});

// Calculate relative performance
const omniSerTime = results[0].time;
const msgpackrSerTime = results[1].time;
const omniDeserTime = results[2].time;
const msgpackrDeserTime = results[3].time;

console.log('\nPerformance Comparison:');
console.log('=======================');
console.log(`Serialize: Omnitron is ${(msgpackrSerTime / omniSerTime).toFixed(2)}x vs MessagePackR`);
console.log(`Deserialize: Omnitron is ${(msgpackrDeserTime / omniDeserTime).toFixed(2)}x vs MessagePackR`);

// Compare sizes
const omniSize = encode(testData).length;
const msgpackrSize = msgpackr.pack(testData).length;

console.log('\nSize Comparison:');
console.log('================');
console.log(`Omnitron: ${omniSize} bytes`);
console.log(`MessagePackR: ${msgpackrSize} bytes`);
console.log(`Difference: ${omniSize - msgpackrSize} bytes`);
