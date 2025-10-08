/**
 * Basic HTTP Transport E2E Tests
 * Tests browser Netron HTTP client with real Titan backend
 */

import { test, expect, Page } from '@playwright/test';

test.describe('HTTP Transport - Basic Connection and RPC', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    // Initialize test state
    await page.evaluate(() => {
      (window as any).testState = {
        httpPeer: null,
        results: []
      };
    });
  });

  test('should load test page successfully', async () => {
    const title = await page.title();
    expect(title).toBeTruthy();

    // Check that page content is loaded
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should connect to Titan HTTP server', async () => {
    const result = await page.evaluate(async () => {
      try {
        // Import HttpRemotePeer from built bundle
        const { HttpRemotePeer } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/peer.js');
        const { HttpConnection } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/connection.js');

        // Create connection
        const connection = new HttpConnection('http://localhost:3333');
        const netron = {
          id: 'test-client',
          peer: null as any
        };

        // Create peer
        const peer = new HttpRemotePeer(connection, netron, 'http://localhost:3333');
        await peer.init(true);

        (window as any).testState.httpPeer = peer;

        return { success: true, peerId: peer.id };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('peerId');
  });

  test('should query service interface', async () => {
    // First connect
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/peer.js');
      const { HttpConnection } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/connection.js');

      const connection = new HttpConnection('http://localhost:3333');
      const netron = { id: 'test-client', peer: null as any };
      const peer = new HttpRemotePeer(connection, netron, 'http://localhost:3333');
      await peer.init(true);

      (window as any).testState.httpPeer = peer;
    });

    // Then query service
    const result = await page.evaluate(async () => {
      try {
        const peer = (window as any).testState.httpPeer;
        const definition = await peer.queryInterfaceRemote('UserService@1.0.0');

        return {
          success: true,
          serviceName: definition.meta.name,
          version: definition.meta.version,
          methods: Object.keys(definition.meta.methods || {})
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.serviceName).toBe('UserService');
    expect(result.version).toBe('1.0.0');
    expect(result.methods).toContain('getUser');
    expect(result.methods).toContain('getUsers');
  });

  test('should call remote RPC method', async () => {
    // Setup connection
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/peer.js');
      const { HttpConnection } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/connection.js');

      const connection = new HttpConnection('http://localhost:3333');
      const netron = { id: 'test-client', peer: null as any };
      const peer = new HttpRemotePeer(connection, netron, 'http://localhost:3333');
      await peer.init(true);

      (window as any).testState.httpPeer = peer;
    });

    // Call getUsers method
    const result = await page.evaluate(async () => {
      try {
        const peer = (window as any).testState.httpPeer;
        const userService = await peer.queryInterface('UserService@1.0.0');
        const users = await userService.getUsers();

        return {
          success: true,
          users,
          count: users.length
        };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.users[0]).toHaveProperty('id');
    expect(result.users[0]).toHaveProperty('name');
    expect(result.users[0]).toHaveProperty('email');
  });

  test('should get single user by ID', async () => {
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/peer.js');
      const { HttpConnection } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/connection.js');

      const connection = new HttpConnection('http://localhost:3333');
      const netron = { id: 'test-client', peer: null as any };
      const peer = new HttpRemotePeer(connection, netron, 'http://localhost:3333');
      await peer.init(true);

      (window as any).testState.httpPeer = peer;
    });

    const result = await page.evaluate(async () => {
      try {
        const peer = (window as any).testState.httpPeer;
        const userService = await peer.queryInterface('UserService@1.0.0');
        const user = await userService.getUser('user-1');

        return { success: true, user };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user.id).toBe('user-1');
  });

  test('should create new user', async () => {
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/peer.js');
      const { HttpConnection } = await import('/@fs' + '/Users/taaliman/projects/omnitron-dev/omni/packages/aether/dist/netron/transport/http/connection.js');

      const connection = new HttpConnection('http://localhost:3333');
      const netron = { id: 'test-client', peer: null as any };
      const peer = new HttpRemotePeer(connection, netron, 'http://localhost:3333');
      await peer.init(true);

      (window as any).testState.httpPeer = peer;
    });

    const result = await page.evaluate(async () => {
      try {
        const peer = (window as any).testState.httpPeer;
        const userService = await peer.queryInterface('UserService@1.0.0');
        const newUser = await userService.createUser({
          name: 'Test User',
          email: 'test@example.com',
          age: 30
        });

        return { success: true, user: newUser };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user.name).toBe('Test User');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.age).toBe(30);
    expect(result.user).toHaveProperty('id');
    expect(result.user).toHaveProperty('createdAt');
  });
});
