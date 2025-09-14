import Long from 'long';
import { SmartBuffer } from '@omnitron-dev/smartbuffer';

import { BufferType } from './types';
import Serializer from './serializer';
import { createError, getStdErrorId } from './errors';

export const registerCommonTypesFor = (s: Serializer) => {
  // Custom types mapping:
  // 126 - std errors
  // 125 - Date
  // 124 - Map
  // 123 - Set
  // 122 - reserved
  // 121 - RegExp
  // 120 - BigInt
  // 119 - Long
  // 110-118 - reserved for other ateos types
  // 100-109 - reserved for netron types
  // 1-99 - user-defined types

  // Std errors encoders/decoders
  s.register(
    126,
    Error,
    (obj: any, buf: SmartBuffer) => {
      buf.writeUInt16BE(getStdErrorId(obj));
      s.encode(obj.name, buf);
      s.encode(obj.stack, buf);
      s.encode(obj.message, buf);
      // Encode custom fields
      const customFields = Object.keys(obj).filter(
        (key) => !['stack', 'message', 'name'].includes(key) && obj[key] !== undefined
      );
      buf.writeUInt16BE(customFields.length);
      for (const key of customFields) {
        s.encode(key, buf);
        s.encode(obj[key], buf);
      }
    },
    (buf: SmartBuffer) => {
      const id = buf.readUInt16BE();
      const name = s.decode(buf);
      const stack = s.decode(buf);
      const message = s.decode(buf);
      const error = createError(id, message, stack);
      error.name = name;
      // Decode custom fields
      const customFieldsCount = buf.readUInt16BE();
      for (let i = 0; i < customFieldsCount; i++) {
        const key = s.decode(buf);
        const value = s.decode(buf);
        error[key] = value;
      }
      return error;
    }
  );

  // Date
  s.register(
    125,
    Date,
    (obj: any, buf: SmartBuffer) => {
      buf.writeUInt64BE(obj.getTime());
    },
    (buf: SmartBuffer) => new Date(buf.readUInt64BE().toNumber())
  );

  // Map
  s.register(
    124,
    Map,
    (obj: Map<any, any>, buf: SmartBuffer) => {
      buf.writeUInt32BE(obj.size);
      for (const [key, val] of obj.entries()) {
        s.encode(key, buf);
        s.encode(val, buf);
      }
    },
    (buf: SmartBuffer) => {
      const map = new Map();
      const size = buf.readUInt32BE();
      for (let i = 0; i < size; i++) {
        const key = s.decode(buf);
        const val = s.decode(buf);
        map.set(key, val);
      }
      return map;
    }
  );

  // Set
  s.register(
    123,
    Set,
    (obj: Set<any>, buf: SmartBuffer) => {
      buf.writeUInt32BE(obj.size);
      for (const val of obj.values()) {
        s.encode(val, buf);
      }
    },
    (buf: SmartBuffer) => {
      const set = new Set();
      const size = buf.readUInt32BE();
      for (let i = 0; i < size; i++) {
        const val = s.decode(buf);
        set.add(val);
      }
      return set;
    }
  );

  // RegExp
  s.register(
    121,
    RegExp,
    (obj: RegExp, buf: SmartBuffer) => {
      s.encode(obj.source, buf);
      s.encode(obj.flags, buf);
    },
    (buf: SmartBuffer) => {
      const source = s.decode(buf);
      const flags = s.decode(buf);
      return new RegExp(source, flags);
    }
  );

  // BigInt encoder/decoder
  s.register(
    120,
    BigInt,
    (obj: bigint, buf: SmartBuffer) => {
      const str = obj.toString();
      s.encode(str, buf);
    },
    (buf: SmartBuffer) => {
      const str = s.decode(buf);
      return BigInt(str);
    }
  );

  // Long encoder/decoder
  s.register(
    119,
    Long,
    (obj: Long, buf: SmartBuffer) => {
      buf.writeInt8(obj.unsigned ? 1 : 0);
      if (obj.unsigned) {
        buf.writeUInt64BE(obj);
      } else {
        buf.writeInt64BE(obj);
      }
    },
    (buf: SmartBuffer) => {
      const unsigned = Boolean(buf.readInt8());
      return unsigned ? buf.readUInt64BE() : buf.readInt64BE();
    }
  );
};

export { Serializer };
export const serializer = new Serializer();
registerCommonTypesFor(serializer);

export const encode = (obj: any) => serializer.encode(obj).toBuffer();
export const decode = (buf: BufferType) => serializer.decode(buf);
export const tryDecode = (buf: SmartBuffer) => serializer.decoder.tryDecode(buf);
