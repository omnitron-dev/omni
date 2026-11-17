import * as bson from 'bson';
import * as msgpack from '@msgpack/msgpack';
import * as msgpackr from 'msgpackr';
import { performance } from 'perf_hooks';
import { encode, decode } from '../dist/index.js';

// Create test data
const testData = {
  string: 'Hello World',
  number: 12345,
  boolean: true,
  array: [1, 2, 3, 4, 5],
  object: {
    nested: {
      value: 'nested value',
    },
  },
  date: new Date('2026-01-01T00:00:00Z'),
  null: null,
  undefined,
};

// Function to measure performance
function measurePerformance(name, operation) {
  for (let i = 0; i < 1000; i++) operation();
  const start = performance.now();
  for (let i = 0; i < 100000; i++) {
    operation();
  }
  const end = performance.now();
  return {
    name,
    time: end - start,
    opsPerSec: 100000 / ((end - start) / 1000),
  };
}

// JSON
const jsonSerialize = () => JSON.stringify(testData);
const jsonBytes = jsonSerialize();
const jsonDeserialize = () => JSON.parse(jsonBytes);

// MessagePack
const msgpackSerialize = () => msgpack.encode(testData);
const msgpackBytes = msgpackSerialize();
const msgpackDeserialize = () => msgpack.decode(msgpackBytes);

// MessagePackR
const msgpackrSerialize = () => msgpackr.pack(testData);
const msgpackrBytes = msgpackrSerialize();
const msgpackrDeserialize = () => msgpackr.unpack(msgpackrBytes);

// BSON
const bsonSerialize = () => bson.serialize(testData);
const bsonBytes = bsonSerialize();
const bsonDeserialize = () => bson.deserialize(bsonBytes);

// Omnitron MessagePack
const omniSerialize = () => encode(testData);
const omniBytes = omniSerialize();
const omniDeserialize = () => decode(omniBytes);

// Run benchmarks
const results = [
  measurePerformance('JSON Serialize', jsonSerialize),
  measurePerformance('JSON Deserialize', jsonDeserialize),
  measurePerformance('MessagePack Serialize', msgpackSerialize),
  measurePerformance('MessagePack Deserialize', msgpackDeserialize),
  measurePerformance('MessagePackR Serialize', msgpackrSerialize),
  measurePerformance('MessagePackR Deserialize', msgpackrDeserialize),
  measurePerformance('BSON Serialize', bsonSerialize),
  measurePerformance('BSON Deserialize', bsonDeserialize),
  measurePerformance('Omnitron MessagePack Serialize', omniSerialize),
  measurePerformance('Omnitron MessagePack Deserialize', omniDeserialize),
];

// Output results
console.log('\nBenchmark Results:');
console.log('------------------');
results.forEach((result) => {
  console.log(`${result.name}:`);
  console.log(`  Time: ${result.time.toFixed(2)}ms`);
  console.log(`  Ops/sec: ${result.opsPerSec.toFixed(2)}`);
  console.log('------------------');
});

// Compare sizes
console.log('\nSize Comparison:');
console.log('------------------');
console.log(`JSON: ${Buffer.byteLength(jsonBytes)} bytes`);
console.log(`MessagePack: ${msgpackBytes.length} bytes`);
console.log(`MessagePackR: ${msgpackrBytes.length} bytes`);
console.log(`BSON: ${bsonBytes.length} bytes`);
console.log(`Omnitron MessagePack: ${omniBytes.length} bytes`);
