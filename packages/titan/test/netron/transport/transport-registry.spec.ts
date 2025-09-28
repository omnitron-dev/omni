/**
 * Transport Registry Tests
 *
 * Tests the transport registry functionality for managing transport implementations
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { TransportRegistry } from '../../../src/netron/transport/transport-registry.js';
import { TcpTransport } from '../../../src/netron/transport/tcp-transport.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket-transport.js';
import { UnixTransport } from '../../../src/netron/transport/unix-transport.js';
import type { ITransport, TransportFactory } from '../../../src/netron/transport/types.js';

// Mock transport for testing
class MockTransport implements ITransport {
  readonly name = 'mock';
  readonly capabilities = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: false,
    multiplexing: false,
    server: false
  };

  async connect(address: string) {
    throw new Error('Mock transport connect');
  }

  isValidAddress(address: string): boolean {
    return address.startsWith('mock://');
  }

  parseAddress(address: string) {
    return {
      protocol: 'mock',
      host: 'localhost',
      port: 1234,
      params: {}
    };
  }
}

describe('TransportRegistry', () => {
  let registry: TransportRegistry;

  beforeEach(() => {
    registry = new TransportRegistry(false);
  });

  describe('Registration', () => {
    it('should register a transport factory', () => {
      const factory: TransportFactory = () => new TcpTransport();

      registry.register('tcp', factory);

      expect(registry.has('tcp')).toBe(true);
      expect(registry.list()).toContain('tcp');
    });

    it('should register multiple transports', () => {
      registry.register('tcp', () => new TcpTransport());
      registry.register('ws', () => new WebSocketTransport());
      registry.register('unix', () => new UnixTransport());

      expect(registry.list()).toHaveLength(3);
      expect(registry.list()).toEqual(['tcp', 'ws', 'unix']);
    });

    it('should override existing transport', () => {
      const factory1: TransportFactory = () => new TcpTransport();
      const factory2: TransportFactory = () => new MockTransport();

      registry.register('test', factory1);
      registry.register('test', factory2);

      const transport = registry.get('test');
      expect(transport?.name).toBe('mock');
    });

    it('should maintain registration order', () => {
      registry.register('third', () => new MockTransport());
      registry.register('first', () => new TcpTransport());
      registry.register('second', () => new WebSocketTransport());

      const list = registry.list();
      expect(list).toEqual(['third', 'first', 'second']);
    });
  });

  describe('Retrieval', () => {
    beforeEach(() => {
      registry.register('tcp', () => new TcpTransport());
      registry.register('ws', () => new WebSocketTransport());
      registry.register('unix', () => new UnixTransport());
    });

    it('should get transport by name', () => {
      const tcp = registry.get('tcp');
      expect(tcp).toBeInstanceOf(TcpTransport);
      expect(tcp?.name).toBe('tcp');

      const ws = registry.get('ws');
      expect(ws).toBeInstanceOf(WebSocketTransport);
      expect(ws?.name).toBe('websocket'); // WebSocketTransport has name 'websocket'
    });

    it('should return undefined for non-existent transport', () => {
      const transport = registry.get('nonexistent');
      expect(transport).toBeUndefined();
    });

    it('should create new instance on each get', () => {
      const transport1 = registry.get('tcp');
      const transport2 = registry.get('tcp');

      expect(transport1).not.toBe(transport2);
      expect(transport1).toBeInstanceOf(TcpTransport);
      expect(transport2).toBeInstanceOf(TcpTransport);
    });

    it('should handle factory errors gracefully', () => {
      registry.register('error', () => {
        throw new Error('Factory error');
      });

      const transport = registry.get('error');
      expect(transport).toBeUndefined();
    });
  });

  describe('Protocol Mapping', () => {
    beforeEach(() => {
      registry.register('tcp', () => new TcpTransport());
      registry.mapProtocol('tcp', 'tcp');

      registry.register('websocket', () => new WebSocketTransport());
      registry.mapProtocol('ws', 'websocket');
      registry.mapProtocol('wss', 'websocket');

      registry.register('unix', () => new UnixTransport());
      registry.mapProtocol('unix', 'unix');
    });

    it('should get transport by protocol', () => {
      const tcpTransport = registry.getByProtocol('tcp');
      expect(tcpTransport).toBeInstanceOf(TcpTransport);
      expect(tcpTransport?.name).toBe('tcp');
    });

    it('should handle WebSocket protocols', () => {
      const wsTransport = registry.getByProtocol('ws');
      expect(wsTransport).toBeInstanceOf(WebSocketTransport);

      const wssTransport = registry.getByProtocol('wss');
      expect(wssTransport).toBeInstanceOf(WebSocketTransport);
    });

    it('should handle Unix socket protocol', () => {
      const unixTransport = registry.getByProtocol('unix');
      expect(unixTransport).toBeInstanceOf(UnixTransport);
    });

    it('should return undefined for unknown protocol', () => {
      const transport = registry.getByProtocol('unknown');
      expect(transport).toBeUndefined();
    });

    it('should handle protocol aliases', () => {
      // WebSocket transport handles both ws and wss
      registry.register('websocket', () => new WebSocketTransport());
      registry.mapProtocol('ws', 'websocket');
      registry.mapProtocol('wss', 'websocket');

      const ws = registry.getByProtocol('ws');
      const wss = registry.getByProtocol('wss');

      expect(ws).toBeInstanceOf(WebSocketTransport);
      expect(wss).toBeInstanceOf(WebSocketTransport);
    });
  });

  describe('Unregistration', () => {
    beforeEach(() => {
      registry.register('tcp', () => new TcpTransport());
      registry.register('ws', () => new WebSocketTransport());
    });

    it('should unregister transport', () => {
      expect(registry.has('tcp')).toBe(true);

      const result = registry.unregister('tcp');

      expect(result).toBe(true);
      expect(registry.has('tcp')).toBe(false);
      expect(registry.list()).not.toContain('tcp');
    });

    it('should return false for non-existent transport', () => {
      const result = registry.unregister('nonexistent');
      expect(result).toBe(false);
    });

    it('should handle unregistering all transports', () => {
      registry.unregister('tcp');
      registry.unregister('ws');

      expect(registry.list()).toHaveLength(0);
    });
  });

  describe('Listing', () => {
    it('should list all registered transport names', () => {
      registry.register('transport1', () => new MockTransport());
      registry.register('transport2', () => new TcpTransport());
      registry.register('transport3', () => new WebSocketTransport());

      const list = registry.list();

      expect(list).toHaveLength(3);
      expect(list).toContain('transport1');
      expect(list).toContain('transport2');
      expect(list).toContain('transport3');
    });

    it('should return empty array when no transports registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('should return new array instance', () => {
      registry.register('test', () => new MockTransport());

      const list1 = registry.list();
      const list2 = registry.list();

      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  describe('Has Method', () => {
    it('should return true for registered transport', () => {
      registry.register('test', () => new MockTransport());
      expect(registry.has('test')).toBe(true);
    });

    it('should return false for non-registered transport', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should be case-sensitive', () => {
      registry.register('test', () => new MockTransport());

      expect(registry.has('test')).toBe(true);
      expect(registry.has('Test')).toBe(false);
      expect(registry.has('TEST')).toBe(false);
    });
  });

  describe('Default Transports', () => {
    it('should register default transports', () => {
      const registry = TransportRegistry.createWithDefaults();

      expect(registry.has('tcp')).toBe(true);
      expect(registry.has('websocket')).toBe(true);
      expect(registry.has('ws')).toBe(true);
      expect(registry.has('unix')).toBe(true);
    });

    it('should create functional default transports', () => {
      const registry = TransportRegistry.createWithDefaults();

      const tcp = registry.get('tcp');
      expect(tcp).toBeInstanceOf(TcpTransport);
      expect(tcp?.isValidAddress('tcp://localhost:8080')).toBe(true);

      const ws = registry.get('websocket');
      expect(ws).toBeInstanceOf(WebSocketTransport);
      expect(ws?.isValidAddress('ws://localhost:8080')).toBe(true);

      const unix = registry.get('unix');
      expect(unix).toBeInstanceOf(UnixTransport);
      expect(unix?.isValidAddress('unix:///tmp/test.sock')).toBe(true);
    });

    it('should handle WebSocket aliases correctly', () => {
      const registry = TransportRegistry.createWithDefaults();

      const ws = registry.get('ws');
      const websocket = registry.get('websocket');

      // Both should return WebSocket transport instances
      expect(ws).toBeInstanceOf(WebSocketTransport);
      expect(websocket).toBeInstanceOf(WebSocketTransport);

      // They should be different instances (factory creates new each time)
      expect(ws).not.toBe(websocket);
    });
  });

  describe('Thread Safety', () => {
    it('should handle concurrent registrations', () => {
      const promises = [];

      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => {
            registry.register(`transport${i}`, () => new MockTransport());
          })
        );
      }

      return Promise.all(promises).then(() => {
        expect(registry.list()).toHaveLength(100);
      });
    });

    it('should handle concurrent get operations', () => {
      registry.register('test', () => new MockTransport());

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => {
            const transport = registry.get('test');
            expect(transport).toBeInstanceOf(MockTransport);
          })
        );
      }

      return Promise.all(promises);
    });
  });

  describe('Error Handling', () => {
    it('should handle null factory', () => {
      expect(() => {
        registry.register('test', null as any);
      }).toThrow();
    });

    it('should handle undefined factory', () => {
      expect(() => {
        registry.register('test', undefined as any);
      }).toThrow();
    });

    it('should handle empty name', () => {
      expect(() => {
        registry.register('', () => new MockTransport());
      }).toThrow();
    });

    it('should handle factory that returns null', () => {
      registry.register('null', () => null as any);

      const transport = registry.get('null');
      expect(transport).toBeUndefined();
    });

    it('should handle factory that returns undefined', () => {
      registry.register('undefined', () => undefined as any);

      const transport = registry.get('undefined');
      expect(transport).toBeUndefined();
    });
  });

  describe('Registry Isolation', () => {
    it('should maintain separate registries', () => {
      const registry1 = new TransportRegistry(false);
      const registry2 = new TransportRegistry(false);

      registry1.register('test', () => new TcpTransport());

      expect(registry1.has('test')).toBe(true);
      expect(registry2.has('test')).toBe(false);
    });

    it('should not share state between instances', () => {
      const registry1 = new TransportRegistry(false);
      const registry2 = new TransportRegistry(false);

      registry1.register('transport1', () => new TcpTransport());
      registry2.register('transport2', () => new WebSocketTransport());

      expect(registry1.list()).toEqual(['transport1']);
      expect(registry2.list()).toEqual(['transport2']);
    });
  });

  describe('Protocol Resolution', () => {
    beforeEach(() => {
      registry = TransportRegistry.createWithDefaults();
    });

    it('should resolve TCP addresses', () => {
      const transport = registry.getByProtocol('tcp');
      expect(transport?.isValidAddress('tcp://localhost:8080')).toBe(true);
      expect(transport?.isValidAddress('ws://localhost:8080')).toBe(false);
    });

    it('should resolve WebSocket addresses', () => {
      const transport = registry.getByProtocol('ws');
      expect(transport?.isValidAddress('ws://localhost:8080')).toBe(true);
      expect(transport?.isValidAddress('wss://example.com')).toBe(true);
      expect(transport?.isValidAddress('tcp://localhost:8080')).toBe(false);
    });

    it('should resolve Unix socket addresses', () => {
      const transport = registry.getByProtocol('unix');
      expect(transport?.isValidAddress('unix:///tmp/test.sock')).toBe(true);
      expect(transport?.isValidAddress('tcp://localhost:8080')).toBe(false);
    });

    it('should handle case sensitivity in protocols', () => {
      const tcp = registry.getByProtocol('tcp');
      const TCP = registry.getByProtocol('TCP');

      expect(tcp).toBeInstanceOf(TcpTransport);
      expect(TCP).toBeInstanceOf(TcpTransport); // Protocols are case-insensitive
    });
  });
});