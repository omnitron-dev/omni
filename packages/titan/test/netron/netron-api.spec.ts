/**
 * Tests for Netron public API methods
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Netron } from '../../src/netron/netron.js';
import { createMockLogger } from './test-utils.js';
import type { TransportFactory } from '../../src/netron/transport/types.js';

describe('Netron API', () => {
  let netron: Netron;

  beforeEach(async () => {
    netron = await Netron.create(createMockLogger(), {
      id: 'test-netron-api'
    });
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  describe('registerTransport', () => {
    it('should register a transport factory', () => {
      const mockFactory: TransportFactory = () => ({
        name: 'custom-transport',
        capabilities: { server: true, streaming: false, bidirectional: false, binary: false, reconnection: false, multiplexing: false },
        connect: jest.fn(),
        createServer: jest.fn()
      } as any);

      netron.registerTransport('custom-transport', mockFactory);

      const transport = (netron as any).transportRegistry.get('custom-transport');
      expect(transport).toBeDefined();
      expect(transport.name).toBe('custom-transport');
    });

    it('should allow registering multiple transports', () => {
      const wsFactory: TransportFactory = () => ({
        name: 'ws',
        capabilities: { server: true, streaming: true, bidirectional: true, binary: true, reconnection: true, multiplexing: false },
        connect: jest.fn(),
        createServer: jest.fn()
      } as any);

      const httpFactory: TransportFactory = () => ({
        name: 'http',
        capabilities: { server: true, streaming: true, bidirectional: false, binary: false, reconnection: false, multiplexing: true },
        connect: jest.fn(),
        createServer: jest.fn()
      } as any);

      netron.registerTransport('ws', wsFactory);
      netron.registerTransport('http', httpFactory);

      const wsTransport = (netron as any).transportRegistry.get('ws');
      const httpTransport = (netron as any).transportRegistry.get('http');

      expect(wsTransport).toBeDefined();
      expect(httpTransport).toBeDefined();
      expect(wsTransport.name).toBe('ws');
      expect(httpTransport.name).toBe('http');
    });
  });

  describe('registerTransportServer', () => {
    it('should register a transport server configuration', () => {
      const mockFactory: TransportFactory = () => ({
        name: 'custom-transport',
        capabilities: { server: true, streaming: false, bidirectional: false, binary: false, reconnection: false, multiplexing: false },
        connect: jest.fn(),
        createServer: jest.fn()
      } as any);

      netron.registerTransport('custom-transport', mockFactory);
      netron.registerTransportServer('custom-transport', {
        name: 'custom-transport',
        options: { host: 'localhost', port: 8080 }
      });

      const configs = (netron as any).transportServerConfigs;
      expect(configs).toBeDefined();
      expect(configs.get('custom-transport')).toBeDefined();
      expect(configs.get('custom-transport').options.port).toBe(8080);
    });

    it('should throw error when transport is not registered', () => {
      expect(() => {
        netron.registerTransportServer('non-existent-transport', {
          name: 'non-existent-transport',
          options: { host: 'localhost', port: 8080 }
        });
      }).toThrow('Transport non-existent-transport not registered');
    });

    it('should allow configuring multiple transport servers', () => {
      const wsFactory: TransportFactory = () => ({
        name: 'ws',
        capabilities: { server: true, streaming: true, bidirectional: true, binary: true, reconnection: true, multiplexing: false },
        connect: jest.fn(),
        createServer: jest.fn()
      } as any);

      const httpFactory: TransportFactory = () => ({
        name: 'http',
        capabilities: { server: true, streaming: true, bidirectional: false, binary: false, reconnection: false, multiplexing: true },
        connect: jest.fn(),
        createServer: jest.fn()
      } as any);

      netron.registerTransport('ws', wsFactory);
      netron.registerTransport('http', httpFactory);

      netron.registerTransportServer('ws', {
        name: 'ws',
        options: { host: 'localhost', port: 8080 }
      });

      netron.registerTransportServer('http', {
        name: 'http',
        options: { host: 'localhost', port: 8081 }
      });

      const configs = (netron as any).transportServerConfigs;
      expect(configs.size).toBe(2);
      expect(configs.get('ws').options.port).toBe(8080);
      expect(configs.get('http').options.port).toBe(8081);
    });
  });

  describe('getLocalPeer', () => {
    it('should return the local peer instance', () => {
      const localPeer = netron.getLocalPeer();

      expect(localPeer).toBeDefined();
      expect(localPeer).toBe(netron.peer);
    });

    it('should return same instance on multiple calls', () => {
      const peer1 = netron.getLocalPeer();
      const peer2 = netron.getLocalPeer();

      expect(peer1).toBe(peer2);
    });
  });

  describe('findPeer', () => {
    it('should return local peer when searching by local peer ID', () => {
      const peer = netron.findPeer(netron.peer.id);

      expect(peer).toBeDefined();
      expect(peer).toBe(netron.peer);
    });

    it('should return remote peer when peer exists', () => {
      // Manually add a remote peer to peers map
      const mockRemotePeer = {
        id: 'remote-peer-123',
        netron,
        close: jest.fn().mockResolvedValue(undefined)
      } as any;

      netron.peers.set('remote-peer-123', mockRemotePeer);

      const foundPeer = netron.findPeer('remote-peer-123');

      expect(foundPeer).toBeDefined();
      expect(foundPeer).toBe(mockRemotePeer);
    });

    it('should return undefined when peer does not exist', () => {
      const peer = netron.findPeer('non-existent-peer');

      expect(peer).toBeUndefined();
    });
  });

  describe('trackTask', () => {
    it('should return task as-is when taskManager is not available', async () => {
      const taskName = 'test-task';

      // Remove taskManager to test fallback behavior
      (netron as any).taskManager = undefined;

      const result = await netron.trackTask(taskName);

      expect(result).toBe(taskName);
    });

    it('should use taskManager.runTask when available', async () => {
      const taskName = 'test-task';
      const mockResult = { result: 'success' };

      const mockTaskManager = {
        runTask: jest.fn().mockResolvedValue(mockResult)
      };

      (netron as any).taskManager = mockTaskManager;

      const result = await netron.trackTask(taskName);

      expect(mockTaskManager.runTask).toHaveBeenCalledWith(taskName);
      expect(result).toBe(mockResult);
    });

    it('should handle taskManager without runTask method', async () => {
      const taskName = 'test-task';
      (netron as any).taskManager = {};

      const result = await netron.trackTask(taskName);

      expect(result).toBe(taskName);
    });
  });

  describe('getPeerEventName', () => {
    it('should combine peer ID and event name', () => {
      const eventName = netron.getPeerEventName('peer-123', 'connected');

      expect(eventName).toContain('peer-123');
      expect(eventName).toContain('connected');
    });

    it('should handle different peer IDs and events', () => {
      const event1 = netron.getPeerEventName('peer-1', 'disconnect');
      const event2 = netron.getPeerEventName('peer-2', 'disconnect');

      expect(event1).not.toBe(event2);
      expect(event1).toContain('peer-1');
      expect(event2).toContain('peer-2');
    });

    it('should handle special characters in event names', () => {
      const eventName = netron.getPeerEventName('peer-123', 'service:updated');

      expect(eventName).toContain('peer-123');
      expect(eventName).toContain('service:updated');
    });
  });
});
