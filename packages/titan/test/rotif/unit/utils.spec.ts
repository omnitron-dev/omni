import { describe, it, expect } from 'vitest';
import {
  parseFields,
  getStreamKey,
  getLoopKey,
  getGroupName,
  defaultConsumerName,
  generateDedupKey,
} from '../../../src/rotif/utils/common.js';

describe('Rotif Utils - Common Functions', () => {
  describe('parseFields', () => {
    it('should parse field-value pairs correctly', () => {
      const raw = ['field1', 'value1', 'field2', 'value2', 'field3', 'value3'];
      const result = parseFields(raw);

      expect(result).toEqual({
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
      });
    });

    it('should handle empty array', () => {
      const result = parseFields([]);
      expect(result).toEqual({});
    });

    it('should handle odd number of elements (missing value)', () => {
      const raw = ['field1', 'value1', 'field2'];
      const result = parseFields(raw);

      expect(result).toEqual({
        field1: 'value1',
      });
    });

    it('should handle undefined values', () => {
      const raw = ['field1', undefined as any, 'field2', 'value2'];
      const result = parseFields(raw);

      // undefined key-value pairs should not be included
      expect(result).toEqual({
        field2: 'value2',
      });
    });

    it('should handle numeric values as strings', () => {
      const raw = ['count', '42', 'timestamp', '1234567890'];
      const result = parseFields(raw);

      expect(result).toEqual({
        count: '42',
        timestamp: '1234567890',
      });
    });
  });

  describe('getStreamKey', () => {
    it('should generate correct stream key from channel', () => {
      expect(getStreamKey('test.channel')).toBe('rotif:stream:test.channel');
      expect(getStreamKey('user.created')).toBe('rotif:stream:user.created');
    });

    it('should handle wildcard patterns', () => {
      expect(getStreamKey('test.*')).toBe('rotif:stream:test.*');
      expect(getStreamKey('*')).toBe('rotif:stream:*');
    });

    it('should handle special characters', () => {
      expect(getStreamKey('test:channel:123')).toBe('rotif:stream:test:channel:123');
    });
  });

  describe('getLoopKey', () => {
    it('should generate correct loop key from stream and group', () => {
      const stream = 'rotif:stream:test';
      const group = 'grp:test';

      expect(getLoopKey(stream, group)).toBe('rotif:stream:test:grp:test');
    });

    it('should handle different stream and group combinations', () => {
      expect(getLoopKey('stream1', 'group1')).toBe('stream1:group1');
      expect(getLoopKey('a:b:c', 'd:e:f')).toBe('a:b:c:d:e:f');
    });
  });

  describe('getGroupName', () => {
    it('should generate default group name from pattern', () => {
      expect(getGroupName('test.channel')).toBe('grp:test.channel');
      expect(getGroupName('user.*')).toBe('grp:user.*');
    });

    it('should use custom group name if provided', () => {
      expect(getGroupName('test.channel', 'custom-group')).toBe('custom-group');
      expect(getGroupName('any-pattern', 'my-group')).toBe('my-group');
    });

    it('should prefer custom name over default', () => {
      const customName = 'priority-group';
      expect(getGroupName('test.*', customName)).toBe(customName);
    });
  });

  describe('defaultConsumerName', () => {
    it('should generate unique consumer name', () => {
      const name1 = defaultConsumerName();
      const name2 = defaultConsumerName();

      expect(name1).toBeTruthy();
      expect(name2).toBeTruthy();
      expect(name1).not.toBe(name2); // Should be unique due to random component
    });

    it('should contain hostname and process ID', () => {
      const name = defaultConsumerName();
      const parts = name.split(':');

      expect(parts.length).toBe(3);
      expect(parts[0]).toBeTruthy(); // hostname
      expect(parts[1]).toBe(String(process.pid));
      expect(parseInt(parts[2]!)).toBeGreaterThanOrEqual(0);
      expect(parseInt(parts[2]!)).toBeLessThan(10000);
    });
  });

  describe('generateDedupKey', () => {
    describe('publisher-side deduplication', () => {
      it('should generate consistent key for same payload', () => {
        const payload = { msg: 'test', id: 123 };
        const key1 = generateDedupKey({ channel: 'test', payload, side: 'pub' });
        const key2 = generateDedupKey({ channel: 'test', payload, side: 'pub' });

        expect(key1).toBe(key2);
      });

      it('should generate different keys for different payloads', () => {
        const key1 = generateDedupKey({ channel: 'test', payload: { msg: 'a' }, side: 'pub' });
        const key2 = generateDedupKey({ channel: 'test', payload: { msg: 'b' }, side: 'pub' });

        expect(key1).not.toBe(key2);
      });

      it('should include channel in key', () => {
        const payload = { msg: 'test' };
        const key1 = generateDedupKey({ channel: 'channel1', payload, side: 'pub' });
        const key2 = generateDedupKey({ channel: 'channel2', payload, side: 'pub' });

        expect(key1).not.toBe(key2);
        expect(key1).toContain('channel1');
        expect(key2).toContain('channel2');
      });

      it('should use pub prefix for publisher side', () => {
        const key = generateDedupKey({ channel: 'test', payload: {}, side: 'pub' });
        expect(key).toContain('rotif:dedup:pub');
      });

      it('should handle pattern in dedup key', () => {
        const key = generateDedupKey({
          channel: 'test.channel',
          payload: {},
          pattern: 'test.*',
          side: 'pub',
        });
        expect(key).toContain('test.*');
      });
    });

    describe('consumer-side deduplication', () => {
      it('should use con prefix for consumer side', () => {
        const key = generateDedupKey({ channel: 'test', payload: {}, side: 'con' });
        expect(key).toContain('rotif:dedup:con');
      });

      it('should include group in consumer dedup key', () => {
        const key = generateDedupKey({
          channel: 'test',
          payload: {},
          group: 'grp:test',
          side: 'con',
        });
        expect(key).toContain('grp:test');
      });

      it('should generate different keys for different groups', () => {
        const payload = { msg: 'test' };
        const key1 = generateDedupKey({ channel: 'test', payload, group: 'grp1', side: 'con' });
        const key2 = generateDedupKey({ channel: 'test', payload, group: 'grp2', side: 'con' });

        expect(key1).not.toBe(key2);
      });
    });

    describe('payload serialization', () => {
      it('should handle null payload', () => {
        const key = generateDedupKey({ channel: 'test', payload: null, side: 'pub' });
        expect(key).toBeTruthy();
      });

      it('should handle undefined payload', () => {
        const key = generateDedupKey({ channel: 'test', payload: undefined, side: 'pub' });
        expect(key).toBeTruthy();
      });

      it('should handle primitive payloads', () => {
        const key1 = generateDedupKey({ channel: 'test', payload: 'string', side: 'pub' });
        const key2 = generateDedupKey({ channel: 'test', payload: 42, side: 'pub' });
        const key3 = generateDedupKey({ channel: 'test', payload: true, side: 'pub' });

        expect(key1).toBeTruthy();
        expect(key2).toBeTruthy();
        expect(key3).toBeTruthy();
        expect(key1).not.toBe(key2);
        expect(key2).not.toBe(key3);
      });

      it('should handle complex object payloads', () => {
        const payload = {
          user: { id: 123, name: 'test' },
          timestamp: Date.now(),
          tags: ['a', 'b', 'c'],
        };
        const key = generateDedupKey({ channel: 'test', payload, side: 'pub' });
        expect(key).toBeTruthy();
      });

      it('should differentiate between same value but different types', () => {
        const key1 = generateDedupKey({ channel: 'test', payload: '42', side: 'pub' });
        const key2 = generateDedupKey({ channel: 'test', payload: 42, side: 'pub' });

        expect(key1).not.toBe(key2);
      });

      it('should handle array payloads', () => {
        const payload = [1, 2, 3, 4, 5];
        const key = generateDedupKey({ channel: 'test', payload, side: 'pub' });
        expect(key).toBeTruthy();
      });
    });

    describe('wildcard patterns', () => {
      it('should use wildcard when group not provided', () => {
        const key = generateDedupKey({ channel: 'test', payload: {}, side: 'pub' });
        expect(key).toContain('*');
      });

      it('should use wildcard when pattern not provided', () => {
        const key = generateDedupKey({ channel: 'test', payload: {}, side: 'pub' });
        expect(key).toContain('*');
      });
    });
  });
});
