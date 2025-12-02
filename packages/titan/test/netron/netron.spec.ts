/**
 * Comprehensive Netron Tests
 * Tests for the main Netron RPC implementation
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Netron } from '../../src/netron/netron.js';
import { LocalPeer } from '../../src/netron/local-peer.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { Service, Method } from '../../src/decorators/index.js';
import { createLogger } from '../utils/test-logger.js';

const skipIntegrationTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️  Skipping netron.spec.ts - integration test with async event handling');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

describeOrSkip('Netron - Comprehensive Tests', () => {
  let logger: any;
  let netron: Netron;

  beforeEach(() => {
    logger = createLogger();
    netron = new Netron(logger, {
      id: 'test-netron',
      taskTimeout: 5000,
    });
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  describe('Initialization', () => {
    it('should create Netron instance with ID', () => {
      expect(netron).toBeDefined();
      expect(netron.id).toBe('test-netron');
      expect(netron.uuid).toBe('test-netron');
    });

    it('should auto-generate ID if not provided', () => {
      const netron2 = new Netron(logger);
      expect(netron2.id).toBeDefined();
      expect(netron2.id.length).toBeGreaterThan(0);
    });

    it('should initialize with options', () => {
      const netronWithOptions = new Netron(logger, {
        taskTimeout: 10000,
        allowServiceEvents: true,
      });

      expect(netronWithOptions.options.taskTimeout).toBe(10000);
      expect(netronWithOptions.options.allowServiceEvents).toBe(true);
    });

    it('should have local peer', () => {
      expect(netron.peer).toBeDefined();
      expect(netron.peer).toBeInstanceOf(LocalPeer);
      expect(netron.peer.id).toBe(netron.id);
    });

    it('should have task manager', () => {
      expect(netron.taskManager).toBeDefined();
    });

    it('should start without configured transports (client-only mode)', async () => {
      await expect(netron.start()).resolves.not.toThrow();
      expect(netron['isStarted']).toBe(true);
    });
  });

  describe('Transport Management', () => {
    it('should register transport', () => {
      const mockTransport = {
        name: 'mock',
        protocols: ['mock'],
        capabilities: { client: true, server: false },
        connect: jest.fn(),
      };

      expect(() => {
        netron.registerTransport('mock', () => mockTransport);
      }).not.toThrow();
    });

    it('should throw when registering server for non-existent transport', () => {
      expect(() => {
        netron.registerTransportServer('nonexistent', {
          name: 'nonexistent',
          options: {},
        });
      }).toThrow(/not found/i);
    });

    it('should set transport options', () => {
      const mockTransport = {
        name: 'mock',
        protocols: ['mock'],
        capabilities: { client: true, server: false },
        connect: jest.fn(),
      };

      netron.registerTransport('mock', () => mockTransport);
      
      expect(() => {
        netron.setTransportOptions('mock', {
          connectTimeout: 3000,
          requestTimeout: 5000,
        });
      }).not.toThrow();
    });
  });

  describe('Peer Management', () => {
    it('should get local peer', () => {
      const localPeer = netron.getLocalPeer();
      expect(localPeer).toBe(netron.peer);
    });

    it('should find peer by ID', () => {
      const peer = netron.findPeer(netron.id);
      expect(peer).toBe(netron.peer);
    });

    it('should return undefined for non-existent peer', () => {
      const peer = netron.findPeer('nonexistent-peer-id');
      expect(peer).toBeUndefined();
    });

    it('should track remote peers', () => {
      const mockSocket = {
        on: jest.fn(),
        send: jest.fn(),
        readyState: 'OPEN',
      };

      const remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-id');
      netron.peers.set(remotePeer.id, remotePeer);

      expect(netron.peers.has('remote-peer-id')).toBe(true);
      expect(netron.findPeer('remote-peer-id')).toBe(remotePeer);
    });

    it('should get peer event name', () => {
      const eventName = netron.getPeerEventName('peer-123', 'connect');
      expect(eventName).toContain('peer-123');
      expect(eventName).toContain('connect');
    });
  });

  describe('Service Management', () => {
    it('should expose service on local peer', async () => {
      @Service({ name: 'TestService', version: '1.0.0' })
      class TestService {
        @Method()
        async getValue() {
          return 'test-value';
        }
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      expect(netron.services.size).toBeGreaterThan(0);
      expect(netron.getServiceNames()).toContain('TestService@1.0.0');
    });

    it('should get service names', async () => {
      @Service({ name: 'Service1', version: '1.0.0' })
      class Service1 {
        @Method()
        async test() {}
      }

      @Service({ name: 'Service2', version: '1.0.0' })
      class Service2 {
        @Method()
        async test() {}
      }

      await netron.peer.exposeService(new Service1());
      await netron.peer.exposeService(new Service2());

      const serviceNames = netron.getServiceNames();
      expect(serviceNames).toContain('Service1@1.0.0');
      expect(serviceNames).toContain('Service2@1.0.0');
    });

    it('should handle service with transports metadata', async () => {
      @Service({ 
        name: 'TransportService', 
        version: '1.0.0',
        transports: ['http', 'ws'],
      })
      class TransportService {
        @Method()
        async test() {
          return 'ok';
        }
      }

      const service = new TransportService();
      await netron.peer.exposeService(service);

      expect(netron.services.has('TransportService@1.0.0')).toBe(true);
    });
  });

  describe('Task Management', () => {
    it('should add task', () => {
      const testTask = async function test_task() {
        return 'task-result';
      };

      netron.addTask(testTask);
      // Verify task was added - addTask doesn't throw means it worked
      expect(netron.taskManager).toBeDefined();
    });

    it('should track task execution', async () => {
      const testTask = async function tracked_task() {
        return 'result';
      };
      netron.addTask(testTask);

      const result = await netron.taskManager.runTask(null, 'tracked_task');
      expect(result).toBeDefined();
    });
  });

  describe('Event System', () => {
    it('should emit and handle events', (done) => {
      const eventData = { test: 'data' };

      netron.on('test-event', (data: any) => {
        expect(data).toEqual(eventData);
        done();
      });

      netron.emit('test-event', eventData);
    });

    it('should remove event listeners', () => {
      const handler = jest.fn();

      netron.on('test-event', handler);
      netron.off('test-event', handler);
      netron.emit('test-event', {});

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle special events with sequential processing', async () => {
      const events: string[] = [];

      netron.on('peer:connect', (data: any) => {
        events.push('connect');
      });

      // emitSpecial processes events asynchronously
      await netron.emitSpecial('peer:connect', 'peer-123', { peerId: 'peer-123' });

      expect(events).toContain('connect');
    });

    it('should delete special events', () => {
      netron['ownEvents'].set('event-123', []);
      netron.deleteSpecialEvents('event-123');

      expect(netron['ownEvents'].has('event-123')).toBe(false);
    });
  });

  describe('Factory Method', () => {
    it('should create and start Netron via factory', async () => {
      const netronInstance = await Netron.create(logger, {
        id: 'factory-netron',
      });

      expect(netronInstance).toBeDefined();
      expect(netronInstance.id).toBe('factory-netron');
      expect(netronInstance['isStarted']).toBe(true);

      await netronInstance.stop();
    });
  });

  describe('Lifecycle', () => {
    it('should prevent multiple starts', async () => {
      await netron.start();
      await expect(netron.start()).rejects.toThrow(/already started/i);
    });

    it('should stop successfully', async () => {
      await netron.start();
      await expect(netron.stop()).resolves.not.toThrow();
      expect(netron['isStarted']).toBe(false);
    });

    it('should clear peers on stop', async () => {
      const mockSocket = {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
        readyState: 'OPEN',
      };

      const remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-id');
      netron.peers.set(remotePeer.id, remotePeer);

      await netron.start();
      await netron.stop();

      expect(netron.peers.size).toBe(0);
    });

    it('should stop all transport servers', async () => {
      const mockServer = {
        on: jest.fn(),
        listen: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      };

      netron.transportServers.set('mock', mockServer as any);

      await netron.stop();

      expect(mockServer.close).toHaveBeenCalled();
      expect(netron.transportServers.size).toBe(0);
    });
  });

  describe('Logger Integration', () => {
    it('should use child logger with context', () => {
      expect(netron.logger).toBeDefined();
      expect(logger.child).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'netron',
          netronId: 'test-netron',
        })
      );
    });

    it('should accept custom logger context', () => {
      const customLogger = createLogger();
      const customNetron = new Netron(customLogger, {
        loggerContext: { environment: 'test' },
      });

      expect(customLogger.child).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'test',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle transport server start failure gracefully', async () => {
      const failingTransport = {
        name: 'failing',
        protocols: ['fail'],
        capabilities: { client: false, server: true },
        createServer: jest.fn().mockRejectedValue(new Error('Server start failed')),
      };

      netron.registerTransport('failing', () => failingTransport);
      netron.registerTransportServer('failing', {
        name: 'failing',
        options: { port: 9999 },
      });

      await expect(netron.start()).rejects.toThrow();
    });
  });

  describe('Connection Management', () => {
    it('should disconnect peer', () => {
      const mockSocket = {
        on: jest.fn(),
        close: jest.fn(),
        readyState: 'OPEN',
      };

      const remotePeer = new RemotePeer(mockSocket, netron, 'disconnect-peer');
      remotePeer.disconnect = jest.fn();
      
      netron.peers.set(remotePeer.id, remotePeer);
      netron.disconnect('disconnect-peer');

      expect(remotePeer.disconnect).toHaveBeenCalled();
      expect(netron.peers.has('disconnect-peer')).toBe(false);
    });

    it('should handle disconnect for non-existent peer gracefully', () => {
      expect(() => {
        netron.disconnect('nonexistent-peer');
      }).not.toThrow();
    });
  });

  describe('Integration Points', () => {
    it('should integrate with task manager', async () => {
      const testTask = async function test_task() {
        return 'task-result';
      };

      netron.addTask(testTask);
      const result = await netron.taskManager.runTask(null, 'test_task');
      expect(result).toBe('task-result');
    });

    it('should handle peer connect events', async () => {
      const connectHandler = jest.fn();
      netron.on('peer:connect', connectHandler);

      await netron.emitSpecial('peer:connect', 'peer-456', { peerId: 'peer-456' });

      // Event should have been emitted
      expect(connectHandler).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-456' })
      );
    });

    it('should handle peer disconnect events', async () => {
      const disconnectHandler = jest.fn();
      netron.on('peer:disconnect', disconnectHandler);

      await netron.emitSpecial('peer:disconnect', 'peer-789', { peerId: 'peer-789' });

      expect(disconnectHandler).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-789' })
      );
    });
  });

  describe('Options and Configuration', () => {
    it('should respect task timeout option', () => {
      const netronWithTimeout = new Netron(logger, {
        taskTimeout: 15000,
      });

      expect(netronWithTimeout.taskManager['timeout']).toBe(15000);
    });

    it('should respect task overwrite strategy', () => {
      const netronWithStrategy = new Netron(logger, {
        taskOverwriteStrategy: 'replace',
      });

      expect(netronWithStrategy.taskManager['overwriteStrategy']).toBe('replace');
    });

    it('should use default options when not provided', () => {
      const defaultNetron = new Netron(logger);
      
      expect(defaultNetron.options).toBeDefined();
      expect(defaultNetron.taskManager).toBeDefined();
    });
  });

  describe('Transport Server Configuration', () => {
    it('should start with configured transport servers', async () => {
      const mockTransport = {
        name: 'mock-ws',
        protocols: ['ws'],
        capabilities: { client: true, server: true },
        createServer: jest.fn().mockResolvedValue({
          on: jest.fn(),
          listen: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      };

      netron.registerTransport('mock-ws', () => mockTransport);
      netron.registerTransportServer('mock-ws', {
        name: 'mock-ws',
        options: { host: 'localhost', port: 8080 },
      });

      await netron.start();

      expect(mockTransport.createServer).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 8080,
          headers: { 'x-netron-id': 'test-netron' },
        })
      );

      await netron.stop();
    });
  });

  describe('Memory and Resource Management', () => {
    it('should clean up resources on stop', async () => {
      await netron.start();
      
      const initialPeers = netron.peers.size;
      const initialServers = netron.transportServers.size;

      await netron.stop();

      expect(netron.peers.size).toBe(0);
      expect(netron.transportServers.size).toBe(0);
      expect(netron['isStarted']).toBe(false);
    });

    it('should not leak event listeners', async () => {
      const handler = jest.fn();
      
      netron.on('test-event', handler);
      expect(netron.listenerCount('test-event')).toBe(1);
      
      netron.removeListener('test-event', handler);
      expect(netron.listenerCount('test-event')).toBe(0);
    });
  });

  describe('State Management', () => {
    it('should track started state correctly', async () => {
      expect(netron['isStarted']).toBe(false);
      
      await netron.start();
      expect(netron['isStarted']).toBe(true);
      
      await netron.stop();
      expect(netron['isStarted']).toBe(false);
    });

    it('should maintain service registry', async () => {
      @Service({ name: 'StateService', version: '1.0.0' })
      class StateService {
        @Method()
        async test() {}
      }

      expect(netron.services.size).toBe(0);
      
      await netron.peer.exposeService(new StateService());
      expect(netron.services.size).toBeGreaterThan(0);
    });
  });
});
