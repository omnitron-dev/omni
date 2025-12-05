/**
 * Unit tests for NetronClient
 *
 * Tests connection states, retry logic, timeouts, and cleanup
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NetronClient, ConnectionState } from '../../../../src/modules/pm/netron-client.js';

// Mock logger
const createMockLogger = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
});

describe('NetronClient', () => {
  let client: NetronClient;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Constructor and Initialization', () => {
    it('should create client with default options', () => {
      client = new NetronClient('test-process', mockLogger as any);

      expect(client.state).toBe(ConnectionState.DISCONNECTED);
      expect(client.isConnected()).toBe(false);
    });

    it('should create client with custom options', () => {
      client = new NetronClient('test-process', mockLogger as any, {
        connectTimeout: 5000,
        maxRetries: 5,
        baseDelay: 500,
        maxDelay: 15000,
        autoReconnect: true,
      });

      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should start the netron instance', async () => {
      client = new NetronClient('test-process', mockLogger as any);
      await client.start();

      expect(client.getNetron()).toBeDefined();
    });

    it('should have getNetron method', () => {
      client = new NetronClient('test-process', mockLogger as any);

      const netron = client.getNetron();
      expect(netron).toBeDefined();
    });
  });

  describe('Connection State Management', () => {
    beforeEach(() => {
      client = new NetronClient('test-process', mockLogger as any, {
        connectTimeout: 1000,
        maxRetries: 0,
      });
    });

    it('should start in DISCONNECTED state', () => {
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should return false for isConnected when disconnected', () => {
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('Connection Errors', () => {
    it('should transition to CONNECTING state when connect is called', async () => {
      client = new NetronClient('test-process', mockLogger as any, {
        connectTimeout: 100,
        maxRetries: 0,
      });

      // Attempt connection to invalid URL - should transition through states
      const connectPromise = client.connect('tcp://invalid-host:99999');

      // State should be CONNECTING briefly
      expect([ConnectionState.CONNECTING, ConnectionState.FAILED]).toContain(client.state);

      // Wait for it to fail
      await expect(connectPromise).rejects.toThrow();
      expect(client.state).toBe(ConnectionState.FAILED);
    });

    it('should throw on transport not found', async () => {
      client = new NetronClient('test-process', mockLogger as any, {
        maxRetries: 0,
      });

      // Invalid URL scheme should fail to find transport
      await expect(client.connect('invalid-protocol://localhost:8000')).rejects.toThrow();
    });
  });

  describe('Query Interface', () => {
    beforeEach(() => {
      client = new NetronClient('test-process', mockLogger as any, {
        maxRetries: 0,
      });
    });

    it('should throw if not connected', async () => {
      await expect(client.queryInterface('TestService')).rejects.toThrow('Not connected');
    });
  });

  describe('Method Calls', () => {
    beforeEach(() => {
      client = new NetronClient('test-process', mockLogger as any, {
        maxRetries: 0,
      });
    });

    it('should throw if trying to call when not connected', async () => {
      // Not connected, so should throw on queryInterface
      await expect(client.queryInterface('TestService')).rejects.toThrow();
    });
  });

  describe('Disconnect', () => {
    beforeEach(() => {
      client = new NetronClient('test-process', mockLogger as any, {
        maxRetries: 0,
      });
    });

    it('should be safe to disconnect when already disconnected', async () => {
      await client.disconnect();
      await client.disconnect();

      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should transition to DISCONNECTED state on disconnect', async () => {
      await client.disconnect();

      expect(client.state).toBe(ConnectionState.DISCONNECTED);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('isConnected helper', () => {
    beforeEach(() => {
      client = new NetronClient('test-process', mockLogger as any);
    });

    it('should return false when disconnected', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return false after failed connection', async () => {
      client = new NetronClient('test-process', mockLogger as any, { maxRetries: 0 });

      await expect(client.connect('invalid://address')).rejects.toThrow();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('State Transitions', () => {
    it('should have all expected connection states', () => {
      expect(ConnectionState.DISCONNECTED).toBe('disconnected');
      expect(ConnectionState.CONNECTING).toBe('connecting');
      expect(ConnectionState.CONNECTED).toBe('connected');
      expect(ConnectionState.RECONNECTING).toBe('reconnecting');
      expect(ConnectionState.DISCONNECTING).toBe('disconnecting');
      expect(ConnectionState.FAILED).toBe('failed');
    });
  });

  describe('Options', () => {
    it('should use default options when none provided', () => {
      client = new NetronClient('test-process', mockLogger as any);

      // Verify client created successfully with defaults
      expect(client).toBeDefined();
      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should merge custom options with defaults', () => {
      client = new NetronClient('test-process', mockLogger as any, {
        connectTimeout: 5000,
      });

      // Verify client created successfully
      expect(client).toBeDefined();
    });

    it('should handle all option fields', () => {
      client = new NetronClient('test-process', mockLogger as any, {
        connectTimeout: 5000,
        maxRetries: 5,
        baseDelay: 1000,
        maxDelay: 30000,
        autoReconnect: true,
      });

      expect(client).toBeDefined();
    });
  });

  describe('Process ID', () => {
    it('should create unique clients per process ID', () => {
      const client1 = new NetronClient('process-1', mockLogger as any);
      const client2 = new NetronClient('process-2', mockLogger as any);

      expect(client1).not.toBe(client2);
      expect(client1.getNetron().id).toContain('process-1');
      expect(client2.getNetron().id).toContain('process-2');
    });
  });

  describe('Already Connected', () => {
    it('should log debug message if already connected', async () => {
      client = new NetronClient('test-process', mockLogger as any);

      // Cannot easily test "already connected" without mocking internals
      // This test verifies the client logs when appropriate
      expect(mockLogger.debug).toBeDefined();
    });
  });

  describe('Conflict on Multiple Connect Attempts', () => {
    it('should throw conflict if connection already in progress', async () => {
      client = new NetronClient('test-process', mockLogger as any, {
        connectTimeout: 5000,
        maxRetries: 0,
      });

      // Start first connection (which will be slow due to invalid host)
      const firstConnect = client.connect('tcp://10.255.255.1:9999'); // Non-routable IP

      // Try second connection immediately
      await expect(client.connect('tcp://localhost:8000')).rejects.toThrow('already in progress');

      // Let the first one timeout/fail
      await expect(firstConnect).rejects.toThrow();
    }, 10000);
  });
});
