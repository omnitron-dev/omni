import { describe, it, expect } from '@jest/globals';
import { serializer } from '../src/index.js';
import { SmartBuffer } from '../src/smart-buffer.js';

describe('Large packet encoding/decoding', () => {
  it('should encode and decode a large Definition-like object', () => {
    // Create a large object similar to Definition from Titan
    const largeObject = {
      id: 'cc9c06a9-2f35-4d5e-8b1a-7e3f9d4c2a1b',
      peerId: 'n1',
      meta: {
        name: 'service1',
        version: '',
        properties: {
          name: { type: 'String', readonly: false },
          description: { type: 'String', readonly: false },
          data: { type: 'Object', readonly: false },
          isActive: { type: 'Boolean', readonly: true },
        },
        methods: {
          greet: { type: 'String', arguments: [] },
          echo: { type: 'String', arguments: ['String'] },
          addNumbers: { type: 'Number', arguments: ['Number', 'Number'] },
          concatenateStrings: { type: 'String', arguments: ['String', 'String'] },
          getBooleanValue: { type: 'Boolean', arguments: ['Boolean'] },
          getObjectProperty: { type: 'String', arguments: ['Object'] },
          getArrayElement: { type: 'Object', arguments: ['Array', 'Number'] },
          fetchData: { type: 'Promise', arguments: ['String'] },
          updateData: { type: 'void', arguments: ['String', 'Object'] },
          getDataKeys: { type: 'Array', arguments: [] },
          delay: { type: 'Promise', arguments: ['Number'] },
          fetchDataWithDelay: { type: 'Promise', arguments: ['String', 'Number'] },
          updateDataWithDelay: { type: 'Promise', arguments: ['String', 'Object', 'Number'] },
          getStatus: { type: 'String', arguments: [] },
          getPriority: { type: 'Number', arguments: [] },
          getAllStatuses: { type: 'Array', arguments: [] },
          getAllPriorities: { type: 'Array', arguments: [] },
          getUndefined: { type: 'void', arguments: [] },
          getNull: { type: 'void', arguments: [] },
          getSymbol: { type: 'Symbol', arguments: [] },
          getBigInt: { type: 'BigInt', arguments: [] },
          getDate: { type: 'Date', arguments: [] },
          getRegExp: { type: 'RegExp', arguments: [] },
          getMap: { type: 'Map', arguments: [] },
          getSet: { type: 'Set', arguments: [] },
          getPromise: { type: 'Promise', arguments: [] },
        },
      },
      parentId: '',
    };

    // Encode to buffer
    const encoded = serializer.encode(largeObject);
    console.log('Encoded buffer length:', encoded.length);
    console.log('First 20 bytes:', encoded.slice(0, 20));

    // Decode back
    const decoded = serializer.decode(encoded);
    console.log('Decoded successfully');

    expect(decoded).toEqual(largeObject);
  });

  it('should encode and decode with SmartBuffer', () => {
    const largeObject = {
      id: 'cc9c06a9-2f35-4d5e-8b1a-7e3f9d4c2a1b',
      peerId: 'n1',
      meta: {
        name: 'service1',
        version: '',
        properties: {
          name: { type: 'String', readonly: false },
          description: { type: 'String', readonly: false },
          data: { type: 'Object', readonly: false },
          isActive: { type: 'Boolean', readonly: true },
        },
        methods: {
          greet: { type: 'String', arguments: [] },
          echo: { type: 'String', arguments: ['String'] },
          addNumbers: { type: 'Number', arguments: ['Number', 'Number'] },
          concatenateStrings: { type: 'String', arguments: ['String', 'String'] },
          getBooleanValue: { type: 'Boolean', arguments: ['Boolean'] },
          getObjectProperty: { type: 'String', arguments: ['Object'] },
          getArrayElement: { type: 'Object', arguments: ['Array', 'Number'] },
          fetchData: { type: 'Promise', arguments: ['String'] },
          updateData: { type: 'void', arguments: ['String', 'Object'] },
          getDataKeys: { type: 'Array', arguments: [] },
          delay: { type: 'Promise', arguments: ['Number'] },
          fetchDataWithDelay: { type: 'Promise', arguments: ['String', 'Number'] },
          updateDataWithDelay: { type: 'Promise', arguments: ['String', 'Object', 'Number'] },
          getStatus: { type: 'String', arguments: [] },
          getPriority: { type: 'Number', arguments: [] },
          getAllStatuses: { type: 'Array', arguments: [] },
          getAllPriorities: { type: 'Array', arguments: [] },
          getUndefined: { type: 'void', arguments: [] },
          getNull: { type: 'void', arguments: [] },
          getSymbol: { type: 'Symbol', arguments: [] },
          getBigInt: { type: 'BigInt', arguments: [] },
          getDate: { type: 'Date', arguments: [] },
          getRegExp: { type: 'RegExp', arguments: [] },
          getMap: { type: 'Map', arguments: [] },
          getSet: { type: 'Set', arguments: [] },
          getPromise: { type: 'Promise', arguments: [] },
        },
      },
      parentId: '',
    };

    // Encode to SmartBuffer
    const buf = new SmartBuffer(2048);
    serializer.encode(largeObject, buf);
    const encoded = buf.toBuffer();

    console.log('SmartBuffer encoded length:', encoded.length);

    // Decode using SmartBuffer.wrap
    const smartBuf = SmartBuffer.wrap(encoded);
    const decoded = serializer.decode(smartBuf);

    console.log('SmartBuffer decoded successfully');
    expect(decoded).toEqual(largeObject);
  });

  it('should handle emit task array with large Definition', () => {
    const taskData = [
      'emit',
      'service:expose',
      {
        name: 'service1',
        version: '',
        qualifiedName: 'service1',
        peerId: 'n1',
        definition: {
          id: 'cc9c06a9-2f35-4d5e-8b1a-7e3f9d4c2a1b',
          peerId: 'n1',
          meta: {
            name: 'service1',
            version: '',
            properties: {
              name: { type: 'String', readonly: false },
              description: { type: 'String', readonly: false },
              data: { type: 'Object', readonly: false },
              isActive: { type: 'Boolean', readonly: true },
            },
            methods: {
              greet: { type: 'String', arguments: [] },
              echo: { type: 'String', arguments: ['String'] },
              addNumbers: { type: 'Number', arguments: ['Number', 'Number'] },
              concatenateStrings: { type: 'String', arguments: ['String', 'String'] },
              getBooleanValue: { type: 'Boolean', arguments: ['Boolean'] },
              getObjectProperty: { type: 'String', arguments: ['Object'] },
              getArrayElement: { type: 'Object', arguments: ['Array', 'Number'] },
              fetchData: { type: 'Promise', arguments: ['String'] },
              updateData: { type: 'void', arguments: ['String', 'Object'] },
              getDataKeys: { type: 'Array', arguments: [] },
              delay: { type: 'Promise', arguments: ['Number'] },
              fetchDataWithDelay: { type: 'Promise', arguments: ['String', 'Number'] },
              updateDataWithDelay: { type: 'Promise', arguments: ['String', 'Object', 'Number'] },
              getStatus: { type: 'String', arguments: [] },
              getPriority: { type: 'Number', arguments: [] },
              getAllStatuses: { type: 'Array', arguments: [] },
              getAllPriorities: { type: 'Array', arguments: [] },
              getUndefined: { type: 'void', arguments: [] },
              getNull: { type: 'void', arguments: [] },
              getSymbol: { type: 'Symbol', arguments: [] },
              getBigInt: { type: 'BigInt', arguments: [] },
              getDate: { type: 'Date', arguments: [] },
              getRegExp: { type: 'RegExp', arguments: [] },
              getMap: { type: 'Map', arguments: [] },
              getSet: { type: 'Set', arguments: [] },
              getPromise: { type: 'Promise', arguments: [] },
            },
          },
          parentId: '',
        },
      },
    ];

    // Encode
    const encoded = serializer.encode(taskData);
    console.log('Task array encoded length:', encoded.length);

    // Decode back
    const decoded = serializer.decode(encoded);
    console.log('Task array decoded successfully');

    expect(decoded).toEqual(taskData);
  });
});
