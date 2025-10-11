/**
 * WebSocket Protocol Integration Tests
 * Tests the binary protocol, packet encoding/decoding, and WebSocket transport
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTitanServer, TitanServerFixture } from '../fixtures/titan-server.js';
import { WebSocketClient } from '../../src/client/ws-client.js';
import { Packet } from '../../src/packet/packet.js';
import { serializer } from '../../src/packet/serializer.js';
import { SmartBuffer } from '@omnitron-dev/smartbuffer';

describe('WebSocket Protocol Integration', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
      timeout: 10000,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Binary Protocol', () => {
    it('should handle binary packets over WebSocket', async () => {
      // Test that data is correctly serialized and deserialized
      const result = await client.invoke('calculator@1.0.0', 'add', [42, 58]);
      expect(result).toBe(100);
    });

    it('should preserve data types across binary serialization', async () => {
      const complexData = {
        string: 'test string',
        number: 123.456,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: 'nested value',
          },
        },
      };

      const result = await client.invoke('echo@1.0.0', 'echoObject', [complexData]);
      expect(result).toEqual(complexData);
    });

    it('should handle large payloads', async () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        value: `item-${i}`,
        timestamp: Date.now(),
      }));

      const result = await client.invoke('echo@1.0.0', 'echoArray', [largeArray]);
      expect(result).toEqual(largeArray);
      expect(result.length).toBe(10000);
    });

    it('should handle unicode and special characters', async () => {
      const specialStrings = [
        'Hello 世界',
        '🚀 Rocket emoji',
        'Ñoño español',
        'Привет мир',
        '\\n\\t\\r special chars',
        JSON.stringify({ key: 'value' }),
      ];

      for (const str of specialStrings) {
        const result = await client.invoke('echo@1.0.0', 'echoString', [str]);
        expect(result).toBe(str);
      }
    });

    it('should handle edge case values', async () => {
      const edgeCases = [
        0,
        -0,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        Number.EPSILON,
        '',
        ' ',
        [],
        {},
      ];

      for (const value of edgeCases) {
        const result = await client.invoke('echo@1.0.0', 'echo', [value]);
        if (typeof value === 'number' && isNaN(value)) {
          expect(isNaN(result)).toBe(true);
        } else if (Object.is(value, -0)) {
          expect(Object.is(result, -0)).toBe(true);
        } else {
          expect(result).toEqual(value);
        }
      }
    });
  });

  describe('Packet Structure', () => {
    it('should correctly encode and decode packet flags', () => {
      const packet = new Packet(Packet.nextId());

      // Test type flags
      packet.setType(1); // REQUEST
      expect(packet.getType()).toBe(1);

      packet.setType(2); // RESPONSE
      expect(packet.getType()).toBe(2);

      // Test impulse flag
      packet.setImpulse(1);
      expect(packet.getImpulse()).toBe(1);

      packet.setImpulse(0);
      expect(packet.getImpulse()).toBe(0);

      // Test error flag
      packet.setError(1);
      expect(packet.getError()).toBe(1);

      packet.setError(0);
      expect(packet.getError()).toBe(0);
    });

    it('should handle stream metadata in packets', () => {
      const packet = new Packet(Packet.nextId());

      packet.setType(4); // STREAM type
      packet.setStreamInfo(12345, 0, false, false);

      expect(packet.streamId).toBe(12345);
      expect(packet.streamIndex).toBe(0);
      expect(packet.isLastChunk()).toBe(false);
      expect(packet.isLive()).toBe(false);

      // Test end of stream
      packet.setStreamInfo(12345, 5, true, false);
      expect(packet.isLastChunk()).toBe(true);

      // Test live stream
      packet.setStreamInfo(12345, 0, false, true);
      expect(packet.isLive()).toBe(true);
    });

    it('should preserve all flags when modifying one', () => {
      const packet = new Packet(Packet.nextId());

      // Set all flags
      packet.setType(2); // RESPONSE
      packet.setImpulse(1);
      packet.setError(1);
      packet.setStreamInfo(999, 5, true, true);

      // Verify all flags are preserved
      expect(packet.getType()).toBe(2);
      expect(packet.getImpulse()).toBe(1);
      expect(packet.getError()).toBe(1);
      expect(packet.streamId).toBe(999);
      expect(packet.streamIndex).toBe(5);
      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(true);

      // Modify one flag
      packet.setType(3); // ERROR

      // Verify other flags unchanged
      expect(packet.getType()).toBe(3);
      expect(packet.getImpulse()).toBe(1);
      expect(packet.getError()).toBe(1);
      expect(packet.streamId).toBe(999);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize primitive types', () => {
      const values = [
        null,
        undefined,
        true,
        false,
        42,
        -123.456,
        'test string',
        '',
      ];

      for (const value of values) {
        const encoded = serializer.encode(value);
        const decoded = serializer.decode(new SmartBuffer(encoded));
        expect(decoded).toEqual(value);
      }
    });

    it('should serialize and deserialize complex objects', () => {
      const obj = {
        a: 1,
        b: 'test',
        c: [1, 2, 3],
        d: {
          nested: true,
          deep: {
            value: 42,
          },
        },
      };

      const encoded = serializer.encode(obj);
      const decoded = serializer.decode(new SmartBuffer(encoded));
      expect(decoded).toEqual(obj);
    });

    it('should serialize and deserialize arrays', () => {
      const arrays = [
        [],
        [1, 2, 3],
        ['a', 'b', 'c'],
        [1, 'two', true, null, { key: 'value' }],
        [[1, 2], [3, 4], [5, 6]],
      ];

      for (const arr of arrays) {
        const encoded = serializer.encode(arr);
        const decoded = serializer.decode(new SmartBuffer(encoded));
        expect(decoded).toEqual(arr);
      }
    });

    it('should handle circular references gracefully', () => {
      // The serializer should either handle or throw a clear error for circular refs
      const obj: any = { a: 1 };
      obj.self = obj;

      // This should either work or throw a clear error
      // (depends on messagepack implementation)
      expect(() => {
        serializer.encode(obj);
      }).toThrow(); // MessagePack typically throws on circular refs
    });
  });

  describe('Connection State', () => {
    it('should report correct connection state', () => {
      expect(client.getState()).toBe('connected');
      expect(client.isConnected()).toBe(true);
    });

    it('should track metrics correctly', () => {
      const metrics = client.getMetrics();
      expect(metrics.requestsSent).toBeGreaterThan(0);
      expect(metrics.responsesReceived).toBeGreaterThan(0);
      expect(metrics.transport).toBe('websocket');
      expect(metrics.state).toBe('connected');
    });

    it('should handle connection events', async () => {
      const events: string[] = [];

      const newClient = new WebSocketClient({
        url: server.wsUrl,
        reconnect: false,
      });

      newClient.on('connect', () => events.push('connect'));
      newClient.on('disconnect', () => events.push('disconnect'));

      await newClient.connect();
      await newClient.disconnect();

      expect(events).toContain('connect');
      expect(events).toContain('disconnect');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent requests', async () => {
      const promises = Array.from({ length: 50 }, (_, i) =>
        client.invoke('calculator@1.0.0', 'add', [i, i + 1])
      );

      const results = await Promise.all(promises);

      results.forEach((result, i) => {
        expect(result).toBe(i + i + 1);
      });
    });

    it('should handle mixed concurrent operations', async () => {
      const operations = [
        client.invoke('calculator@1.0.0', 'add', [10, 20]),
        client.invoke('calculator@1.0.0', 'multiply', [5, 5]),
        client.invoke('user@1.0.0', 'getUser', ['1']),
        client.invoke('echo@1.0.0', 'echoString', ['test']),
        client.invoke('calculator@1.0.0', 'divide', [100, 4]),
      ];

      const [sum, product, user, echo, quotient] = await Promise.all(operations);

      expect(sum).toBe(30);
      expect(product).toBe(25);
      expect(user).toHaveProperty('id', '1');
      expect(echo).toBe('test');
      expect(quotient).toBe(25);
    });

    it('should handle rapid sequential calls', async () => {
      const results: number[] = [];

      for (let i = 0; i < 100; i++) {
        const result = await client.invoke('calculator@1.0.0', 'add', [i, 1]);
        results.push(result);
      }

      expect(results.length).toBe(100);
      results.forEach((result, i) => {
        expect(result).toBe(i + 1);
      });
    });
  });

  describe('Service Discovery', () => {
    it('should invoke methods on different services', async () => {
      // Calculator service
      const calcResult = await client.invoke('calculator@1.0.0', 'add', [5, 5]);
      expect(calcResult).toBe(10);

      // User service
      const user = await client.invoke('user@1.0.0', 'getUser', ['2']);
      expect(user).toHaveProperty('id', '2');

      // Echo service
      const echo = await client.invoke('echo@1.0.0', 'echoString', ['hello']);
      expect(echo).toBe('hello');
    });

    it('should handle non-existent service gracefully', async () => {
      await expect(
        client.invoke('nonexistent@1.0.0', 'someMethod', [])
      ).rejects.toThrow();
    });

    it('should handle non-existent method gracefully', async () => {
      await expect(
        client.invoke('calculator@1.0.0', 'nonExistentMethod', [])
      ).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should maintain low latency for simple operations', async () => {
      const iterations = 100;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await client.invoke('calculator@1.0.0', 'add', [1, 1]);
        const latency = Date.now() - start;
        latencies.push(latency);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      expect(avgLatency).toBeLessThan(50); // Average should be under 50ms
      expect(maxLatency).toBeLessThan(200); // Max should be under 200ms
    });

    it('should handle high throughput', async () => {
      const start = Date.now();
      const count = 1000;

      const promises = Array.from({ length: count }, (_, i) =>
        client.invoke('calculator@1.0.0', 'add', [i, 1])
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - start;

      expect(results.length).toBe(count);
      expect(duration).toBeLessThan(5000); // Should complete 1000 requests in under 5 seconds

      const throughput = count / (duration / 1000);
      console.log(`Throughput: ${throughput.toFixed(2)} requests/sec`);
    });
  });
});
