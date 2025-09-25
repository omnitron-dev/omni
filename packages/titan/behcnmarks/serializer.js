const bson = require('bson');
const cbor = require('cbor');
const msgpackr = require('msgpackr');
const msgpack = require('@msgpack/msgpack');
const { performance } = require('perf_hooks');
const { encode, decode } = require('@omnitron-dev/messagepack');

// Create test data
const testData = {
  string: 'Hello World',
  number: 12345,
  boolean: true,
  array: [1, 2, 3, 4, 5],
  object: {
    nested: {
      value: 'nested value'
    }
  },
  date: new Date(),
  null: null,
  undefined
};

// Function to measure performance
function measurePerformance(name, operation) {
  const start = performance.now();
  for (let i = 0; i < 100000; i++) {
    operation();
  }
  const end = performance.now();
  return {
    name,
    time: end - start,
    opsPerSec: 100000 / ((end - start) / 1000)
  };
}

// JSON
const jsonSerialize = () => JSON.stringify(testData);
const jsonDeserialize = () => JSON.parse(JSON.stringify(testData));

// MessagePack
const msgpackSerialize = () => msgpack.encode(testData);
const msgpackDeserialize = () => msgpack.decode(msgpack.encode(testData));

// MessagePackR
const msgpackrSerialize = () => msgpackr.pack(testData);
const msgpackrDeserialize = () => msgpackr.unpack(msgpackr.pack(testData));

// BSON
const bsonSerialize = () => bson.serialize(testData);
const bsonDeserialize = () => bson.deserialize(bson.serialize(testData));

// CBOR
const cborSerialize = () => cbor.encode(testData);
const cborDeserialize = () => cbor.decode(cbor.encode(testData));

// Omnitron MessagePack
const omniSerialize = () => encode(testData);
const omniDeserialize = () => decode(encode(testData));

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
  measurePerformance('CBOR Serialize', cborSerialize),
  measurePerformance('CBOR Deserialize', cborDeserialize),
  measurePerformance('Omnitron MessagePack Serialize', omniSerialize),
  measurePerformance('Omnitron MessagePack Deserialize', omniDeserialize)
];

// Output results
console.log('\nBenchmark Results:');
console.log('------------------');
results.forEach(result => {
  console.log(`${result.name}:`);
  console.log(`  Time: ${result.time.toFixed(2)}ms`);
  console.log(`  Ops/sec: ${result.opsPerSec.toFixed(2)}`);
  console.log('------------------');
});

// Compare sizes
console.log('\nSize Comparison:');
console.log('------------------');
console.log(`JSON: ${JSON.stringify(testData).length} bytes`);
console.log(`MessagePack: ${msgpack.encode(testData).length} bytes`);
console.log(`MessagePackR: ${msgpackr.pack(testData).length} bytes`);
console.log(`BSON: ${bson.serialize(testData).length} bytes`);
console.log(`CBOR: ${cbor.encode(testData).length} bytes`);
console.log(`Omnitron MessagePack: ${encode(testData).length} bytes`);