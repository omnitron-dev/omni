/**
 * Integration tests for HttpRemotePeer - no mocks, real HTTP server
 * Tests the entire HTTP peer functionality in a real environment
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { HttpRemotePeer } from '../../../../src/netron/transport/http/peer.js';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { Netron } from '../../../../src/netron/netron.js';
import { Service, Public } from '../../../../src/decorators/core.js';
import { createMockLogger } from '../../test-utils.js';
import type { ILogger } from '../../../../src/modules/logger/logger.types.js';

// Test service interface
interface ICalculator {
  add(a: number, b: number): Promise<number>;
  subtract(a: number, b: number): Promise<number>;
  getHistory(): Promise<string[]>;
}

@Service('calculator@1.0.0')
class CalculatorService implements ICalculator {
  private history: string[] = [];

  @Public()
  async add(a: number, b: number): Promise<number> {
    const result = a + b;
    this.history.push(`${a} + ${b} = ${result}`);
    return result;
  }

  @Public()
  async subtract(a: number, b: number): Promise<number> {
    const result = a - b;
    this.history.push(`${a} - ${b} = ${result}`);
    return result;
  }

  @Public()
  async getHistory(): Promise<string[]> {
    return [...this.history];
  }
}

describe('HttpRemotePeer Integration (No Mocks)', () => {
  let serverNetron: Netron;
  let clientNetron: Netron;
  let httpServer: HttpServer;
  let serverPort: number;
  let baseUrl: string;
  let httpPeer: HttpRemotePeer;
  let connection: HttpConnection;
  let logger: ILogger;

  beforeAll(async () => {
    logger = createMockLogger();

    // Use a fixed unlikely port for test stability
    serverPort = 18123;
    baseUrl = `http://127.0.0.1:${serverPort}`;

    // Create server-side Netron
    serverNetron = new Netron(logger);
    await serverNetron.start();

    // Create HTTP server - use 127.0.0.1 to avoid IPv6/IPv4 confusion
    httpServer = new HttpServer({
      port: serverPort,
      host: '127.0.0.1'
    });

    // Expose the service
    const calcService = new CalculatorService();
    await serverNetron.peer.exposeService(calcService);

    // Attach the server to the local peer (this registers the services)
    httpServer.setPeer(serverNetron.peer);

    // Start listening
    await httpServer.listen();

    // Wait a bit for server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    try {
      if (httpServer) {
        await httpServer.close();
      }
      if (serverNetron) {
        await serverNetron.stop();
      }
    } catch (error) {
      console.error('Cleanup error (ignored):', error);
    }

    // Add delay to ensure port is fully released
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  beforeEach(async () => {
    // Create client-side Netron and peer for each test
    clientNetron = new Netron(logger);
    await clientNetron.start();

    // Create HTTP connection and peer
    connection = new HttpConnection(baseUrl);
    httpPeer = new HttpRemotePeer(connection, clientNetron, baseUrl);
    await httpPeer.init(true);
  });

  afterEach(async () => {
    try {
      // Disconnect client resources
      if (httpPeer) {
        await httpPeer.close();
      }
      if (connection) {
        await connection.close();
      }
      if (clientNetron) {
        await clientNetron.stop();
      }
    } catch (error) {
      // Ignore cleanup errors (expected for tests that close resources)
    }
  });

  describe('Peer Initialization', () => {
    it('should initialize HTTP peer with correct properties', () => {
      expect(httpPeer).toBeDefined();
      expect(httpPeer.id).toMatch(/^http-direct-127\.0\.0\.1/);
      expect(httpPeer.netron).toBe(clientNetron);
    });

    it('should have baseUrl set correctly', () => {
      expect((httpPeer as any).baseUrl).toBe(baseUrl);
    });

    it('should initialize with empty service maps', () => {
      expect(httpPeer.services.size).toBe(0);
      expect((httpPeer as any).definitions.size).toBe(0);
    });
  });

  describe('QueryInterface Remote', () => {
    it('should query service interface from remote server', async () => {
      const definition = await httpPeer.queryInterfaceRemote('calculator@1.0.0');

      expect(definition).toBeDefined();
      expect(definition.meta.name).toBe('calculator@1.0.0');
      expect(definition.meta.methods).toBeDefined();
      expect(Object.keys(definition.meta.methods)).toContain('add');
      expect(Object.keys(definition.meta.methods)).toContain('subtract');
      expect(Object.keys(definition.meta.methods)).toContain('getHistory');
    });

    it('should cache queried definitions', async () => {
      const def1 = await httpPeer.queryInterfaceRemote('calculator@1.0.0');

      // Service should now be cached
      expect(httpPeer.services.has('calculator@1.0.0')).toBe(true);
      expect(httpPeer.services.get('calculator@1.0.0')).toBe(def1);
    });

    it('should throw error for non-existent service', async () => {
      await expect(async () => {
        await httpPeer.queryInterfaceRemote('nonexistent@1.0.0');
      }).rejects.toThrow();
    });
  });

  describe('Remote Method Invocation', () => {
    it('should call remote methods via HTTP', async () => {
      const calculator = await httpPeer.queryInterface<ICalculator>('calculator@1.0.0');

      const result = await calculator.add(5, 3);
      expect(result).toBe(8);
    });

    it('should handle multiple method calls', async () => {
      const calculator = await httpPeer.queryInterface<ICalculator>('calculator@1.0.0');

      const result1 = await calculator.add(10, 5);
      const result2 = await calculator.subtract(20, 7);
      const result3 = await calculator.add(3, 3);

      expect(result1).toBe(15);
      expect(result2).toBe(13);
      expect(result3).toBe(6);

      const history = await calculator.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0]).toBe('10 + 5 = 15');
      expect(history[1]).toBe('20 - 7 = 13');
      expect(history[2]).toBe('3 + 3 = 6');
    });

    it('should handle concurrent method calls', async () => {
      const calculator = await httpPeer.queryInterface<ICalculator>('calculator@1.0.0');

      const results = await Promise.all([
        calculator.add(1, 1),
        calculator.add(2, 2),
        calculator.add(3, 3),
        calculator.subtract(10, 5),
        calculator.subtract(20, 10)
      ]);

      expect(results).toEqual([2, 4, 6, 5, 10]);
    });
  });

  describe('Interface Management', () => {
    it('should query and release interface', async () => {
      const calculator = await httpPeer.queryInterface<ICalculator>('calculator@1.0.0');
      expect(calculator).toBeDefined();

      // Use the interface
      await calculator.add(1, 1);

      // Release interface
      await httpPeer.releaseInterface(calculator);

      // Should be able to query again
      const calculator2 = await httpPeer.queryInterface<ICalculator>('calculator@1.0.0');
      expect(calculator2).toBeDefined();
    });

    it('should handle multiple interface instances', async () => {
      const calc1 = await httpPeer.queryInterface<ICalculator>('calculator@1.0.0');
      const calc2 = await httpPeer.queryInterface<ICalculator>('calculator@1.0.0');

      // Both should work
      const result1 = await calc1.add(5, 5);
      const result2 = await calc2.add(10, 10);

      expect(result1).toBe(10);
      expect(result2).toBe(20);

      await httpPeer.releaseInterface(calc1);
      await httpPeer.releaseInterface(calc2);
    });
  });

  describe('Cache Management', () => {
    it('should invalidate definition cache by pattern', async () => {
      // Query to populate cache
      await httpPeer.queryInterfaceRemote('calculator@1.0.0');
      expect(httpPeer.services.has('calculator@1.0.0')).toBe(true);

      // Invalidate cache
      const count = httpPeer.invalidateDefinitionCache('calculator@1.0.0');
      expect(count).toBeGreaterThan(0);

      // Cache should be cleared
      expect(httpPeer.services.has('calculator@1.0.0')).toBe(false);
    });

    it('should invalidate all caches', async () => {
      await httpPeer.queryInterfaceRemote('calculator@1.0.0');

      const count = httpPeer.invalidateDefinitionCache();
      expect(count).toBeGreaterThan(0);

      expect(httpPeer.services.size).toBe(0);
    });
  });

  describe('Connection Management', () => {
    it('should close cleanly', async () => {
      await httpPeer.queryInterface('calculator@1.0.0');

      await httpPeer.close();

      // Should not be able to query after close
      // Note: HTTP peer might still work as it's stateless, but connection should be closed
      expect(connection.state).not.toBe('open');
    });
  });

  describe('Error Handling', () => {
    it('should handle server errors gracefully', async () => {
      // Stop the server to simulate network error
      await httpServer.close();

      await expect(async () => {
        await httpPeer.queryInterfaceRemote('calculator@1.0.0');
      }).rejects.toThrow();
    });

    it('should handle invalid service names', async () => {
      await expect(async () => {
        await httpPeer.queryInterfaceRemote('invalid-service-name');
      }).rejects.toThrow();
    });
  });

  describe('Request Options', () => {
    it('should use default timeout from options', async () => {
      const customPeer = new HttpRemotePeer(
        connection,
        clientNetron,
        baseUrl,
        { requestTimeout: 5000 }
      );
      await customPeer.init(true);

      expect((customPeer as any).defaultOptions.timeout).toBe(5000);

      await customPeer.close();
    });

    it('should use custom headers from options', async () => {
      const customPeer = new HttpRemotePeer(
        connection,
        clientNetron,
        baseUrl,
        { headers: { 'X-Custom-Header': 'test-value' } }
      );
      await customPeer.init(true);

      expect((customPeer as any).defaultOptions.headers).toHaveProperty('X-Custom-Header', 'test-value');

      await customPeer.close();
    });
  });
});
