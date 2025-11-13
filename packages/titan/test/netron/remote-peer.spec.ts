/**
 * Comprehensive RemotePeer Tests
 * Tests for remote peer communication and service management
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { Definition } from '../../src/netron/definition.js';
import { Service, Method } from '../../src/decorators/index.js';
import { createLogger } from '../utils/test-logger.js';
import { 
  Packet, 
  TYPE_GET, 
  TYPE_SET, 
  TYPE_CALL, 
  TYPE_TASK,
  TYPE_STREAM,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
  createPacket,
  encodePacket,
} from '../../src/netron/packet/index.js';

describe('RemotePeer - Comprehensive Tests', () => {
  let logger: any;
  let netron: Netron;
  let mockSocket: any;
  let remotePeer: RemotePeer;

  beforeEach(() => {
    logger = createLogger();
    netron = new Netron(logger, { id: 'test-netron' });

    // Create mock socket that mimics WebSocket/TransportAdapter
    mockSocket = {
      on: jest.fn(),
      once: jest.fn(),
      send: jest.fn((data: any, options: any, callback?: any) => {
        if (callback) callback();
      }),
      close: jest.fn().mockResolvedValue(undefined),
      readyState: 'OPEN',
    };

    remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-123');
  });

  afterEach(async () => {
    if (remotePeer && mockSocket.readyState === 'OPEN') {
      await remotePeer.close();
    }
    if (netron) {
      await netron.stop();
    }
  });

  describe('Initialization', () => {
    it('should create RemotePeer with ID', () => {
      expect(remotePeer).toBeDefined();
      expect(remotePeer.id).toBe('remote-peer-123');
    });

    it('should initialize with socket', async () => {
      await remotePeer.init(false);
      
      expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should set request timeout', () => {
      const peerWithTimeout = new RemotePeer(mockSocket, netron, 'timeout-peer', 10000);
      expect(peerWithTimeout['requestTimeout']).toBe(10000);
    });

    it('should initialize as connector', async () => {
      await remotePeer.init(true);
      
      expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should handle initialization options', async () => {
      const options = {
        taskTimeout: 5000,
        allowServiceEvents: true,
      };

      await remotePeer.init(false, options);
      expect(mockSocket.on).toHaveBeenCalled();
    });
  });

  describe('Service Exposure', () => {
    it('should expose service', async () => {
      @Service({ name: 'TestService', version: '1.0.0' })
      class TestService {
        @Method()
        async getValue() {
          return 'test-value';
        }
      }

      const service = new TestService();
      
      // Mock successful runTask response
      remotePeer.runTask = jest.fn().mockResolvedValue({
        id: 'def-123',
        meta: { name: 'TestService', version: '1.0.0' },
      });

      const definition = await remotePeer.exposeService(service);
      
      expect(definition).toBeDefined();
      expect(remotePeer.runTask).toHaveBeenCalledWith('expose_service', expect.any(Object));
    });

    it('should throw when exposing service without metadata', async () => {
      class InvalidService {
        getValue() {
          return 'value';
        }
      }

      await expect(remotePeer.exposeService(new InvalidService())).rejects.toThrow(/invalid service/i);
    });

    it('should prevent duplicate service exposure', async () => {
      @Service({ name: 'DuplicateService', version: '1.0.0' })
      class DuplicateService {
        @Method()
        async test() {}
      }

      remotePeer.runTask = jest.fn().mockResolvedValue({
        id: 'def-123',
        meta: { name: 'DuplicateService', version: '1.0.0' },
      });

      const service = new DuplicateService();
      remotePeer.services.set('DuplicateService', {} as any);

      await expect(remotePeer.exposeService(service)).rejects.toThrow(/already exposed/i);
    });
  });

  describe('Service Unexposure', () => {
    it('should unexpose service', async () => {
      remotePeer.runTask = jest.fn().mockResolvedValue('def-123');
      
      await remotePeer.unexposeService('TestService');
      
      expect(remotePeer.runTask).toHaveBeenCalledWith('unexpose_service', 'TestService');
    });

    it('should cleanup associated interfaces on unexpose', async () => {
      const mockInterface = {
        $def: { id: 'def-123', parentId: 'parent-123' },
      };

      remotePeer.interfaces.set('interface-123', mockInterface as any);
      remotePeer.runTask = jest.fn().mockResolvedValue('parent-123');

      await remotePeer.unexposeService('TestService');

      expect(remotePeer.runTask).toHaveBeenCalled();
    });
  });

  describe('Event Subscription', () => {
    it('should subscribe to event', async () => {
      const handler = jest.fn();
      remotePeer.runTask = jest.fn().mockResolvedValue(undefined);

      await remotePeer.subscribe('test-event', handler);

      expect(remotePeer.eventSubscribers.has('test-event')).toBe(true);
      expect(remotePeer.eventSubscribers.get('test-event')).toContain(handler);
      expect(remotePeer.runTask).toHaveBeenCalledWith('subscribe', 'test-event');
    });

    it('should not re-subscribe if already subscribed', async () => {
      const handler = jest.fn();
      remotePeer.runTask = jest.fn().mockResolvedValue(undefined);

      await remotePeer.subscribe('test-event', handler);
      remotePeer.runTask = jest.fn().mockResolvedValue(undefined);
      await remotePeer.subscribe('test-event', handler);

      expect(remotePeer.runTask).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from event', async () => {
      const handler = jest.fn();
      remotePeer.runTask = jest.fn().mockResolvedValue(undefined);

      await remotePeer.subscribe('test-event', handler);
      await remotePeer.unsubscribe('test-event', handler);

      expect(remotePeer.eventSubscribers.has('test-event')).toBe(false);
      expect(remotePeer.runTask).toHaveBeenCalledWith('unsubscribe', 'test-event');
    });
  });

  describe('RPC Operations', () => {
    it('should get property value', async () => {
      const definition = {
        id: 'def-123',
        meta: { name: 'TestService' },
      } as Definition;

      remotePeer.definitions.set('def-123', definition);

      // Simulate successful response
      setTimeout(() => {
        const responseHandler = remotePeer['responseHandlers'].get(1);
        if (responseHandler) {
          responseHandler.successHandler({ data: 'property-value' } as any);
        }
      }, 10);

      mockSocket.send = jest.fn();
      const result = await remotePeer.get('def-123', 'testProperty');

      expect(mockSocket.send).toHaveBeenCalled();
    });

    it('should set property value', async () => {
      const definition = {
        id: 'def-123',
        meta: { name: 'TestService' },
      } as Definition;

      remotePeer.definitions.set('def-123', definition);

      setTimeout(() => {
        const responseHandler = remotePeer['responseHandlers'].get(1);
        if (responseHandler) {
          responseHandler.successHandler(undefined);
        }
      }, 10);

      mockSocket.send = jest.fn();
      await remotePeer.set('def-123', 'testProperty', 'new-value');

      expect(mockSocket.send).toHaveBeenCalled();
    });

    it('should call remote method', async () => {
      const definition = {
        id: 'def-123',
        meta: { name: 'TestService' },
      } as Definition;

      remotePeer.definitions.set('def-123', definition);

      setTimeout(() => {
        const responseHandler = remotePeer['responseHandlers'].get(1);
        if (responseHandler) {
          responseHandler.successHandler({ data: 'method-result' } as any);
        }
      }, 10);

      mockSocket.send = jest.fn();
      const result = await remotePeer.call('def-123', 'testMethod', ['arg1', 'arg2']);

      expect(mockSocket.send).toHaveBeenCalled();
    });

    it('should throw error for unknown definition in get', async () => {
      await expect(remotePeer.get('unknown-def', 'prop')).rejects.toThrow(/not found/i);
    });

    it('should throw error for unknown definition in set', async () => {
      await expect(remotePeer.set('unknown-def', 'prop', 'value')).rejects.toThrow(/not found/i);
    });

    it('should throw error for unknown definition in call', async () => {
      await expect(remotePeer.call('unknown-def', 'method', [])).rejects.toThrow(/not found/i);
    });
  });

  describe('Task Execution', () => {
    it('should run task', async () => {
      setTimeout(() => {
        const responseHandler = remotePeer['responseHandlers'].get(1);
        if (responseHandler) {
          responseHandler.successHandler('task-result');
        }
      }, 10);

      mockSocket.send = jest.fn();
      const result = await remotePeer.runTask('test_task', 'arg1', 'arg2');

      expect(mockSocket.send).toHaveBeenCalled();
    });

    it('should handle task errors', async () => {
      setTimeout(() => {
        const responseHandler = remotePeer['responseHandlers'].get(1);
        if (responseHandler?.errorHandler) {
          responseHandler.errorHandler(new Error('Task failed'));
        }
      }, 10);

      mockSocket.send = jest.fn();
      
      await expect(remotePeer.runTask('failing_task')).rejects.toThrow('Task failed');
    });
  });

  describe('Packet Handling', () => {
    it('should handle GET packet', async () => {
      const packet = createPacket(1, 1, TYPE_GET, ['def-123', 'property']);
      
      const mockStub = {
        get: jest.fn().mockResolvedValue('property-value'),
      };

      netron.peer.getStubByDefinitionId = jest.fn().mockReturnValue(mockStub);
      remotePeer['sendResponse'] = jest.fn();

      await remotePeer.handlePacket(packet);

      expect(mockStub.get).toHaveBeenCalledWith('property');
      expect(remotePeer['sendResponse']).toHaveBeenCalledWith(packet, 'property-value');
    });

    it('should handle SET packet', async () => {
      const packet = createPacket(2, 1, TYPE_SET, ['def-123', 'property', 'new-value']);
      
      const mockStub = {
        set: jest.fn().mockResolvedValue(undefined),
      };

      netron.peer.getStubByDefinitionId = jest.fn().mockReturnValue(mockStub);
      remotePeer['sendResponse'] = jest.fn();

      await remotePeer.handlePacket(packet);

      expect(mockStub.set).toHaveBeenCalledWith('property', 'new-value');
      expect(remotePeer['sendResponse']).toHaveBeenCalledWith(packet, undefined);
    });

    it('should handle CALL packet', async () => {
      const packet = createPacket(3, 1, TYPE_CALL, ['def-123', 'method', 'arg1', 'arg2']);
      
      const mockStub = {
        call: jest.fn().mockResolvedValue('call-result'),
      };

      netron.peer.getStubByDefinitionId = jest.fn().mockReturnValue(mockStub);
      remotePeer['sendResponse'] = jest.fn();

      await remotePeer.handlePacket(packet);

      expect(mockStub.call).toHaveBeenCalledWith('method', ['arg1', 'arg2'], remotePeer);
      expect(remotePeer['sendResponse']).toHaveBeenCalledWith(packet, 'call-result');
    });

    it('should handle TASK packet', async () => {
      const packet = createPacket(4, 1, TYPE_TASK, ['test_task', 'arg1']);
      
      netron.runTask = jest.fn().mockResolvedValue('task-result');
      remotePeer['sendResponse'] = jest.fn();

      await remotePeer.handlePacket(packet);

      expect(netron.runTask).toHaveBeenCalledWith(remotePeer, 'test_task', 'arg1');
      expect(remotePeer['sendResponse']).toHaveBeenCalledWith(packet, 'task-result');
    });

    it('should handle STREAM packet', async () => {
      const packet = createPacket(5, 1, TYPE_STREAM, 'chunk-data');
      packet.streamId = 123;
      packet.streamIndex = 0;

      await remotePeer.handlePacket(packet);

      expect(remotePeer.readableStreams.has(123)).toBe(true);
    });

    it('should handle STREAM_ERROR packet', async () => {
      const streamId = 456;
      const packet = createPacket(6, 1, TYPE_STREAM_ERROR, {
        streamId,
        message: 'Stream error',
      });

      const mockStream = {
        destroy: jest.fn(),
      };

      remotePeer.readableStreams.set(streamId, mockStream as any);

      await remotePeer.handlePacket(packet);

      expect(mockStream.destroy).toHaveBeenCalled();
    });

    it('should handle STREAM_CLOSE packet', async () => {
      const streamId = 789;
      const packet = createPacket(7, 1, TYPE_STREAM_CLOSE, {
        streamId,
        reason: 'Stream closed',
      });

      const mockStream = {
        forceClose: jest.fn(),
      };

      remotePeer.readableStreams.set(streamId, mockStream as any);

      await remotePeer.handlePacket(packet);

      expect(mockStream.forceClose).toHaveBeenCalledWith('Stream closed');
    });

    it('should handle packet errors gracefully', async () => {
      const packet = createPacket(8, 1, TYPE_GET, ['def-123', 'property']);
      
      netron.peer.getStubByDefinitionId = jest.fn().mockImplementation(() => {
        throw new Error('Stub not found');
      });

      remotePeer['sendErrorResponse'] = jest.fn();

      await remotePeer.handlePacket(packet);

      expect(remotePeer['sendErrorResponse']).toHaveBeenCalledWith(packet, expect.any(Error));
    });
  });

  describe('Stream Management', () => {
    it('should send stream chunk', async () => {
      mockSocket.send = jest.fn();

      await remotePeer.sendStreamChunk(123, 'chunk-data', 0, false, false);

      expect(mockSocket.send).toHaveBeenCalled();
    });

    it('should track writable streams', () => {
      const mockWritableStream = {
        write: jest.fn(),
      };

      remotePeer.writableStreams.set(123, mockWritableStream as any);

      expect(remotePeer.writableStreams.has(123)).toBe(true);
      expect(remotePeer.writableStreams.get(123)).toBe(mockWritableStream);
    });

    it('should track readable streams', () => {
      const mockReadableStream = {
        read: jest.fn(),
      };

      remotePeer.readableStreams.set(456, mockReadableStream as any);

      expect(remotePeer.readableStreams.has(456)).toBe(true);
      expect(remotePeer.readableStreams.get(456)).toBe(mockReadableStream);
    });
  });

  describe('Connection Management', () => {
    it('should disconnect', async () => {
      await remotePeer.disconnect();

      expect(mockSocket.close).toHaveBeenCalled();
    });

    it('should handle close', async () => {
      await remotePeer.close();

      expect(mockSocket.close).toHaveBeenCalled();
    });

    it('should cleanup resources on disconnect', async () => {
      remotePeer.writableStreams.set(1, {} as any);
      remotePeer.readableStreams.set(2, {} as any);
      remotePeer.eventSubscribers.set('test', []);

      await remotePeer.disconnect();

      expect(remotePeer.writableStreams.size).toBe(0);
      expect(remotePeer.readableStreams.size).toBe(0);
      expect(remotePeer.eventSubscribers.size).toBe(0);
    });

    it('should emit manual-disconnect event', async () => {
      const disconnectHandler = jest.fn();
      remotePeer.once('manual-disconnect', disconnectHandler);

      await remotePeer.disconnect();

      expect(disconnectHandler).toHaveBeenCalled();
    });

    it('should handle socket not open state', async () => {
      mockSocket.readyState = 'CLOSED';

      await expect(remotePeer.disconnect()).resolves.not.toThrow();
    });
  });

  describe('Definition Management', () => {
    it('should reference service definition', () => {
      const parentDef = {
        id: 'parent-123',
        meta: { name: 'ParentService' },
      } as Definition;

      const childDef = {
        id: 'child-456',
        meta: { name: 'ChildService' },
      } as Definition;

      const result = remotePeer.refService(childDef, parentDef);

      expect(result.parentId).toBe('parent-123');
      expect(remotePeer.definitions.has('child-456')).toBe(true);
    });

    it('should return existing definition on re-reference', () => {
      const parentDef = { id: 'parent-123' } as Definition;
      const childDef = { id: 'child-456' } as Definition;

      remotePeer.definitions.set('child-456', childDef);

      const result = remotePeer.refService(childDef, parentDef);

      expect(result).toBe(childDef);
    });

    it('should unreference service definition', () => {
      const definition = {
        id: 'def-789',
        meta: { name: 'TestService', version: '1.0.0' },
      } as Definition;

      remotePeer.definitions.set('def-789', definition);
      remotePeer.unrefService('def-789');

      expect(remotePeer.definitions.has('def-789')).toBe(false);
    });

    it('should get service names', () => {
      remotePeer.services.set('Service1', {} as any);
      remotePeer.services.set('Service2', {} as any);

      const names = remotePeer.getServiceNames();

      expect(names).toContain('Service1');
      expect(names).toContain('Service2');
      expect(names.length).toBe(2);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate all definitions', () => {
      remotePeer.services.set('Service1', {} as any);
      remotePeer.definitions.set('def-1', {} as any);

      const count = remotePeer.invalidateDefinitionCache();

      expect(count).toBeGreaterThan(0);
      expect(remotePeer.services.size).toBe(0);
      expect(remotePeer.definitions.size).toBe(0);
    });

    it('should invalidate definitions by pattern', () => {
      remotePeer.services.set('TestService@1.0.0', { id: 'def-1' } as any);
      remotePeer.services.set('OtherService@1.0.0', { id: 'def-2' } as any);
      remotePeer.definitions.set('def-1', {} as any);
      remotePeer.definitions.set('def-2', {} as any);

      remotePeer.invalidateDefinitionCache('Test*');

      expect(remotePeer.services.has('TestService@1.0.0')).toBe(false);
      expect(remotePeer.services.has('OtherService@1.0.0')).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should set authentication context', () => {
      const authContext = {
        userId: 'user-123',
        roles: ['admin'],
        permissions: ['read', 'write'],
      };

      remotePeer.setAuthContext(authContext);

      expect(remotePeer.getAuthContext()).toEqual(authContext);
      expect(remotePeer.isAuthenticated()).toBe(true);
    });

    it('should clear authentication context', () => {
      const authContext = {
        userId: 'user-123',
        roles: ['admin'],
        permissions: ['read'],
      };

      remotePeer.setAuthContext(authContext);
      remotePeer.clearAuthContext();

      expect(remotePeer.getAuthContext()).toBeUndefined();
      expect(remotePeer.isAuthenticated()).toBe(false);
    });

    it('should check authentication status', () => {
      expect(remotePeer.isAuthenticated()).toBe(false);

      remotePeer.setAuthContext({
        userId: 'user-123',
        roles: [],
        permissions: [],
      });

      expect(remotePeer.isAuthenticated()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle packet decode errors', async () => {
      const messageHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        // Send invalid binary data
        await messageHandler(Buffer.from('invalid'), true);
      }

      // Should log error but not throw
      expect(logger.child().error).toHaveBeenCalled();
    });

    it('should handle non-binary messages', async () => {
      const messageHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        await messageHandler('text message', false);
      }

      expect(logger.child().warn).toHaveBeenCalled();
    });

    it('should handle send errors', async () => {
      mockSocket.send = jest.fn((data: any, options: any, callback: any) => {
        callback(new Error('Send failed'));
      });

      const packet = createPacket(1, 1, TYPE_GET, ['def-123', 'prop']);

      await expect(remotePeer.sendPacket(packet)).rejects.toThrow('Send failed');
    });

    it('should handle socket closed during send', async () => {
      mockSocket.readyState = 'CLOSED';

      const packet = createPacket(1, 1, TYPE_GET, ['def-123', 'prop']);

      await expect(remotePeer.sendPacket(packet)).rejects.toThrow(/closed/i);
    });
  });

  describe('Request Timeout', () => {
    it('should timeout requests', async () => {
      const shortTimeoutPeer = new RemotePeer(mockSocket, netron, 'timeout-peer', 100);
      
      const definition = { id: 'def-123', meta: { name: 'Test' } } as Definition;
      shortTimeoutPeer.definitions.set('def-123', definition);

      // Don't send response - let it timeout
      mockSocket.send = jest.fn();

      await expect(shortTimeoutPeer.get('def-123', 'prop')).rejects.toThrow(/timeout/i);
    });
  });

  describe('Query Interface', () => {
    it('should query interface remotely', async () => {
      remotePeer.runTask = jest.fn().mockResolvedValue({
        id: 'def-123',
        meta: {
          name: 'TestService',
          version: '1.0.0',
          methods: { testMethod: {} },
        },
      });

      const interfaceInstance = await remotePeer.queryInterface('TestService@1.0.0');

      expect(interfaceInstance).toBeDefined();
      expect(remotePeer.runTask).toHaveBeenCalledWith('query_interface', 'TestService@1.0.0');
    });

    it('should throw when service not found', async () => {
      remotePeer.runTask = jest.fn().mockResolvedValue(null);

      await expect(remotePeer.queryInterface('NonExistent@1.0.0')).rejects.toThrow(/not found/i);
    });
  });

  describe('Logger Integration', () => {
    it('should use child logger with peer context', () => {
      expect(remotePeer.logger).toBeDefined();
      expect(netron.logger.child).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId: 'remote-peer-123',
          remotePeer: true,
        })
      );
    });

    it('should log packet handling', async () => {
      const packet = createPacket(1, 1, TYPE_GET, ['def-123', 'prop']);
      
      netron.peer.getStubByDefinitionId = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      await remotePeer.handlePacket(packet);

      expect(logger.child().debug).toHaveBeenCalled();
      expect(logger.child().error).toHaveBeenCalled();
    });
  });
});
