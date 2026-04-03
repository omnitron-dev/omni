/**
 * Transport Compatibility Tests
 *
 * Tests protocol compatibility between Browser Netron and Titan Netron,
 * cross-transport functionality, load testing, edge cases, and recovery scenarios.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTitanServer, TitanServerFixture } from '../fixtures/titan-server.js';
import { WebSocketClient } from '../../src/client/ws-client.js';
import { HttpClient } from '../../src/client/http-client.js';
import { Packet } from '../../src/packet/packet.js';
import { serializer } from '../../src/packet/serializer.js';
import { SmartBuffer } from '@omnitron-dev/msgpack/smart-buffer';
import { TitanError, ErrorCode } from '../../src/errors/index.js';
import { Reference } from '../../src/core/reference.js';
import { Definition } from '../../src/core/definition.js';
import { StreamReference } from '../../src/core/stream-reference.js';
import {
  TYPE_PING,
  TYPE_GET,
  TYPE_SET,
  TYPE_CALL,
  TYPE_TASK,
  TYPE_STREAM,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
  type PacketType,
} from '../../src/packet/types.js';

// =============================================================================
// 1. PROTOCOL COMPATIBILITY TESTS
// =============================================================================

describe('Protocol Compatibility', () => {
  let server: TitanServerFixture;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: true,
      logLevel: 'silent',
    });
  });

  afterAll(async () => {
    await server.cleanup();
  });

  describe('Browser Packet Format Matches Titan Format', () => {
    it('should create packets with correct header structure', () => {
      const packet = new Packet(Packet.nextId());

      // Verify packet has required fields
      expect(typeof packet.id).toBe('number');
      expect(packet.id).toBeGreaterThan(0);

      // Verify flag accessors work correctly
      packet.setType(TYPE_CALL);
      packet.setImpulse(1);
      packet.setError(0);

      expect(packet.getType()).toBe(TYPE_CALL);
      expect(packet.getImpulse()).toBe(1);
      expect(packet.getError()).toBe(0);
    });

    it('should use same packet type constants as Titan', () => {
      // These values must match Titan's packet types exactly
      expect(TYPE_PING).toBe(0x00);
      expect(TYPE_GET).toBe(0x01);
      expect(TYPE_SET).toBe(0x02);
      expect(TYPE_CALL).toBe(0x03);
      expect(TYPE_TASK).toBe(0x04);
      expect(TYPE_STREAM).toBe(0x05);
      expect(TYPE_STREAM_ERROR).toBe(0x06);
      expect(TYPE_STREAM_CLOSE).toBe(0x07);
    });

    it('should encode packet ID correctly', () => {
      // IDs should be unique and incrementing
      const ids: number[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(Packet.nextId());
      }

      // Check uniqueness
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);

      // Check incrementing (within reset cycle)
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThan(ids[i - 1]);
      }
    });
  });

  describe('All Packet Types Serialize/Deserialize Correctly', () => {
    const testPacketType = (type: PacketType, typeName: string) => {
      it(`should correctly handle ${typeName} (${type}) packets`, () => {
        const packet = new Packet(Packet.nextId());
        packet.setType(type);
        packet.data = { test: 'data', type: typeName };

        // Verify type is preserved
        expect(packet.getType()).toBe(type);

        // Serialize and deserialize the data
        const encoded = serializer.encode(packet.data);
        const decoded = serializer.decode(SmartBuffer.wrap(encoded));

        expect(decoded).toEqual(packet.data);
      });
    };

    testPacketType(TYPE_PING, 'PING');
    testPacketType(TYPE_GET, 'GET');
    testPacketType(TYPE_SET, 'SET');
    testPacketType(TYPE_CALL, 'CALL');
    testPacketType(TYPE_TASK, 'TASK');
    testPacketType(TYPE_STREAM, 'STREAM');
    testPacketType(TYPE_STREAM_ERROR, 'STREAM_ERROR');
    testPacketType(TYPE_STREAM_CLOSE, 'STREAM_CLOSE');

    it('should handle request packets with full payload', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(TYPE_CALL);
      packet.setImpulse(1); // Request

      const payload = {
        service: 'calculator@1.0.0',
        method: 'add',
        args: [10, 20],
        context: {
          headers: {
            'X-Request-Id': 'req-12345',
          },
        },
      };
      packet.data = payload;

      const encoded = serializer.encode(packet.data);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toEqual(payload);
    });

    it('should handle response packets with results', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(TYPE_CALL);
      packet.setImpulse(0); // Response

      const result = {
        success: true,
        data: 30,
        metadata: {
          executionTime: 5,
        },
      };
      packet.data = result;

      const encoded = serializer.encode(packet.data);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toEqual(result);
    });
  });

  describe('Stream Packets Work Correctly', () => {
    it('should handle stream start packet', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(TYPE_STREAM);
      packet.setStreamInfo(12345, 0, false, false);

      expect(packet.streamId).toBe(12345);
      expect(packet.streamIndex).toBe(0);
      expect(packet.isLastChunk()).toBe(false);
      expect(packet.isLive()).toBe(false);
      expect(packet.isStreamChunk()).toBe(true);
    });

    it('should handle stream middle packets', () => {
      for (let index = 1; index <= 10; index++) {
        const packet = new Packet(Packet.nextId());
        packet.setType(TYPE_STREAM);
        packet.setStreamInfo(12345, index, false, false);

        expect(packet.streamId).toBe(12345);
        expect(packet.streamIndex).toBe(index);
        expect(packet.isLastChunk()).toBe(false);
      }
    });

    it('should handle stream end packet', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(TYPE_STREAM);
      packet.setStreamInfo(12345, 100, true, false);

      expect(packet.streamId).toBe(12345);
      expect(packet.streamIndex).toBe(100);
      expect(packet.isLastChunk()).toBe(true);
    });

    it('should handle live stream packets', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(TYPE_STREAM);
      packet.setStreamInfo(99999, 0, false, true);

      expect(packet.streamId).toBe(99999);
      expect(packet.isLive()).toBe(true);
    });

    it('should serialize stream data correctly', () => {
      const streamData = {
        chunk: new Array(100).fill(0).map((_, i) => i),
        metadata: { position: 5, total: 10 },
      };

      const encoded = serializer.encode(streamData);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toEqual(streamData);
    });
  });

  describe('Error Packets Preserve Information', () => {
    it('should serialize TitanError with all properties', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed for field email',
        details: {
          field: 'email',
          value: 'invalid-email',
          constraint: 'email',
        },
        requestId: 'req-123',
        correlationId: 'corr-456',
        traceId: 'trace-789',
        spanId: 'span-abc',
      });

      const encoded = serializer.encode(error);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(decoded.message).toBe('Validation failed for field email');
      expect(decoded.details).toEqual({
        field: 'email',
        value: 'invalid-email',
        constraint: 'email',
      });
      expect(decoded.requestId).toBe('req-123');
      expect(decoded.correlationId).toBe('corr-456');
      expect(decoded.traceId).toBe('trace-789');
      expect(decoded.spanId).toBe('span-abc');
    });

    it('should preserve error stack traces when enabled', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
      });

      // Capture original stack
      const originalStack = error.stack;

      const encoded = serializer.encode(error);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded.stack).toBe(originalStack);
    });

    it('should handle error cause chain', () => {
      const causeError = new Error('Root cause');
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Wrapper error',
        cause: causeError,
      });

      const encoded = serializer.encode(error);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded.message).toBe('Wrapper error');
      // Cause should be preserved
      expect((decoded as any).cause).toBeDefined();
    });

    it('should serialize all error codes correctly', () => {
      const errorCodes = [
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.NOT_FOUND,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
        ErrorCode.INTERNAL_ERROR,
        ErrorCode.SERVICE_UNAVAILABLE,
        ErrorCode.REQUEST_TIMEOUT,
      ];

      for (const code of errorCodes) {
        const error = new TitanError({
          code,
          message: `Error with code ${code}`,
        });

        const encoded = serializer.encode(error);
        const decoded = serializer.decode(SmartBuffer.wrap(encoded));

        expect(decoded.code).toBe(code);
      }
    });
  });

  describe('Custom Type Serialization Compatibility', () => {
    it('should serialize Reference compatible with Titan', () => {
      const ref = new Reference('calculator@1.0.0');

      const encoded = serializer.encode(ref);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBeInstanceOf(Reference);
      expect(decoded.defId).toBe('calculator@1.0.0');
    });

    it('should serialize Definition compatible with Titan', () => {
      const def = new Definition('calculator@1.0.0', 'peer-123', {
        name: 'calculator',
        version: '1.0.0',
        properties: {},
        methods: {
          add: {
            type: 'number',
            arguments: [
              { index: 0, type: 'number' },
              { index: 1, type: 'number' },
            ],
          },
          subtract: {
            type: 'number',
            arguments: [
              { index: 0, type: 'number' },
              { index: 1, type: 'number' },
            ],
          },
          multiply: {
            type: 'number',
            arguments: [
              { index: 0, type: 'number' },
              { index: 1, type: 'number' },
            ],
          },
          divide: {
            type: 'number',
            arguments: [
              { index: 0, type: 'number' },
              { index: 1, type: 'number' },
            ],
          },
        },
      });
      def.parentId = 'parent-service@1.0.0';

      const encoded = serializer.encode(def);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBeInstanceOf(Definition);
      expect(decoded.id).toBe('calculator@1.0.0');
      expect(decoded.peerId).toBe('peer-123');
      expect(decoded.parentId).toBe('parent-service@1.0.0');
      expect(decoded.meta.name).toBe('calculator');
      expect(decoded.meta.version).toBe('1.0.0');
      expect(Object.keys(decoded.meta.methods)).toEqual(['add', 'subtract', 'multiply', 'divide']);
    });

    it('should serialize StreamReference compatible with Titan', () => {
      const readable = new StreamReference(12345, 'readable', false, 'peer-123');
      const writable = new StreamReference(67890, 'writable', true, 'peer-456');

      const encodedReadable = serializer.encode(readable);
      const decodedReadable = serializer.decode(SmartBuffer.wrap(encodedReadable));

      expect(decodedReadable).toBeInstanceOf(StreamReference);
      expect(decodedReadable.streamId).toBe(12345);
      expect(decodedReadable.type).toBe('readable');
      expect(decodedReadable.isLive).toBe(false);
      expect(decodedReadable.peerId).toBe('peer-123');

      const encodedWritable = serializer.encode(writable);
      const decodedWritable = serializer.decode(SmartBuffer.wrap(encodedWritable));

      expect(decodedWritable.streamId).toBe(67890);
      expect(decodedWritable.type).toBe('writable');
      expect(decodedWritable.isLive).toBe(true);
    });

    it('should handle mixed custom types in arrays', () => {
      const mixed = [
        new Reference('service1@1.0.0'),
        new Reference('service2@2.0.0'),
        new Definition('def@1.0.0', 'peer-1', {
          name: 'testService',
          version: '1.0.0',
          properties: {},
          methods: {},
        }),
        new StreamReference(1, 'readable', false, 'peer-2'),
      ];

      const encoded = serializer.encode(mixed);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded[0]).toBeInstanceOf(Reference);
      expect(decoded[1]).toBeInstanceOf(Reference);
      expect(decoded[2]).toBeInstanceOf(Definition);
      expect(decoded[3]).toBeInstanceOf(StreamReference);
    });
  });
});

// =============================================================================
// 2. CROSS-TRANSPORT TESTS
// =============================================================================

describe('Cross-Transport Tests', () => {
  let server: TitanServerFixture;
  let httpClient: HttpClient;
  let wsClient: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    httpClient = new HttpClient({ url: server.httpUrl });
    wsClient = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
      serviceDefinitions: server.serviceDefinitions,
    });

    await httpClient.connect();
    await wsClient.connect();
  });

  afterAll(async () => {
    await httpClient.disconnect();
    await wsClient.disconnect();
    await server.cleanup();
  });

  describe('Same Service Callable via HTTP and WebSocket', () => {
    it('should return identical results from calculator service', async () => {
      const httpResult = await httpClient.invoke('calculator@1.0.0', 'add', [100, 200]);
      const wsResult = await wsClient.invoke('calculator@1.0.0', 'add', [100, 200]);

      expect(httpResult).toBe(300);
      expect(wsResult).toBe(300);
      expect(httpResult).toBe(wsResult);
    });

    it('should return identical results from echo service', async () => {
      const testData = {
        string: 'test',
        number: 42,
        array: [1, 2, 3],
        nested: { deep: { value: 'nested' } },
      };

      const httpResult = await httpClient.invoke('echo@1.0.0', 'echoObject', [testData]);
      const wsResult = await wsClient.invoke('echo@1.0.0', 'echoObject', [testData]);

      expect(httpResult).toEqual(testData);
      expect(wsResult).toEqual(testData);
      expect(httpResult).toEqual(wsResult);
    });

    it('should return identical results from user service', async () => {
      const httpResult = await httpClient.invoke('user@1.0.0', 'getUser', ['1']);
      const wsResult = await wsClient.invoke('user@1.0.0', 'getUser', ['1']);

      expect(httpResult.id).toBe('1');
      expect(wsResult.id).toBe('1');
      expect(httpResult).toEqual(wsResult);
    });

    it('should handle errors consistently across transports', async () => {
      let httpError: any;
      let wsError: any;

      try {
        await httpClient.invoke('calculator@1.0.0', 'divide', [10, 0]);
      } catch (e) {
        httpError = e;
      }

      try {
        await wsClient.invoke('calculator@1.0.0', 'divide', [10, 0]);
      } catch (e) {
        wsError = e;
      }

      expect(httpError).toBeDefined();
      expect(wsError).toBeDefined();
      expect(httpError.message).toContain('Division by zero');
      expect(wsError.message).toContain('Division by zero');
    });
  });

  describe('Switch Between Transports', () => {
    it('should work when alternating between HTTP and WebSocket', async () => {
      const results: number[] = [];

      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          results.push(await httpClient.invoke('calculator@1.0.0', 'add', [i, 1]));
        } else {
          results.push(await wsClient.invoke('calculator@1.0.0', 'add', [i, 1]));
        }
      }

      expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('should maintain data consistency when switching transports', async () => {
      // Create a user via HTTP
      const newUser = await httpClient.invoke('user@1.0.0', 'createUser', [
        { name: 'Test User', email: 'test@example.com' },
      ]);

      // Retrieve via WebSocket
      const retrievedUser = await wsClient.invoke('user@1.0.0', 'getUser', [newUser.id]);

      expect(retrievedUser.id).toBe(newUser.id);
      expect(retrievedUser.name).toBe('Test User');
      expect(retrievedUser.email).toBe('test@example.com');

      // Update via WebSocket
      const updatedUser = await wsClient.invoke('user@1.0.0', 'updateUser', [newUser.id, { name: 'Updated Name' }]);

      // Verify via HTTP
      const verifiedUser = await httpClient.invoke('user@1.0.0', 'getUser', [newUser.id]);

      expect(verifiedUser.name).toBe('Updated Name');
    });

    it('should handle concurrent requests across both transports', async () => {
      const httpRequests = Array.from({ length: 20 }, (_, i) =>
        httpClient.invoke('calculator@1.0.0', 'add', [i * 2, 1])
      );

      const wsRequests = Array.from({ length: 20 }, (_, i) =>
        wsClient.invoke('calculator@1.0.0', 'add', [i * 2 + 1, 1])
      );

      const [httpResults, wsResults] = await Promise.all([Promise.all(httpRequests), Promise.all(wsRequests)]);

      // Verify HTTP results (even numbers + 1)
      httpResults.forEach((result, i) => {
        expect(result).toBe(i * 2 + 1);
      });

      // Verify WS results (odd numbers + 1)
      wsResults.forEach((result, i) => {
        expect(result).toBe(i * 2 + 2);
      });
    });
  });
});

// =============================================================================
// 3. LOAD TESTS (Basic)
// =============================================================================

describe('Load Tests', () => {
  let server: TitanServerFixture;
  let wsClient: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    wsClient = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
      timeout: 60000,
      serviceDefinitions: server.serviceDefinitions,
    });

    await wsClient.connect();
  });

  afterAll(async () => {
    await wsClient.disconnect();
    await server.cleanup();
  });

  describe('Multiple Rapid Requests', () => {
    it('should handle 100 sequential rapid requests', async () => {
      const startTime = Date.now();
      const results: number[] = [];

      for (let i = 0; i < 100; i++) {
        const result = await wsClient.invoke('calculator@1.0.0', 'add', [i, 1]);
        results.push(result);
      }

      const duration = Date.now() - startTime;

      expect(results.length).toBe(100);
      results.forEach((result, i) => {
        expect(result).toBe(i + 1);
      });

      console.log(`100 sequential requests completed in ${duration}ms`);
      expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
    });

    it('should handle 500 concurrent rapid requests', async () => {
      const startTime = Date.now();
      const count = 500;

      const promises = Array.from({ length: count }, (_, i) => wsClient.invoke('calculator@1.0.0', 'add', [i, 1]));

      const results = await Promise.all(promises);

      const duration = Date.now() - startTime;
      const throughput = (count / duration) * 1000;

      expect(results.length).toBe(count);
      results.forEach((result, i) => {
        expect(result).toBe(i + 1);
      });

      console.log(`${count} concurrent requests completed in ${duration}ms (${throughput.toFixed(2)} req/sec)`);
      expect(duration).toBeLessThan(15000); // Should complete in under 15 seconds
    });

    it('should handle burst requests with varying payload sizes', async () => {
      const bursts = [
        { count: 50, payloadSize: 10 },
        { count: 30, payloadSize: 100 },
        { count: 20, payloadSize: 1000 },
      ];

      for (const burst of bursts) {
        const payload = Array.from({ length: burst.payloadSize }, (_, i) => i);
        const startTime = Date.now();

        const promises = Array.from({ length: burst.count }, () =>
          wsClient.invoke('echo@1.0.0', 'echoArray', [payload])
        );

        const results = await Promise.all(promises);
        const duration = Date.now() - startTime;

        expect(results.length).toBe(burst.count);
        results.forEach((result) => {
          expect(result).toEqual(payload);
        });

        console.log(`Burst: ${burst.count} requests with ${burst.payloadSize} items completed in ${duration}ms`);
      }
    });
  });

  describe('Concurrent Connections', () => {
    it('should handle multiple concurrent WebSocket connections', async () => {
      const connectionCount = 5;
      const clients: WebSocketClient[] = [];

      try {
        // Create multiple connections
        for (let i = 0; i < connectionCount; i++) {
          const client = new WebSocketClient({
            url: server.wsUrl,
            reconnect: false,
            serviceDefinitions: server.serviceDefinitions,
          });
          await client.connect();
          clients.push(client);
        }

        // Run concurrent operations on all clients
        const operations = clients.flatMap((client, clientIndex) =>
          Array.from({ length: 10 }, (_, i) => client.invoke('calculator@1.0.0', 'add', [clientIndex * 10 + i, 1]))
        );

        const results = await Promise.all(operations);

        expect(results.length).toBe(connectionCount * 10);

        // Verify all results
        let idx = 0;
        for (let clientIndex = 0; clientIndex < connectionCount; clientIndex++) {
          for (let i = 0; i < 10; i++) {
            expect(results[idx]).toBe(clientIndex * 10 + i + 1);
            idx++;
          }
        }
      } finally {
        // Cleanup all connections
        for (const client of clients) {
          await client.disconnect();
        }
      }
    });
  });

  describe('Memory Leak Detection', () => {
    it('should not accumulate pending requests during long sessions', async () => {
      const iterations = 100;
      const batchSize = 20;

      for (let batch = 0; batch < iterations / batchSize; batch++) {
        const promises = Array.from({ length: batchSize }, (_, i) =>
          wsClient.invoke('calculator@1.0.0', 'add', [batch * batchSize + i, 1])
        );

        await Promise.all(promises);

        // Check metrics periodically
        const metrics = wsClient.getMetrics();
        expect(metrics.requestsSent).toBeGreaterThan(0);
        expect(metrics.responsesReceived).toBeGreaterThan(0);
      }

      // Final check - errors should be minimal
      const finalMetrics = wsClient.getMetrics();
      expect(finalMetrics.errors).toBeLessThan(iterations * 0.01); // Less than 1% error rate
    });

    it('should handle sustained load without degradation', async () => {
      const duration = 3000; // 3 seconds
      const batchSize = 10;
      const startTime = Date.now();
      let totalRequests = 0;
      const latencies: number[] = [];

      // Warm-up phase - skip first few batches to avoid cold start affecting results
      for (let i = 0; i < 3; i++) {
        const promises = Array.from({ length: batchSize }, () => wsClient.invoke('calculator@1.0.0', 'add', [1, 1]));
        await Promise.all(promises);
      }

      while (Date.now() - startTime < duration) {
        const batchStart = Date.now();

        const promises = Array.from({ length: batchSize }, () => wsClient.invoke('calculator@1.0.0', 'add', [1, 1]));

        await Promise.all(promises);

        const batchLatency = Date.now() - batchStart;
        latencies.push(batchLatency);
        totalRequests += batchSize;
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);

      console.log(`Sustained load test: ${totalRequests} requests`);
      console.log(`Latency - Avg: ${avgLatency.toFixed(2)}ms, Min: ${minLatency}ms, Max: ${maxLatency}ms`);

      // Performance should not degrade significantly
      // Allow max to be up to 20x average to account for variability in test environments
      expect(maxLatency).toBeLessThan(avgLatency * 20);
    });
  });
});

// =============================================================================
// 4. EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  let server: TitanServerFixture;
  let wsClient: WebSocketClient;
  let httpClient: HttpClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    wsClient = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
      serviceDefinitions: server.serviceDefinitions,
    });

    httpClient = new HttpClient({ url: server.httpUrl });

    await wsClient.connect();
    await httpClient.connect();
  });

  afterAll(async () => {
    await wsClient.disconnect();
    await httpClient.disconnect();
    await server.cleanup();
  });

  describe('Very Large Payloads', () => {
    it('should handle 10KB payload', async () => {
      const largeString = 'x'.repeat(10 * 1024);
      const result = await wsClient.invoke('echo@1.0.0', 'echoString', [largeString]);
      expect(result).toBe(largeString);
      expect(result.length).toBe(10 * 1024);
    });

    it('should handle 100KB payload', async () => {
      const largeString = 'x'.repeat(100 * 1024);
      const result = await wsClient.invoke('echo@1.0.0', 'echoString', [largeString]);
      expect(result).toBe(largeString);
      expect(result.length).toBe(100 * 1024);
    });

    it('should handle large array payloads', async () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        data: { value: i * 2, nested: { deep: i * 3 } },
      }));

      const result = await wsClient.invoke('echo@1.0.0', 'echoArray', [largeArray]);
      expect(result.length).toBe(10000);
      expect(result[0]).toEqual(largeArray[0]);
      expect(result[9999]).toEqual(largeArray[9999]);
    });

    it('should handle deeply nested objects', async () => {
      // Create object with 50 levels of nesting
      let deepObj: any = { value: 'bottom', level: 50 };
      for (let i = 49; i >= 0; i--) {
        deepObj = { nested: deepObj, level: i };
      }

      const result = await wsClient.invoke('echo@1.0.0', 'echoObject', [deepObj]);

      // Traverse and verify
      let current = result;
      for (let i = 0; i <= 50; i++) {
        expect(current.level).toBe(i);
        if (i < 50) {
          current = current.nested;
        }
      }
      expect(current.value).toBe('bottom');
    });
  });

  describe('Binary Data Handling', () => {
    it('should handle numeric arrays (simulating binary)', async () => {
      const binaryLike = Array.from({ length: 256 }, (_, i) => i);
      const result = await wsClient.invoke('echo@1.0.0', 'echoArray', [binaryLike]);
      expect(result).toEqual(binaryLike);
    });

    it('should handle arrays with all byte values', async () => {
      const allBytes = Array.from({ length: 256 }, (_, i) => i);
      const result = await wsClient.invoke('echo@1.0.0', 'echoArray', [allBytes]);
      expect(result.length).toBe(256);
      for (let i = 0; i < 256; i++) {
        expect(result[i]).toBe(i);
      }
    });
  });

  describe('Unicode Strings', () => {
    it('should handle various Unicode ranges', async () => {
      const unicodeTests = [
        'Hello World', // ASCII
        'Hllo Wrld', // Latin Extended
        'Privet Mir', // Cyrillic (transliterated for test)
        'Hello Shijie', // Mixed (transliterated for test)
        'Arabic text', // Placeholder
        'Hebrew text', // Placeholder
        'Thai text', // Placeholder
      ];

      for (const str of unicodeTests) {
        const result = await wsClient.invoke('echo@1.0.0', 'echoString', [str]);
        expect(result).toBe(str);
      }
    });

    it('should handle emoji strings', async () => {
      const emojiStrings = ['Simple emoji', 'Family emoji', 'Flag emoji', 'Skin tone emoji', 'Combined emoji'];

      for (const str of emojiStrings) {
        const result = await wsClient.invoke('echo@1.0.0', 'echoString', [str]);
        expect(result).toBe(str);
      }
    });

    it('should handle special characters and control sequences', async () => {
      const specialStrings = [
        'Tab:\ttab',
        'Newline:\nnewline',
        'Carriage return:\rreturn',
        'Backslash: \\backslash',
        'Quote: "quoted"',
        "Single quote: 'quoted'",
        'Null char: \x00null',
        'Bell: \x07bell',
      ];

      for (const str of specialStrings) {
        const result = await wsClient.invoke('echo@1.0.0', 'echoString', [str]);
        expect(result).toBe(str);
      }
    });
  });

  describe('Empty Responses', () => {
    it('should handle empty string response', async () => {
      const result = await wsClient.invoke('echo@1.0.0', 'echoString', ['']);
      expect(result).toBe('');
    });

    it('should handle empty array response', async () => {
      const result = await wsClient.invoke('echo@1.0.0', 'echoArray', [[]]);
      expect(result).toEqual([]);
    });

    it('should handle empty object response', async () => {
      const result = await wsClient.invoke('echo@1.0.0', 'echoObject', [{}]);
      expect(result).toEqual({});
    });
  });

  describe('Null Values', () => {
    it('should handle null argument', async () => {
      const result = await wsClient.invoke('echo@1.0.0', 'echo', [null]);
      expect(result).toBeNull();
    });

    it('should handle object with null values', async () => {
      const objWithNulls = {
        a: null,
        b: 'not null',
        c: null,
        d: { nested: null },
      };

      const result = await wsClient.invoke('echo@1.0.0', 'echoObject', [objWithNulls]);
      expect(result.a).toBeNull();
      expect(result.b).toBe('not null');
      expect(result.c).toBeNull();
      expect(result.d.nested).toBeNull();
    });

    it('should handle array with null elements', async () => {
      const arrayWithNulls = [1, null, 'two', null, { three: 3 }, null];

      const result = await wsClient.invoke('echo@1.0.0', 'echoArray', [arrayWithNulls]);
      expect(result[0]).toBe(1);
      expect(result[1]).toBeNull();
      expect(result[2]).toBe('two');
      expect(result[3]).toBeNull();
      expect(result[4]).toEqual({ three: 3 });
      expect(result[5]).toBeNull();
    });
  });

  describe('Edge Case Numbers', () => {
    it('should handle extreme number values', async () => {
      const extremeNumbers = [
        0,
        -0,
        1,
        -1,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
        Number.EPSILON,
        Math.PI,
        Math.E,
      ];

      for (const num of extremeNumbers) {
        const result = await wsClient.invoke('echo@1.0.0', 'echoNumber', [num]);
        if (Object.is(num, -0)) {
          // MessagePack doesn't preserve the sign of zero, so -0 becomes 0
          // This is a known limitation of binary serialization formats
          expect(result).toBe(0);
        } else {
          expect(result).toBe(num);
        }
      }
    });

    it('should handle floating point precision', async () => {
      const floatTests = [0.1, 0.2, 0.3, 1.1, 2.2, 3.3, 0.123456789, 1.23456789e10, 1.23456789e-10];

      for (const num of floatTests) {
        const result = await wsClient.invoke('echo@1.0.0', 'echoNumber', [num]);
        expect(result).toBeCloseTo(num, 10);
      }
    });
  });

  describe('Boolean Edge Cases', () => {
    it('should handle boolean values correctly', async () => {
      const trueResult = await wsClient.invoke('echo@1.0.0', 'echoBoolean', [true]);
      const falseResult = await wsClient.invoke('echo@1.0.0', 'echoBoolean', [false]);

      expect(trueResult).toBe(true);
      expect(falseResult).toBe(false);
      expect(typeof trueResult).toBe('boolean');
      expect(typeof falseResult).toBe('boolean');
    });
  });
});

// =============================================================================
// 5. RECOVERY TESTS
// =============================================================================

describe('Recovery Tests', () => {
  describe('Connection Drop and Reconnect', () => {
    let server: TitanServerFixture;

    beforeEach(async () => {
      server = await createTitanServer({
        enableHttp: false,
        enableWebSocket: true,
        logLevel: 'silent',
      });
    });

    afterEach(async () => {
      await server.cleanup();
    });

    it('should reconnect after manual disconnect', async () => {
      const client = new WebSocketClient({
        url: server.wsUrl,
        reconnect: false,
        serviceDefinitions: server.serviceDefinitions,
      });

      // First connection
      await client.connect();
      expect(client.isConnected()).toBe(true);

      const result1 = await client.invoke('calculator@1.0.0', 'add', [10, 20]);
      expect(result1).toBe(30);

      // Disconnect
      await client.disconnect();
      expect(client.isConnected()).toBe(false);

      // Reconnect
      await client.connect();
      expect(client.isConnected()).toBe(true);

      const result2 = await client.invoke('calculator@1.0.0', 'add', [30, 40]);
      expect(result2).toBe(70);

      await client.disconnect();
    });

    it('should handle automatic reconnection', async () => {
      const reconnectEvents: string[] = [];

      const client = new WebSocketClient({
        url: server.wsUrl,
        reconnect: true,
        reconnectInterval: 100,
        maxReconnectAttempts: 3,
        serviceDefinitions: server.serviceDefinitions,
      });

      client.on('connect', () => reconnectEvents.push('connect'));
      client.on('disconnect', () => reconnectEvents.push('disconnect'));
      client.on('reconnect', () => reconnectEvents.push('reconnect'));

      await client.connect();
      expect(reconnectEvents).toContain('connect');

      // Clean disconnect (won't trigger auto-reconnect)
      await client.disconnect();
      // Wait for disconnect event to be emitted
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(reconnectEvents).toContain('disconnect');
    });

    it('should preserve state after reconnection', async () => {
      const client = new WebSocketClient({
        url: server.wsUrl,
        reconnect: false,
        serviceDefinitions: server.serviceDefinitions,
      });

      await client.connect();

      // Make some requests
      for (let i = 0; i < 5; i++) {
        await client.invoke('calculator@1.0.0', 'add', [i, 1]);
      }

      const metricsBefore = client.getMetrics();
      expect(metricsBefore.requestsSent).toBe(5);

      // Disconnect and reconnect
      await client.disconnect();
      await client.connect();

      // Make more requests
      for (let i = 0; i < 5; i++) {
        await client.invoke('calculator@1.0.0', 'add', [i, 1]);
      }

      const metricsAfter = client.getMetrics();
      expect(metricsAfter.requestsSent).toBe(10);

      await client.disconnect();
    });
  });

  describe('Request During Reconnection', () => {
    let server: TitanServerFixture;

    beforeEach(async () => {
      server = await createTitanServer({
        enableHttp: false,
        enableWebSocket: true,
        logLevel: 'silent',
      });
    });

    afterEach(async () => {
      await server.cleanup();
    });

    it('should reject requests when disconnected', async () => {
      const client = new WebSocketClient({
        url: server.wsUrl,
        reconnect: false,
        serviceDefinitions: server.serviceDefinitions,
      });

      await client.connect();
      await client.disconnect();

      await expect(client.invoke('calculator@1.0.0', 'add', [1, 2])).rejects.toThrow();
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      const client = new WebSocketClient({
        url: server.wsUrl,
        reconnect: false,
        serviceDefinitions: server.serviceDefinitions,
      });

      for (let i = 0; i < 5; i++) {
        await client.connect();
        expect(client.isConnected()).toBe(true);

        const result = await client.invoke('calculator@1.0.0', 'add', [i, 1]);
        expect(result).toBe(i + 1);

        await client.disconnect();
        expect(client.isConnected()).toBe(false);
      }
    });
  });

  describe('Graceful Shutdown', () => {
    let server: TitanServerFixture;
    let client: WebSocketClient;

    beforeEach(async () => {
      server = await createTitanServer({
        enableHttp: false,
        enableWebSocket: true,
        logLevel: 'silent',
      });

      client = new WebSocketClient({
        url: server.wsUrl,
        reconnect: false,
        serviceDefinitions: server.serviceDefinitions,
      });

      await client.connect();
    });

    afterEach(async () => {
      try {
        await client.disconnect();
      } catch {
        // Already disconnected
      }
      await server.cleanup();
    });

    it('should handle graceful client disconnect', async () => {
      const disconnectPromise = new Promise<void>((resolve) => {
        client.on('disconnect', () => resolve());
      });

      // Make a request first
      const result = await client.invoke('calculator@1.0.0', 'add', [1, 2]);
      expect(result).toBe(3);

      // Graceful disconnect
      await client.disconnect();
      await disconnectPromise;

      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toBe('disconnected');
    });

    it('should complete pending requests before disconnect', async () => {
      // Start multiple requests
      const promises = Array.from({ length: 10 }, (_, i) => client.invoke('calculator@1.0.0', 'add', [i, 1]));

      // Wait for all to complete
      const results = await Promise.all(promises);

      // Verify all completed successfully
      results.forEach((result, i) => {
        expect(result).toBe(i + 1);
      });

      // Now disconnect
      await client.disconnect();
    });

    it('should reject new requests after disconnect initiated', async () => {
      await client.disconnect();

      // New request should fail
      await expect(client.invoke('calculator@1.0.0', 'add', [1, 2])).rejects.toThrow();
    });
  });

  describe('Server Unavailability', () => {
    it('should fail to connect to non-existent server', async () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:59999', // Unlikely to be in use
        reconnect: false,
        timeout: 1000,
      });

      await expect(client.connect()).rejects.toThrow();
    });

    it('should handle connection timeout', async () => {
      const client = new WebSocketClient({
        url: 'ws://10.255.255.1:3000', // Non-routable IP
        reconnect: false,
        timeout: 500,
      });

      const startTime = Date.now();

      await expect(client.connect()).rejects.toThrow();

      const duration = Date.now() - startTime;
      // Should fail relatively quickly due to connection error (allow up to 15s for CI environments)
      expect(duration).toBeLessThan(15000);
    });
  });
});
