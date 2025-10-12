/**
 * Tests for Service decorator with transport configuration
 */
import { describe, it, expect, jest } from '@jest/globals';

import 'reflect-metadata';
import { Service, Public, Method } from '../../src/decorators/index.js';
import { SERVICE_ANNOTATION } from '../../src/decorators/core.js';
import type { ExtendedServiceMetadata } from '../../src/decorators/core.js';
import { WebSocketTransport, TcpTransport } from '../../src/netron/transport/index.js';
import { UnixSocketTransport, NamedPipeTransport } from '../../src/netron/transport/unix-transport.js';
import { LocalPeer } from '../../src/netron/local-peer.js';
import type { ITransport } from '../../src/netron/transport/types.js';

describe('Service Decorator with Transports', () => {
  describe('Basic Service Decorator', () => {
    it('should work with simple string syntax', () => {
      @Service('auth@1.0.0')
      class AuthService {
        @Public()
        async login(username: string, password: string): Promise<string> {
          return 'token';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, AuthService) as ExtendedServiceMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('auth');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.transports).toBeUndefined();
      expect(metadata.transportConfig).toBeUndefined();
    });

    it('should work with options object without transports', () => {
      @Service({ name: 'users@2.0.0' })
      class UserService {
        @Public()
        async getUser(id: string): Promise<{ id: string; name: string }> {
          return { id, name: 'Test User' };
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, UserService) as ExtendedServiceMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('users');
      expect(metadata.version).toBe('2.0.0');
      expect(metadata.transports).toBeUndefined();
    });
  });

  describe('Service with Transports', () => {
    it('should store transport configuration in metadata', () => {
      const wsTransport = new WebSocketTransport({ port: 8080 });
      const tcpTransport = new TcpTransport({ port: 3000 });

      @Service({
        name: 'chat@1.0.0',
        transports: [wsTransport, tcpTransport],
      })
      class ChatService {
        @Public()
        async sendMessage(message: string): Promise<void> {
          // Implementation
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, ChatService) as ExtendedServiceMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('chat');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.transports).toBeDefined();
      expect(metadata.transports).toHaveLength(2);
      expect(metadata.transports![0]).toBe(wsTransport);
      expect(metadata.transports![1]).toBe(tcpTransport);
    });

    it('should store transport config options', () => {
      const wsTransport = new WebSocketTransport({ port: 8080 });

      @Service({
        name: 'api@3.0.0',
        transports: [wsTransport],
        transportConfig: {
          timeout: 5000,
          compression: true,
          maxMessageSize: 1024 * 1024, // 1MB
        },
      })
      class ApiService {
        @Public()
        async getData(): Promise<any> {
          return { data: 'test' };
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, ApiService) as ExtendedServiceMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.transportConfig).toBeDefined();
      expect(metadata.transportConfig!.timeout).toBe(5000);
      expect(metadata.transportConfig!.compression).toBe(true);
      expect(metadata.transportConfig!.maxMessageSize).toBe(1024 * 1024);
    });

    it('should handle empty transports array', () => {
      @Service({
        name: 'empty@1.0.0',
        transports: [],
      })
      class EmptyTransportService {
        @Public()
        test(): string {
          return 'test';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, EmptyTransportService) as ExtendedServiceMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.transports).toBeDefined();
      expect(metadata.transports).toHaveLength(0);
    });
  });

  describe('Multiple Transport Types', () => {
    it('should support multiple transport types simultaneously', () => {
      const transports: ITransport[] = [
        new WebSocketTransport({ port: 8080 }),
        new TcpTransport({ port: 3000 }),
        new WebSocketTransport({ port: 8081 }), // Multiple of same type
      ];

      @Service({
        name: 'multi@1.0.0',
        transports,
      })
      class MultiTransportService {
        @Public()
        async process(data: any): Promise<any> {
          return data;
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, MultiTransportService) as ExtendedServiceMetadata;

      expect(metadata.transports).toHaveLength(3);
      expect(metadata.transports).toEqual(transports);
    });

    it('should support Unix socket transport on non-Windows platforms', () => {
      // Skip on Windows
      if (process.platform === 'win32') {
        return;
      }

      const unixTransport = new UnixSocketTransport({ path: '/tmp/test.sock' });

      @Service({
        name: 'unix@1.0.0',
        transports: [unixTransport],
      })
      class UnixService {
        @Public()
        getData(): string {
          return 'unix data';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, UnixService) as ExtendedServiceMetadata;

      expect(metadata.transports).toHaveLength(1);
      expect(metadata.transports![0]).toBe(unixTransport);
    });

    it('should support Named Pipe transport on Windows', () => {
      // Skip on non-Windows
      if (process.platform !== 'win32') {
        return;
      }

      const pipeTransport = new NamedPipeTransport({ pipeName: 'test-pipe' });

      @Service({
        name: 'pipe@1.0.0',
        transports: [pipeTransport],
      })
      class PipeService {
        @Public()
        getData(): string {
          return 'pipe data';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, PipeService) as ExtendedServiceMetadata;

      expect(metadata.transports).toHaveLength(1);
      expect(metadata.transports![0]).toBe(pipeTransport);
    });
  });

  describe('Integration with RemotePeer', () => {
    it('should expose service with configured transports', async () => {
      const wsTransport = new WebSocketTransport({ port: 0 }); // Random port

      // Create a mock Netron instance with logger
      const mockNetron: any = {
        id: 'test-netron',
        logger: {
          child: () => ({
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          }),
        },
        services: new Map(),
        options: {},
        emitSpecial: jest.fn(),
      };

      const localPeer = new LocalPeer(mockNetron);

      @Service({
        name: 'integration@1.0.0',
        transports: [wsTransport],
      })
      class IntegrationService {
        @Public()
        async echo(message: string): Promise<string> {
          return `Echo: ${message}`;
        }
      }

      const service = new IntegrationService();
      const definition = await localPeer.exposeService(service);

      expect(definition).toBeDefined();
      expect(definition.meta.name).toBe('integration');
      expect(definition.meta.version).toBe('1.0.0');

      // Check that transports are accessible via metadata
      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, service.constructor) as ExtendedServiceMetadata;
      expect(metadata.transports).toContain(wsTransport);
    });

    it('should use transport config when exposing service', async () => {
      // Create a mock Netron instance with logger
      const mockNetron: any = {
        id: 'config-netron',
        logger: {
          child: () => ({
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          }),
        },
        services: new Map(),
        options: {},
        emitSpecial: jest.fn(),
      };

      const localPeer = new LocalPeer(mockNetron);
      const wsTransport = new WebSocketTransport({ port: 0 });

      @Service({
        name: 'config@1.0.0',
        transports: [wsTransport],
        transportConfig: {
          timeout: 10000,
          compression: true,
        },
      })
      class ConfigService {
        @Public()
        async getData(): Promise<any> {
          return { test: 'data' };
        }
      }

      const service = new ConfigService();
      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, service.constructor) as ExtendedServiceMetadata;

      expect(metadata.transportConfig).toBeDefined();
      expect(metadata.transportConfig!.timeout).toBe(10000);
      expect(metadata.transportConfig!.compression).toBe(true);

      // When exposing the service, transports and config should be available
      const definition = await localPeer.exposeService(service);
      expect(definition).toBeDefined();
    });
  });

  describe('Validation', () => {
    it('should validate service name with transports', () => {
      const wsTransport = new WebSocketTransport({ port: 8080 });

      expect(() => {
        @Service({
          name: 'invalid-name@1.0.0', // Invalid: contains hyphen
          transports: [wsTransport],
        })
        class InvalidService {
          @Public()
          test(): void {}
        }
      }).toThrow('Invalid service name');
    });

    it('should validate version with transports', () => {
      const wsTransport = new WebSocketTransport({ port: 8080 });

      expect(() => {
        @Service({
          name: 'test@invalid.version',
          transports: [wsTransport],
        })
        class InvalidVersionService {
          @Public()
          test(): void {}
        }
      }).toThrow('Version must follow semver');
    });

    it('should allow service without version but with transports', () => {
      const wsTransport = new WebSocketTransport({ port: 8080 });

      @Service({
        name: 'noversion',
        transports: [wsTransport],
      })
      class NoVersionService {
        @Public()
        test(): string {
          return 'ok';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, NoVersionService) as ExtendedServiceMetadata;

      expect(metadata.name).toBe('noversion');
      expect(metadata.version).toBe('');
      expect(metadata.transports).toContain(wsTransport);
    });
  });

  describe('Complex Service Scenarios', () => {
    it('should handle service with methods, properties, and transports', () => {
      const transports = [new WebSocketTransport({ port: 8080 }), new TcpTransport({ port: 3000 })];

      @Service({
        name: 'complex@1.0.0',
        transports,
        transportConfig: {
          timeout: 15000,
          maxMessageSize: 2 * 1024 * 1024, // 2MB
        },
      })
      class ComplexService {
        @Public()
        public status: string = 'ready';

        @Public()
        public readonly version: string = '1.0.0';

        @Public()
        async initialize(): Promise<void> {
          // Initialization logic
        }

        @Public()
        async process(input: any): Promise<any> {
          return { processed: input };
        }

        @Method()
        calculate(a: number, b: number): number {
          return a + b;
        }

        // Private method (not exposed)
        private internalMethod(): void {
          // Internal logic
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, ComplexService) as ExtendedServiceMetadata;

      // Check service metadata
      expect(metadata.name).toBe('complex');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.transports).toEqual(transports);
      expect(metadata.transportConfig).toBeDefined();
      expect(metadata.transportConfig!.timeout).toBe(15000);
      expect(metadata.transportConfig!.maxMessageSize).toBe(2 * 1024 * 1024);

      // Check that methods are properly registered
      expect(metadata.methods).toHaveProperty('initialize');
      expect(metadata.methods).toHaveProperty('process');
      expect(metadata.methods).toHaveProperty('calculate');
      expect(metadata.methods).not.toHaveProperty('internalMethod');

      // Check that properties are properly registered
      expect(metadata.properties).toHaveProperty('status');
      expect(metadata.properties).toHaveProperty('version');
    });

    it('should support dynamic transport creation', () => {
      const createTransports = (basePort: number): ITransport[] => [
        new WebSocketTransport({ port: basePort }),
        new TcpTransport({ port: basePort + 1 }),
      ];

      @Service({
        name: 'dynamic@1.0.0',
        transports: createTransports(9000),
      })
      class DynamicTransportService {
        @Public()
        getInfo(): string {
          return 'Dynamic transport service';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, DynamicTransportService) as ExtendedServiceMetadata;

      expect(metadata.transports).toHaveLength(2);
      expect(metadata.transports![0]).toBeInstanceOf(WebSocketTransport);
      expect(metadata.transports![1]).toBeInstanceOf(TcpTransport);
    });
  });

  describe('Service Discovery with Transports', () => {
    it('should allow transport-based service discovery', () => {
      const wsTransport = new WebSocketTransport({ port: 8080 });
      const tcpTransport = new TcpTransport({ port: 3000 });

      @Service({
        name: 'discoverable@1.0.0',
        transports: [wsTransport, tcpTransport],
      })
      class DiscoverableService {
        @Public()
        ping(): string {
          return 'pong';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, DiscoverableService) as ExtendedServiceMetadata;

      // Services should be discoverable via their transports
      const wsEndpoint = metadata.transports![0];
      const tcpEndpoint = metadata.transports![1];

      expect(wsEndpoint).toBeInstanceOf(WebSocketTransport);
      expect(tcpEndpoint).toBeInstanceOf(TcpTransport);

      // Each transport should be identifiable and of correct type
      // Transport instances should maintain their identity
      expect(wsEndpoint).toBe(wsTransport);
      expect(tcpEndpoint).toBe(tcpTransport);
    });
  });
});
