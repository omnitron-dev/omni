import { Serializer } from '../src/index.js';
import { SmartBuffer } from '../src/smart-buffer.js';

const ser = new Serializer();

// Test 1: Encode array without SmartBuffer
const arr = ['emit', 'service:expose', { name: 'service1' }];
const encoded1 = ser.encode(arr);
console.log('Test 1: Direct encode');
console.log('  Array:', arr);
console.log('  Encoded length:', encoded1.length);
console.log('  First 20 bytes:', encoded1.slice(0, 20));
console.log('  First byte:', '0x' + encoded1[0]!.toString(16), '(should be 0x93 for fixarray with 3 elements)');

// Test 2: Encode array with SmartBuffer
const buf = new SmartBuffer(256);
buf.writeUInt32BE(1); // packet ID
buf.writeUInt8(0x40); // flags
ser.encode(arr, buf);
const encoded2 = buf.toBuffer();
console.log('\nTest 2: Encode with SmartBuffer');
console.log('  Total length:', encoded2.length);
console.log('  Bytes 5-25 (after header):', encoded2.slice(5, 25));
console.log('  Byte 5:', '0x' + encoded2[5]!.toString(16), '(should be 0x93 for fixarray with 3 elements)');

// Test 3: Decode back
const decoded1 = ser.decode(encoded1);
console.log('\nTest 3: Decode');
console.log('  Decoded:', decoded1);
console.log('  Match:', JSON.stringify(decoded1) === JSON.stringify(arr));
