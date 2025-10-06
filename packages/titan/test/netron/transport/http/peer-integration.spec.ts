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
import { getAvailablePort } from '../../../../src/netron/transport/utils.js';
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
  });

  beforeEach(async () => {
    // Get a new port for each test to avoid conflicts
    serverPort = await getAvailablePort(18000, 19000);
    baseUrl = `http://localhost:${serverPort}`;

    // Create server-side Netron and expose service
    serverNetron = new Netron(logger);
    await serverNetron.start();

    const calcService = new CalculatorService();
    serverNetron.peer.exposeService(calcService);

    // Create and start HTTP server
    httpServer = new HttpServer(serverNetron.peer, serverNetron.logger, {
      port: serverPort,
      host: 'localhost'
    });
    await httpServer.listen();

    // Create client-side Netron
    clientNetron = new Netron(logger);
    await clientNetron.start();

    // Create HTTP connection and peer
    connection = new HttpConnection(baseUrl);
    httpPeer = new HttpRemotePeer(connection, clientNetron, baseUrl);
    await httpPeer.init(true);
  });

  afterEach(async () => {
    try {
      if (httpPeer) {
        await httpPeer.disconnect();
      }
      if (connection) {
        await connection.close();
      }
      if (httpServer) {
        await httpServer.close();
      }
      if (clientNetron) {
        await clientNetron.stop();
      }
      if (serverNetron) {
        await serverNetron.stop();
      }
      // Add small delay to ensure port is released
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Peer Initialization', () => {
    it('should initialize HTTP peer with correct properties', () => {
      expect(httpPeer).toBeDefined();
      expect(httpPeer.id).toMatch(/^http-direct-localhost/);
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
      expect(definition.serviceName).toBe('calculator@1.0.0');
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
    it('should disconnect cleanly', async () => {
      await httpPeer.queryInterface('calculator@1.0.0');

      await httpPeer.disconnect();

      // Should not be able to query after disconnect
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

      await customPeer.disconnect();
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

      await customPeer.disconnect();
    });
  });
});
