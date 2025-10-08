import { describe, it, expect } from '@jest/globals';
import { Serializer } from '../src/index.js';
import { SmartBuffer } from '../src/smart-buffer.js';

describe('Titan packet simulation', () => {
  // Simulate Definition class from Titan
  class Definition {
    constructor(
      public id: string,
      public peerId: string,
      public meta: any,
      public parentId: string = ''
    ) {}
  }

  it('should encode/decode Definition like Titan does', () => {
    const ser = new Serializer();

    // Register Definition exactly like Titan
    ser.register(
      109,
      Definition,
      (obj: Definition, buf: SmartBuffer) => {
        ser.encode(obj.id, buf);
        ser.encode(obj.parentId, buf);
        ser.encode(obj.peerId, buf);
        ser.encode(obj.meta, buf);
      },
      (buf: SmartBuffer) => {
        const id = ser.decode(buf);
        const parentId = ser.decode(buf);
        const peerId = ser.decode(buf);
        const meta = ser.decode(buf);
        const def = new Definition(id, peerId, meta);
        def.parentId = parentId;
        return def;
      }
    );

    // Create a large Definition like in the failing tests
    const def = new Definition(
      'cc9c06a9-2f35-4d5e-8b1a-7e3f9d4c2a1b',
      'n1',
      {
        name: 'service1',
        version: '',
        properties: {
          name: { type: 'String', readonly: false },
          description: { type: 'String', readonly: false },
          data: { type: 'Object', readonly: false },
          isActive: { type: 'Boolean', readonly: true }
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
          getPromise: { type: 'Promise', arguments: [] }
        }
      },
      ''
    );

    // Simulate Titan packet encoding
    const packetBuf = new SmartBuffer(2048);
    packetBuf.writeUInt32BE(1); // packet id
    packetBuf.writeUInt8(0x40); // flags

    // Encode task data like ['emit', 'service:expose', {definition, ...}]
    const taskData = [
      'emit',
      'service:expose',
      {
        name: 'service1',
        version: '',
        qualifiedName: 'service1',
        peerId: 'n1',
        definition: def
      }
    ];

    console.log('Task data to encode:', JSON.stringify(taskData).slice(0, 100));
    ser.encode(taskData, packetBuf);
    const encoded = packetBuf.toBuffer();

    console.log('Packet size:', encoded.length);
    console.log('Bytes 5-25:', encoded.slice(5, 25)); // Skip header, show msgpack data

    // Simulate Titan packet decoding
    const decodeBuf = SmartBuffer.wrap(encoded);
    const packetId = decodeBuf.readUInt32BE();
    const flags = decodeBuf.readUInt8();

    console.log('Decoding packet, roffset after header:', decodeBuf.roffset);
    console.log('Remaining bytes:', decodeBuf.woffset - decodeBuf.roffset);

    const decoded = ser.decode(decodeBuf);

    console.log('Decoded successfully');
    expect(decoded).toEqual(taskData);
    expect(decoded[2].definition).toBeInstanceOf(Definition);
  });
});
