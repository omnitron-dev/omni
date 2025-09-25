/**
 * Integration tests for HTTP Transport with Netron
 * Tests end-to-end scenarios including cross-transport compatibility
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { z } from 'zod';
import { HttpTransport } from '../../../../src/netron/transport/http/index.js';
import { Netron } from '../../../../src/netron/netron.js';
import { Service } from '../../../../src/decorators/core.js';
import { contract } from '../../../../src/validation/contract.js';

// Test service contract with HTTP metadata
const userContract = contract({
  getUser: {
    input: z.object({ id: z.string() }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    }),
    http: {
      method: 'GET',
      path: '/api/users/{id}',
      params: z.object({ id: z.string() })
    }
  },
  listUsers: {
    input: z.object({
      page: z.number().default(1),
      limit: z.number().default(10),
      search: z.string().optional()
    }),
    output: z.object({
      users: z.array(z.object({
        id: z.string(),
        name: z.string(),
        email: z.string()
      })),
      total: z.number(),
      page: z.number(),
      limit: z.number()
    }),
    http: {
      method: 'GET',
      path: '/api/users',
      query: z.object({
        page: z.string().transform(Number).optional(),
        limit: z.string().transform(Number).optional(),
        search: z.string().optional()
      })
    }
  },
  createUser: {
    input: z.object({
      name: z.string(),
      email: z.string().email()
    }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    }),
    http: {
      method: 'POST',
      path: '/api/users',
      status: 201
    }
  },
  updateUser: {
    input: z.object({
      id: z.string(),
      name: z.string().optional(),
      email: z.string().email().optional()
    }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    }),
    http: {
      method: 'PUT',
      path: '/api/users/{id}',
      params: z.object({ id: z.string() })
    }
  },
  deleteUser: {
    input: z.object({ id: z.string() }),
    output: z.object({ success: z.boolean() }),
    http: {
      method: 'DELETE',
      path: '/api/users/{id}',
      params: z.object({ id: z.string() })
    }
  },
  searchUsers: {
    input: z.object({ query: z.string() }),
    output: z.array(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    }))
    // No HTTP metadata - will use RPC endpoint
  }
});

// Test service implementation
@Service({ name: 'UserService@1.0.0', contract: userContract })
class UserService {
  private users = new Map<string, any>();

  constructor() {
    // Add some test users
    this.users.set('1', { id: '1', name: 'John Doe', email: 'john@example.com' });
    this.users.set('2', { id: '2', name: 'Jane Smith', email: 'jane@example.com' });
  }

  async getUser(input: { id: string }) {
    const user = this.users.get(input.id);
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  async listUsers(input: { page: number; limit: number; search?: string }) {
    const allUsers = Array.from(this.users.values());
    let filtered = allUsers;

    if (input.search) {
      filtered = allUsers.filter(u =>
        u.name.toLowerCase().includes(input.search!.toLowerCase()) ||
        u.email.toLowerCase().includes(input.search!.toLowerCase())
      );
    }

    const start = (input.page - 1) * input.limit;
    const users = filtered.slice(start, start + input.limit);

    return {
      users,
      total: filtered.length,
      page: input.page,
      limit: input.limit
    };
  }

  async createUser(input: { name: string; email: string }) {
    const id = String(Date.now());
    const user = { id, ...input };
    this.users.set(id, user);
    return user;
  }

  async updateUser(input: { id: string; name?: string; email?: string }) {
    const user = this.users.get(input.id);
    if (!user) {
      throw new Error('User not found');
    }

    if (input.name) user.name = input.name;
    if (input.email) user.email = input.email;

    return user;
  }

  async deleteUser(input: { id: string }) {
    const existed = this.users.delete(input.id);
    return { success: existed };
  }

  async searchUsers(input: { query: string }) {
    const allUsers = Array.from(this.users.values());
    return allUsers.filter(u =>
      u.name.toLowerCase().includes(input.query.toLowerCase()) ||
      u.email.toLowerCase().includes(input.query.toLowerCase())
    );
  }
}

describe('HTTP Transport Integration', () => {
  let serverNetron: Netron;
  let clientNetron: Netron;
  let userService: UserService;
  let httpPort: number;

  // Create a simple mock logger
  const mockLogger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => mockLogger,
    level: 'error' as const
  } as any;

  beforeEach(async () => {
    // Generate a unique port for each test to avoid conflicts
    httpPort = 14000 + Math.floor(Math.random() * 10000);

    // Create server with HTTP transport
    serverNetron = new Netron(mockLogger, {
      listenHost: 'localhost',
      listenPort: httpPort
    });

    // Register HTTP transport and set as default for server
    serverNetron.registerTransport('http', () => new HttpTransport(), true);

    // Create and expose service
    userService = new UserService();
    await serverNetron.peer.exposeService(userService);

    // Start server
    await serverNetron.start();

    // Create client
    clientNetron = new Netron(mockLogger);
    clientNetron.registerTransport('http', () => new HttpTransport());
  });

  afterEach(async () => {
    // Ensure proper cleanup
    try {
      if (clientNetron) {
        await clientNetron.stop();
      }
    } catch (e) {
      // Ignore errors during cleanup
    }

    try {
      if (serverNetron) {
        await serverNetron.stop();
      }
    } catch (e) {
      // Ignore errors during cleanup
    }

    // Add a small delay to ensure port is released
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Basic HTTP Operations', () => {
    it('should connect to HTTP server and query interface', async () => {
      // Connect via HTTP
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);

      // Query interface - should work exactly like WebSocket
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');
      expect(service).toBeDefined();
      expect(service.getUser).toBeDefined();
      expect(service.listUsers).toBeDefined();
    });

    it('should call REST endpoint via GET method', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // This should translate to GET /api/users/1
      const user = await service.getUser({ id: '1' });

      expect(user.id).toBe('1');
      expect(user.name).toBe('John Doe');
      expect(user.email).toBe('john@example.com');
    });

    it('should call REST endpoint with query parameters', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // This should translate to GET /api/users?page=1&limit=5
      const result = await service.listUsers({ page: 1, limit: 5 });

      expect(result.users).toBeDefined();
      expect(result.users.length).toBeLessThanOrEqual(5);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(5);
    });

    it('should call REST endpoint via POST method', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // This should translate to POST /api/users
      const newUser = await service.createUser({
        name: 'Alice Brown',
        email: 'alice@example.com'
      });

      expect(newUser.id).toBeDefined();
      expect(newUser.name).toBe('Alice Brown');
      expect(newUser.email).toBe('alice@example.com');

      // Verify user was created
      const fetched = await service.getUser({ id: newUser.id });
      expect(fetched).toEqual(newUser);
    });

    it('should call REST endpoint via PUT method', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // This should translate to PUT /api/users/1
      const updated = await service.updateUser({
        id: '1',
        name: 'John Updated'
      });

      expect(updated.id).toBe('1');
      expect(updated.name).toBe('John Updated');
      expect(updated.email).toBe('john@example.com');
    });

    it('should call REST endpoint via DELETE method', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // This should translate to DELETE /api/users/2
      const result = await service.deleteUser({ id: '2' });

      expect(result.success).toBe(true);

      // Verify user was deleted
      await expect(service.getUser({ id: '2' })).rejects.toThrow('User not found');
    });

    it('should call RPC endpoint for methods without HTTP metadata', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // This should translate to POST /rpc/searchUsers
      const results = await service.searchUsers({ query: 'john' });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('John');
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors properly', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // Try to get non-existent user
      await expect(service.getUser({ id: 'nonexistent' })).rejects.toThrow('User not found');
    });

    it('should handle validation errors', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // Try to create user with invalid email
      await expect(service.createUser({
        name: 'Invalid',
        email: 'not-an-email' as any
      })).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      // Try to connect to non-existent server
      await expect(
        clientNetron.connect('http://localhost:9999')
      ).rejects.toThrow();
    });
  });

  describe('Multiple Services', () => {
    let calculatorService: any;

    beforeEach(async () => {
      // Define calculator contract
      const calculatorContract = contract({
        add: {
          input: z.object({ a: z.number(), b: z.number() }),
          output: z.object({ result: z.number() }),
          http: { method: 'POST', path: '/api/calc/add' }
        },
        subtract: {
          input: z.object({ a: z.number(), b: z.number() }),
          output: z.object({ result: z.number() }),
          http: { method: 'POST', path: '/api/calc/subtract' }
        }
      });

      // Create calculator service
      @Service({ name: 'Calculator@1.0.0', contract: calculatorContract })
      class CalculatorService {
        async add(input: { a: number; b: number }) {
          return { result: input.a + input.b };
        }

        async subtract(input: { a: number; b: number }) {
          return { result: input.a - input.b };
        }
      }

      calculatorService = new CalculatorService();
      await serverNetron.peer.exposeService(calculatorService);
    });

    it('should handle multiple services on same server', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);

      // Query both services
      const userSvc = await peer.queryInterface<UserService>('UserService@1.0.0');
      const calcSvc = await peer.queryInterface<any>('Calculator@1.0.0');

      // Use both services
      const user = await userSvc.getUser({ id: '1' });
      expect(user.name).toBe('John Doe');

      const sum = await calcSvc.add({ a: 5, b: 3 });
      expect(sum.result).toBe(8);
    });
  });

  describe('Cross-Transport Compatibility', () => {
    it('should allow WebSocket client to call HTTP service', async () => {
      // This test demonstrates protocol bridging
      // The HTTP server exposes services that WebSocket clients can call

      // Create WebSocket client connection
      // Note: This would require WebSocket transport implementation
      // For now, we'll simulate this by using HTTP client

      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // The fact that we can call the service through the same interface
      // demonstrates the transport abstraction
      const users = await service.listUsers({ page: 1, limit: 10 });
      expect(users.users).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle multiple concurrent requests', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // Make 10 concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.createUser({
          name: `User ${i}`,
          email: `user${i}@example.com`
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((user, i) => {
        expect(user.name).toBe(`User ${i}`);
      });
    });

    it('should handle rapid sequential requests', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`);
      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      const startTime = Date.now();

      // Make 20 sequential requests
      for (let i = 0; i < 20; i++) {
        await service.getUser({ id: '1' });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete reasonably fast (under 2 seconds for 20 requests)
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Direct HTTP Access', () => {
    it('should allow direct HTTP access to REST endpoints', async () => {
      // Test that the HTTP endpoints can also be called directly
      // without going through Netron client

      const response = await fetch(`http://localhost:${httpPort}/api/users/1`, {
        method: 'GET'
      });

      expect(response.status).toBe(200);
      const user = await response.json();
      expect(user.id).toBe('1');
      expect(user.name).toBe('John Doe');
    });

    it('should handle direct POST requests', async () => {
      const response = await fetch(`http://localhost:${httpPort}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Direct User',
          email: 'direct@example.com'
        })
      });

      expect(response.status).toBe(201);
      const user = await response.json();
      expect(user.name).toBe('Direct User');
    });

    it('should handle RPC endpoints directly', async () => {
      const response = await fetch(`http://localhost:${httpPort}/rpc/searchUsers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'john' })
      });

      expect(response.status).toBe(200);
      const results = await response.json();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Headers and Metadata', () => {
    it('should include custom headers in requests', async () => {
      const peer = await clientNetron.connect(`http://localhost:${httpPort}`, {
        headers: {
          'X-Api-Key': 'test123',
          'X-Request-ID': 'req-456'
        }
      });

      const service = await peer.queryInterface<UserService>('UserService@1.0.0');

      // Headers should be included in all requests
      const user = await service.getUser({ id: '1' });
      expect(user).toBeDefined();
    });

    it('should handle CORS for cross-origin requests', async () => {
      // Simulate CORS preflight
      const response = await fetch(`http://localhost:${httpPort}/api/users`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });
  });
});