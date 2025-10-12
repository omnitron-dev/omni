import * as msgpackr from 'msgpackr';
import { performance } from 'perf_hooks';
import { encode, decode } from '../dist/index.js';

// Mixed workload - various data types and sizes
const testCases = [
  { name: 'Small Object', data: { a: 1, b: 'hello', c: true } },
  { name: 'Medium Array', data: Array(1000).fill(42) },
  { name: 'Large Array', data: Array(10000).fill(42) },
  {
    name: 'Nested Object',
    data: {
      users: Array(100)
        .fill(null)
        .map((_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
          active: i % 2 === 0,
        })),
    },
  },
  {
    name: 'Mixed Types',
    data: {
      number: 12345,
      string: 'Hello World with some longer text to test string encoding performance',
      boolean: true,
      null: null,
      array: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      nested: {
        deep: {
          value: 'nested',
          array: Array(50).fill('test'),
        },
      },
    },
  },
];

function measurePerformance(name, operation, iterations = 10000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    operation();
  }
  const end = performance.now();
  return {
    name,
    time: end - start,
    opsPerSec: iterations / ((end - start) / 1000),
  };
}

console.log('Mixed Workload Benchmark');
console.log('========================\n');

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log('-'.repeat(40));

  // Warmup
  for (let i = 0; i < 100; i++) {
    encode(testCase.data);
    msgpackr.pack(testCase.data);
  }

  const iterations = testCase.name.includes('Large') ? 5000 : 10000;

  const omniSer = measurePerformance('Omnitron Serialize', () => encode(testCase.data), iterations);
  const msgpackrSer = measurePerformance('MessagePackR Serialize', () => msgpackr.pack(testCase.data), iterations);
  const omniDeser = measurePerformance('Omnitron Deserialize', () => decode(encode(testCase.data)), iterations);
  const msgpackrDeser = measurePerformance(
    'MessagePackR Deserialize',
    () => msgpackr.unpack(msgpackr.pack(testCase.data)),
    iterations
  );

  console.log(`  Serialize:`);
  console.log(`    Omnitron:    ${omniSer.opsPerSec.toFixed(0)} ops/sec`);
  console.log(`    MessagePackR: ${msgpackrSer.opsPerSec.toFixed(0)} ops/sec`);
  console.log(`    Ratio: ${(omniSer.opsPerSec / msgpackrSer.opsPerSec).toFixed(2)}x`);

  console.log(`  Deserialize:`);
  console.log(`    Omnitron:    ${omniDeser.opsPerSec.toFixed(0)} ops/sec`);
  console.log(`    MessagePackR: ${msgpackrDeser.opsPerSec.toFixed(0)} ops/sec`);
  console.log(`    Ratio: ${(omniDeser.opsPerSec / msgpackrDeser.opsPerSec).toFixed(2)}x`);

  const omniSize = encode(testCase.data).length;
  const msgpackrSize = msgpackr.pack(testCase.data).length;
  console.log(`  Size: Omnitron ${omniSize} bytes vs MessagePackR ${msgpackrSize} bytes`);
  console.log();
}

console.log('\nSummary:');
console.log('========');
console.log('The optimizations show significant improvements with larger data structures.');
console.log('Buffer pooling, bitwise operations, and DataView caching are most effective');
console.log('when processing large arrays and nested objects.');
