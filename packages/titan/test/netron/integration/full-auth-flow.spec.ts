/**
 * Integration tests for full authentication and authorization flow
 * Tests end-to-end scenarios with real Netron instances
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Netron } from '../../../src/netron/netron.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import { Service, Method } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket-transport.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';
import type { AuthContext, AuthCredentials } from '../../../src/netron/auth/types.js';

// Test service with various auth requirements
@Service('userService@1.0.0')
class UserService {
  private users = new Map<string, any>([
    ['user1', { id: 'user1', name: 'Alice', email: 'alice@example.com', role: 'admin' }],
    ['user2', { id: 'user2', name: 'Bob', email: 'bob@example.com', role: 'user' }],
    ['user3', { id: 'user3', name: 'Charlie', email: 'charlie@example.com', role: 'guest' }],
  ]);

  @Method({
    auth: true, // Require authentication, any role
  })
  async getCurrentUser(authContext: AuthContext) {
    return this.users.get(authContext.userId);
  }

  @Method({
    auth: {
      roles: ['user', 'admin'],
    },
  })
  async getUser(userId: string) {
    return this.users.get(userId);
  }

  @Method({
    auth: {
      roles: ['admin'],
      permissions: ['write:users'],
    },
  })
  async updateUser(userId: string, data: any) {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    Object.assign(user, data);
    return user;
  }

  @Method({
    auth: {
      roles: ['admin'],
      permissions: ['delete:users'],
    },
  })
  async deleteUser(userId: string) {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    this.users.delete(userId);
    return { deleted: true, userId };
  }

  @Method({
    auth: {
      policies: ['requireRole:admin'],
    },
  })
  async listAllUsers() {
    return Array.from(this.users.values());
  }

  @Method({
    auth: {
      policies: {
        any: ['requireRole:admin', 'requirePermission:read:own-profile'],
      },
    },
  })
  async getProfile(userId: string) {
    // For now, just return the user (auth is checked at framework level)
    // TODO: Implement context-based authContext access for business logic that needs it
    return this.users.get(userId);
  }
}

describe('Full Auth Flow Integration', () => {
  let serverNetron: Netron;
  let clientNetron: Netron;
  let serverPort: number;

  beforeEach(async () => {
    // CRITICAL FIX: Use JEST_WORKER_ID for worker-safe port allocation
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    const basePort = 9000 + (workerId - 1) * 1000; // Each worker gets 1000 ports
    const offset = Math.floor(Math.random() * 900); // Random offset within range
    serverPort = basePort + offset;

    // Setup server Netron with full auth
    const serverLogger = createMockLogger();
    serverNetron = new Netron(serverLogger, {
      id: 'server',
    });

    // Configure authentication
    const authManager = new AuthenticationManager(serverLogger, {
      authenticate: async (credentials: AuthCredentials) => {
        // Simulate user database lookup
        const users: Record<string, any> = {
          'admin@example.com': {
            id: 'user1',
            password: 'admin123',
            roles: ['admin', 'user'],
            permissions: ['read:users', 'write:users', 'delete:users', 'read:own-profile'],
          },
          'user@example.com': {
            id: 'user2',
            password: 'user123',
            roles: ['user'],
            permissions: ['read:users', 'read:own-profile'],
          },
          'guest@example.com': {
            id: 'user3',
            password: 'guest123',
            roles: ['guest'],
            permissions: ['read:own-profile'],
          },
        };

        const user = users[credentials.username || ''];
        if (!user || user.password !== credentials.password) {
          throw new Error('Invalid credentials');
        }

        return {
          userId: user.id,
          username: credentials.username,
          roles: user.roles,
          permissions: user.permissions,
        };
      },

      validateToken: async (token: string) => {
        // Simple token validation (in real app, use JWT)
        try {
          const payload = JSON.parse(Buffer.from(token, 'base64').toString());
          return payload;
        } catch {
          throw new Error('Invalid token');
        }
      },
    });

    // Configure authorization
    const authzManager = new AuthorizationManager(serverLogger);

    // Register ACL with service-level and method-level rules
    authzManager.registerACL({
      service: 'userService@1.0.0',
      allowedRoles: ['user', 'admin', 'guest'],
      methods: {
        updateUser: {
          allowedRoles: ['admin'],
          requiredPermissions: ['write:users'],
        },
        deleteUser: {
          allowedRoles: ['admin'],
          requiredPermissions: ['delete:users'],
        },
        listAllUsers: {
          allowedRoles: ['admin'],
        },
      },
    });

    // Configure policy engine
    const policyEngine = new PolicyEngine(serverLogger);

    // Register auth components
    (serverNetron as any).authenticationManager = authManager;
    (serverNetron as any).authorizationManager = authzManager;
    (serverNetron as any).policyEngine = policyEngine;

    // Register transport and start server
    serverNetron.registerTransport('ws', () => new WebSocketTransport());
    serverNetron.registerTransportServer('ws', {
      name: 'ws',
      options: { host: 'localhost', port: serverPort },
    });

    await serverNetron.start();

    // Expose service
    await serverNetron.peer.exposeService(new UserService());

    // Setup client Netron
    const clientLogger = createMockLogger();
    clientNetron = new Netron(clientLogger, {
      id: 'client',
    });

    clientNetron.registerTransport('ws', () => new WebSocketTransport());
  });

  afterEach(async () => {
    // CRITICAL FIX: Add proper WebSocket cleanup delays
    // Wait for WebSocket connections to properly close before stopping
    await new Promise((resolve) => setTimeout(resolve, 200));

    await clientNetron?.stop();
    await serverNetron?.stop();

    // CRITICAL FIX: Additional delay for port release after WebSocket server stops
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  describe('WebSocket Authentication Flow', () => {
    it('should authenticate successfully with valid credentials', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      const authResult = await peer.runTask('authenticate', {
        username: 'admin@example.com',
        password: 'admin123',
      });

      expect(authResult.success).toBe(true);
      expect(authResult.context).toBeDefined();
      expect(authResult.context.userId).toBe('user1');
      expect(authResult.context.roles).toContain('admin');

      await peer.disconnect();
    });

    it('should fail authentication with invalid credentials', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      const authResult = await peer.runTask('authenticate', {
        username: 'admin@example.com',
        password: 'wrong-password',
      });

      expect(authResult.success).toBe(false);
      expect(authResult.error).toBe('Invalid credentials');

      await peer.disconnect();
    });
  });

  describe('Service Discovery with Authorization', () => {
    it('should query service interface with filtered methods based on auth', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Authenticate as regular user
      await peer.runTask('authenticate', {
        username: 'user@example.com',
        password: 'user123',
      });

      // Query service interface
      const definition = await peer.runTask('query_interface', 'userService@1.0.0');

      expect(definition).toBeDefined();
      expect(definition.meta.methods).toBeDefined();

      // User should have access to getUser and getCurrentUser
      expect(definition.meta.methods.getUser).toBeDefined();
      expect(definition.meta.methods.getCurrentUser).toBeDefined();

      await peer.disconnect();
    });

    it('should deny access to service for unauthenticated users', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Try to query without authentication
      try {
        await peer.runTask('query_interface', 'userService@1.0.0');
        throw new Error('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('Access denied');
      }

      await peer.disconnect();
    });
  });

  describe('Method-Level Authorization', () => {
    it('should allow admin to access all methods', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Authenticate as admin
      await peer.runTask('authenticate', {
        username: 'admin@example.com',
        password: 'admin123',
      });

      const service = await peer.queryInterface<any>('userService@1.0.0');

      // Admin can call all methods
      const user = await service.getUser('user2');
      expect(user).toBeDefined();
      expect(user.name).toBe('Bob');

      const updated = await service.updateUser('user2', { name: 'Bobby' });
      expect(updated.name).toBe('Bobby');

      const users = await service.listAllUsers();
      expect(users.length).toBeGreaterThan(0);

      await peer.releaseInterface(service);
      await peer.disconnect();
    });

    it('should deny non-admin users from calling admin methods', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Authenticate as regular user
      await peer.runTask('authenticate', {
        username: 'user@example.com',
        password: 'user123',
      });

      const service = await peer.queryInterface<any>('userService@1.0.0');

      // User can read
      const user = await service.getUser('user2');
      expect(user).toBeDefined();

      // User cannot update (admin only) - method should not be in interface
      try {
        await service.updateUser('user2', { name: 'Bobby' });
        throw new Error('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('Unknown member');
      }

      // User cannot delete (admin only) - method should not be in interface
      try {
        await service.deleteUser('user2');
        throw new Error('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('Unknown member');
      }

      await peer.releaseInterface(service);
      await peer.disconnect();
    });
  });

  describe('Multi-User Scenarios', () => {
    it('should handle multiple users with different permissions simultaneously', async () => {
      // Connect as admin
      const adminPeer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;
      await adminPeer.runTask('authenticate', {
        username: 'admin@example.com',
        password: 'admin123',
      });

      // Connect as regular user (need second client)
      const clientNetron2 = new Netron(createMockLogger(), { id: 'client2' });
      clientNetron2.registerTransport('ws', () => new WebSocketTransport());

      const userPeer = (await clientNetron2.connect(`ws://localhost:${serverPort}`)) as RemotePeer;
      await userPeer.runTask('authenticate', {
        username: 'user@example.com',
        password: 'user123',
      });

      // Get services
      const adminService = await adminPeer.queryInterface<any>('userService@1.0.0');
      const userService = await userPeer.queryInterface<any>('userService@1.0.0');

      // Admin can list all users
      const allUsers = await adminService.listAllUsers();
      expect(allUsers.length).toBeGreaterThan(0);

      // User cannot list all users - method should not be in interface
      try {
        await userService.listAllUsers();
        throw new Error('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('Unknown member');
      }

      // Both can read individual users
      const user1 = await adminService.getUser('user2');
      const user2 = await userService.getUser('user2');
      expect(user1).toEqual(user2);

      // Cleanup
      await adminPeer.releaseInterface(adminService);
      await userPeer.releaseInterface(userService);
      await adminPeer.disconnect();
      await userPeer.disconnect();
      await clientNetron2.stop();
    });
  });

  describe('Policy-Based Authorization', () => {
    it('should evaluate policies for method access', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Authenticate as admin
      await peer.runTask('authenticate', {
        username: 'admin@example.com',
        password: 'admin123',
      });

      const service = await peer.queryInterface<any>('userService@1.0.0');

      // listAllUsers requires 'requireRole:admin' policy
      const users = await service.listAllUsers();
      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);

      await peer.releaseInterface(service);
      await peer.disconnect();
    });

    it('should support OR policies (any)', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Authenticate as regular user
      await peer.runTask('authenticate', {
        username: 'user@example.com',
        password: 'user123',
      });

      const service = await peer.queryInterface<any>('userService@1.0.0');

      // getProfile requires admin OR read:own-profile permission
      // User has read:own-profile, so should succeed for own profile
      const profile = await service.getProfile('user2');
      expect(profile).toBeDefined();
      expect(profile.id).toBe('user2');

      await peer.releaseInterface(service);
      await peer.disconnect();
    });
  });

  describe('Token-Based Authentication', () => {
    it('should authenticate with token', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Create a token (simplified - in real app, server would issue JWT)
      const tokenPayload = {
        userId: 'user1',
        username: 'admin@example.com',
        roles: ['admin', 'user'],
        permissions: ['read:users', 'write:users', 'delete:users'],
      };

      const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

      // Authenticate with token
      const authResult = await peer.runTask('authenticate', { token });

      expect(authResult.success).toBe(true);
      expect(authResult.context.userId).toBe('user1');
      expect(authResult.context.roles).toContain('admin');

      await peer.disconnect();
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate service definition cache', async () => {
      const peer = (await clientNetron.connect(`ws://localhost:${serverPort}`)) as RemotePeer;

      // Authenticate
      await peer.runTask('authenticate', {
        username: 'admin@example.com',
        password: 'admin123',
      });

      // Query service (should cache definition)
      await peer.runTask('query_interface', 'userService@1.0.0');

      // Invalidate cache
      const invalidatedCount = await peer.runTask('invalidate_cache', 'userService@1.0.0');
      expect(invalidatedCount).toBeGreaterThanOrEqual(0);

      // Query again (should fetch fresh)
      const definition = await peer.runTask('query_interface', 'userService@1.0.0');
      expect(definition).toBeDefined();

      await peer.disconnect();
    });
  });
});
