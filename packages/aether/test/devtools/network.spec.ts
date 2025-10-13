/**
 * Network Inspector Tests - Network Inspector Tests
 *
 * Comprehensive test coverage for the DevTools network inspector,
 * including request/response tracking, WebSocket monitoring, and cache statistics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNetworkInspector } from '../../src/devtools/network.js';
import type { NetworkInspector, NetworkEvent } from '../../src/devtools/types.js';

describe('DevTools Network Inspector', () => {
  let inspector: NetworkInspector;

  beforeEach(() => {
    inspector = createNetworkInspector();
    vi.clearAllMocks();
  });

  afterEach(() => {
    inspector.clear();
  });

  describe('Request Interception', () => {
    it('should intercept netron request', () => {
      const request = {
        service: 'UserService',
        method: 'getUser',
        args: [123],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      expect(state.events.length).toBe(1);

      const event = state.events[0];
      expect(event.type).toBe('request');
      expect(event.service).toBe('UserService');
      expect(event.method).toBe('getUser');
      expect(event.request).toEqual([123]);
    });

    it('should track request timing', () => {
      const request = {
        service: 'TestService',
        method: 'testMethod',
        args: [],
      };

      vi.spyOn(performance, 'now').mockReturnValue(100);

      inspector.interceptRequest(request);

      const state = inspector.getState();
      expect(state.events[0].timestamp).toBeGreaterThan(0);
    });

    it('should serialize complex request payloads', () => {
      const request = {
        service: 'DataService',
        method: 'create',
        args: [
          {
            user: { id: 1, name: 'Alice' },
            metadata: { created: new Date() },
          },
        ],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      const event = state.events[0];

      expect(event.request).toBeDefined();
      expect(event.request[0].user.name).toBe('Alice');
    });

    it('should handle circular references in request', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      const request = {
        service: 'TestService',
        method: 'test',
        args: [circular],
      };

      expect(() => {
        inspector.interceptRequest(request);
      }).not.toThrow();

      const state = inspector.getState();
      expect(state.events.length).toBe(1);
    });
  });

  describe('Response Logging', () => {
    it('should log response with duration', () => {
      const request = {
        service: 'UserService',
        method: 'getUser',
        args: [123],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      const requestId = state.events[0].id;

      const response = {
        id: requestId,
        requestId,
        result: { id: 123, name: 'Alice' },
        cached: false,
      };

      inspector.logResponse(response);

      const updatedState = inspector.getState();
      const event = updatedState.events[0];

      expect(event.type).toBe('response');
      expect(event.response).toEqual({ id: 123, name: 'Alice' });
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });

    it('should track cache hits', () => {
      const request = {
        service: 'UserService',
        method: 'getUser',
        args: [123],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      const requestId = state.events[0].id;

      const response = {
        id: requestId,
        requestId,
        result: { id: 123, name: 'Alice' },
        cached: true,
        cacheKey: 'user:123',
      };

      inspector.logResponse(response);

      const cacheStats = inspector.getCacheStats();
      expect(cacheStats.hits).toBe(1);
      expect(cacheStats.misses).toBe(0);
    });

    it('should track cache misses', () => {
      const request = {
        service: 'UserService',
        method: 'getUser',
        args: [123],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      const requestId = state.events[0].id;

      const response = {
        id: requestId,
        requestId,
        result: { id: 123, name: 'Alice' },
        cached: false,
      };

      inspector.logResponse(response);

      const cacheStats = inspector.getCacheStats();
      expect(cacheStats.hits).toBe(0);
      expect(cacheStats.misses).toBe(1);
    });

    it('should calculate cache hit rate', () => {
      // Hit
      inspector.interceptRequest({ service: 'Test', method: 'get', args: [] });
      const event1 = inspector.getState().events[0];
      inspector.logResponse({
        id: event1.id,
        requestId: event1.id,
        result: {},
        cached: true,
      });

      // Miss
      inspector.interceptRequest({ service: 'Test', method: 'get', args: [] });
      const event2 = inspector.getState().events[1];
      inspector.logResponse({
        id: event2.id,
        requestId: event2.id,
        result: {},
        cached: false,
      });

      const cacheStats = inspector.getCacheStats();
      expect(cacheStats.hitRate).toBe(0.5); // 1 hit out of 2 total
    });

    it('should handle standalone responses', () => {
      const response = {
        service: 'NotificationService',
        method: 'onNotification',
        result: { message: 'New notification' },
        cached: false,
      };

      inspector.logResponse(response);

      const state = inspector.getState();
      expect(state.events.length).toBe(1);
      expect(state.events[0].type).toBe('response');
    });
  });

  describe('Error Tracking', () => {
    it('should log request errors with duration', () => {
      const request = {
        service: 'ErrorService',
        method: 'failingMethod',
        args: [],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      const requestId = state.events[0].id;

      const error = new Error('Request failed');
      (inspector as any).logError(error, requestId);

      const updatedState = inspector.getState();
      const event = updatedState.events[0];

      expect(event.type).toBe('error');
      expect(event.error).toBeDefined();
      expect(event.error?.message).toBe('Request failed');
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });

    it('should log standalone errors', () => {
      const error = new Error('Standalone error');
      (inspector as any).logError(error);

      const state = inspector.getState();
      expect(state.events.length).toBe(1);
      expect(state.events[0].type).toBe('error');
    });

    it('should include error stack traces', () => {
      const error = new Error('Test error');
      (inspector as any).logError(error);

      const state = inspector.getState();
      const event = state.events[0];

      expect(event.error?.stack).toBeDefined();
    });

    it('should handle non-Error objects', () => {
      (inspector as any).logError('String error');

      const state = inspector.getState();
      const event = state.events[0];

      expect(event.error?.message).toBe('String error');
    });
  });

  describe('WebSocket Tracking', () => {
    it('should track WebSocket connection', () => {
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn(),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      const state = inspector.getState();
      expect(state.connections.size).toBe(1);

      const connection = Array.from(state.connections.values())[0];
      expect(connection.url).toBe('ws://localhost:3000');
      expect(connection.state).toBe('connecting');
    });

    it('should intercept WebSocket send', () => {
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn(),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      // Send message
      mockWs.send('test message');

      const state = inspector.getState();
      const connection = Array.from(state.connections.values())[0];

      expect(connection.messageCount).toBe(1);
      expect(connection.bytesSent).toBeGreaterThan(0);
    });

    it('should track WebSocket open event', () => {
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'open') {
            handler();
          }
        }),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      const state = inspector.getState();
      const openEvents = state.events.filter((e) => e.wsEvent === 'open');
      expect(openEvents.length).toBe(1);
    });

    it('should track WebSocket message events', () => {
      let messageHandler: any;
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'message') {
            messageHandler = handler;
          }
        }),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      // Simulate message
      messageHandler({ data: 'received message' });

      const state = inspector.getState();
      const connection = Array.from(state.connections.values())[0];

      expect(connection.messageCount).toBe(1);
      expect(connection.bytesReceived).toBeGreaterThan(0);
    });

    it('should track WebSocket close event', () => {
      let closeHandler: any;
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'close') {
            closeHandler = handler;
          }
        }),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      // Simulate close
      closeHandler();

      const state = inspector.getState();
      const closeEvents = state.events.filter((e) => e.wsEvent === 'close');
      expect(closeEvents.length).toBe(1);

      const connection = Array.from(state.connections.values())[0];
      expect(connection.state).toBe('closed');
    });

    it('should track WebSocket error event', () => {
      let errorHandler: any;
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'error') {
            errorHandler = handler;
          }
        }),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      // Simulate error
      errorHandler(new Event('error'));

      const state = inspector.getState();
      const errorEvents = state.events.filter((e) => e.wsEvent === 'error');
      expect(errorEvents.length).toBe(1);
    });

    it('should serialize JSON WebSocket messages', () => {
      let messageHandler: any;
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'message') {
            messageHandler = handler;
          }
        }),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      // Simulate JSON message
      const jsonData = JSON.stringify({ type: 'update', data: { id: 1 } });
      messageHandler({ data: jsonData });

      const state = inspector.getState();
      const messageEvents = state.events.filter((e) => e.wsEvent === 'message');
      const messageEvent = messageEvents[0];

      expect(messageEvent.response).toBeDefined();
      expect(typeof messageEvent.response).toBe('object');
    });

    it('should handle ArrayBuffer WebSocket messages', () => {
      let messageHandler: any;
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'message') {
            messageHandler = handler;
          }
        }),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      const buffer = new ArrayBuffer(8);
      messageHandler({ data: buffer });

      const state = inspector.getState();
      const messageEvents = state.events.filter((e) => e.wsEvent === 'message');
      expect(messageEvents.length).toBe(1);
    });
  });

  describe('Network Timeline', () => {
    it('should return events sorted by timestamp', () => {
      inspector.interceptRequest({ service: 'S1', method: 'm1', args: [] });
      inspector.interceptRequest({ service: 'S2', method: 'm2', args: [] });
      inspector.interceptRequest({ service: 'S3', method: 'm3', args: [] });

      const timeline = inspector.getNetworkTimeline();

      expect(timeline.length).toBe(3);

      // Check chronological order
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i].timestamp).toBeGreaterThanOrEqual(timeline[i - 1].timestamp);
      }
    });

    it('should include all event types in timeline', () => {
      inspector.interceptRequest({ service: 'Test', method: 'test', args: [] });

      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn(),
      } as any;
      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      const timeline = inspector.getNetworkTimeline();

      expect(timeline.length).toBeGreaterThan(1);
      expect(timeline.some((e) => e.type === 'request')).toBe(true);
      expect(timeline.some((e) => e.type === 'websocket')).toBe(true);
    });
  });

  describe('Event Filtering', () => {
    it('should filter events by type', () => {
      inspector.interceptRequest({ service: 'Test', method: 'test', args: [] });
      const event = inspector.getState().events[0];
      inspector.logResponse({ id: event.id, requestId: event.id, result: {} });

      const requests = (inspector as any).getEventsByType('request');
      const responses = (inspector as any).getEventsByType('response');

      expect(requests.length).toBe(0); // Request was updated to response
      expect(responses.length).toBe(1);
    });

    it('should filter events by service', () => {
      inspector.interceptRequest({ service: 'ServiceA', method: 'test', args: [] });
      inspector.interceptRequest({ service: 'ServiceB', method: 'test', args: [] });
      inspector.interceptRequest({ service: 'ServiceA', method: 'test2', args: [] });

      const serviceAEvents = (inspector as any).getEventsByService('ServiceA');

      expect(serviceAEvents.length).toBe(2);
      expect(serviceAEvents.every((e: NetworkEvent) => e.service === 'ServiceA')).toBe(true);
    });

    it('should get active connections', () => {
      const mockWs1 = {
        send: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'open') handler();
        }),
      } as any;

      const mockWs2 = {
        send: vi.fn(),
        addEventListener: vi.fn(),
      } as any;

      inspector.trackWebSocket(mockWs1, 'ws://localhost:3000');
      inspector.trackWebSocket(mockWs2, 'ws://localhost:3001');

      const activeConnections = (inspector as any).getActiveConnections();

      expect(activeConnections.length).toBe(2);
    });
  });

  describe('Cleanup and Memory Management', () => {
    it('should clear events', () => {
      inspector.interceptRequest({ service: 'Test', method: 'test', args: [] });
      inspector.interceptRequest({ service: 'Test', method: 'test', args: [] });

      inspector.clear();

      const state = inspector.getState();
      expect(state.events.length).toBe(0);
    });

    it('should reset cache statistics', () => {
      inspector.interceptRequest({ service: 'Test', method: 'test', args: [] });
      const event = inspector.getState().events[0];
      inspector.logResponse({
        id: event.id,
        requestId: event.id,
        result: {},
        cached: true,
      });

      inspector.clear();

      const cacheStats = inspector.getCacheStats();
      expect(cacheStats.hits).toBe(0);
      expect(cacheStats.misses).toBe(0);
      expect(cacheStats.hitRate).toBe(0);
    });

    it('should clear connections', () => {
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn(),
      } as any;

      inspector.trackWebSocket(mockWs, 'ws://localhost:3000');

      (inspector as any).clearConnections();

      const state = inspector.getState();
      expect(state.connections.size).toBe(0);
    });

    it('should handle large number of events', () => {
      for (let i = 0; i < 1000; i++) {
        inspector.interceptRequest({
          service: `Service${i}`,
          method: 'method',
          args: [i],
        });
      }

      const state = inspector.getState();
      expect(state.events.length).toBe(1000);

      inspector.clear();

      const clearedState = inspector.getState();
      expect(clearedState.events.length).toBe(0);
    });
  });

  describe('Serialization', () => {
    it('should serialize deep objects with depth limit', () => {
      const deepObject: any = { level: 1 };
      let current = deepObject;

      for (let i = 2; i <= 10; i++) {
        current.next = { level: i };
        current = current.next;
      }

      const request = {
        service: 'Test',
        method: 'test',
        args: [deepObject],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      const event = state.events[0];

      expect(event.request).toBeDefined();
    });

    it('should handle circular references safely', () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      circular.nested = { ref: circular };

      const request = {
        service: 'Test',
        method: 'test',
        args: [circular],
      };

      expect(() => {
        inspector.interceptRequest(request);
      }).not.toThrow();
    });

    it('should handle arrays in payloads', () => {
      const request = {
        service: 'Test',
        method: 'batch',
        args: [
          [1, 2, 3],
          ['a', 'b', 'c'],
          [{ id: 1 }, { id: 2 }],
        ],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      const event = state.events[0];

      expect(Array.isArray(event.request[0])).toBe(true);
      expect(event.request[0].length).toBe(3);
    });

    it('should mark unserializable values', () => {
      const unserializable: any = {};
      Object.defineProperty(unserializable, 'circular', {
        get() {
          return unserializable;
        },
      });

      const request = {
        service: 'Test',
        method: 'test',
        args: [unserializable],
      };

      expect(() => {
        inspector.interceptRequest(request);
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values in requests', () => {
      const request = {
        service: 'Test',
        method: 'test',
        args: [null],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      expect(state.events[0].request).toEqual([null]);
    });

    it('should handle undefined values in requests', () => {
      const request = {
        service: 'Test',
        method: 'test',
        args: [undefined],
      };

      inspector.interceptRequest(request);

      const state = inspector.getState();
      expect(state.events.length).toBe(1);
    });

    it('should handle empty cache stats', () => {
      const stats = inspector.getCacheStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should generate unique event IDs', () => {
      inspector.interceptRequest({ service: 'S1', method: 'm1', args: [] });
      inspector.interceptRequest({ service: 'S2', method: 'm2', args: [] });

      const state = inspector.getState();
      expect(state.events[0].id).not.toBe(state.events[1].id);
    });

    it('should generate unique connection IDs', () => {
      const mockWs1 = { send: vi.fn(), addEventListener: vi.fn() } as any;
      const mockWs2 = { send: vi.fn(), addEventListener: vi.fn() } as any;

      inspector.trackWebSocket(mockWs1, 'ws://localhost:3000');
      inspector.trackWebSocket(mockWs2, 'ws://localhost:3001');

      const state = inspector.getState();
      const connections = Array.from(state.connections.values());

      expect(connections[0].id).not.toBe(connections[1].id);
    });
  });
});
