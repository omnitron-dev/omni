/**
 * Audit Logger Tests
 * Comprehensive tests for audit trail functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  AuditLogger,
  MemoryAuditAdapter,
  FileAuditAdapter,
  type AuditStorageAdapter,
} from '../../../src/netron/auth/audit-logger.js';
import type { AuditEvent, PolicyDecision } from '../../../src/netron/auth/types.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';
import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock logger
const createMockLogger = (): ILogger => {
  const mockLogger: any = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return mockLogger;
};

describe('AuditLogger', () => {
  let logger: ILogger;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  describe('Basic Functionality', () => {
    beforeEach(() => {
      auditLogger = new AuditLogger(logger);
    });

    it('should log audit events with default config', async () => {
      const event: AuditEvent = {
        timestamp: new Date(),
        userId: 'user123',
        service: 'calculator',
        method: 'add',
        args: [1, 2],
        result: 3,
        success: true,
      };

      await auditLogger.logAuth(event);

      // Query events
      const events = await auditLogger.query();
      expect(events).toHaveLength(1);
      expect(events[0].userId).toBe('user123');
      expect(events[0].service).toBe('calculator');
      expect(events[0].method).toBe('add');
    });

    it('should support async logging (non-blocking)', async () => {
      auditLogger = new AuditLogger(logger, { async: true });

      const event: AuditEvent = {
        timestamp: new Date(),
        userId: 'user123',
        service: 'test',
        method: 'method',
        success: true,
      };

      // Should return immediately
      await auditLogger.logAuth(event);

      // Give it a moment to process async
      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await auditLogger.query();
      expect(events).toHaveLength(1);
    });

    it('should support sync logging (blocking)', async () => {
      auditLogger = new AuditLogger(logger, { async: false });

      const event: AuditEvent = {
        timestamp: new Date(),
        userId: 'user123',
        service: 'test',
        method: 'method',
        success: true,
      };

      await auditLogger.logAuth(event);

      // Should be available immediately
      const events = await auditLogger.query();
      expect(events).toHaveLength(1);
    });

    it('should clear audit logs', async () => {
      const event: AuditEvent = {
        timestamp: new Date(),
        userId: 'user123',
        service: 'test',
        method: 'method',
        success: true,
      };

      await auditLogger.logAuth(event);
      expect(await auditLogger.query()).toHaveLength(1);

      await auditLogger.clearLogs();
      expect(await auditLogger.query()).toHaveLength(0);
    });
  });

  describe('Configuration Options', () => {
    it('should include args when includeArgs is true', async () => {
      auditLogger = new AuditLogger(logger, { includeArgs: true });

      const event: AuditEvent = {
        timestamp: new Date(),
        service: 'calculator',
        method: 'add',
        args: [1, 2],
        success: true,
      };

      await auditLogger.logAuth(event);

      const events = await auditLogger.query();
      expect(events[0].args).toEqual([1, 2]);
    });

    it('should exclude args when includeArgs is false', async () => {
      auditLogger = new AuditLogger(logger, { includeArgs: false });

      const event: AuditEvent = {
        timestamp: new Date(),
        service: 'calculator',
        method: 'add',
        args: [1, 2],
        success: true,
      };

      await auditLogger.logAuth(event);

      const events = await auditLogger.query();
      expect(events[0].args).toBeUndefined();
    });

    it('should include result when includeResult is true', async () => {
      auditLogger = new AuditLogger(logger, { includeResult: true });

      const event: AuditEvent = {
        timestamp: new Date(),
        service: 'calculator',
        method: 'add',
        result: 3,
        success: true,
      };

      await auditLogger.logAuth(event);

      const events = await auditLogger.query();
      expect(events[0].result).toBe(3);
    });

    it('should exclude result when includeResult is false', async () => {
      auditLogger = new AuditLogger(logger, { includeResult: false });

      const event: AuditEvent = {
        timestamp: new Date(),
        service: 'calculator',
        method: 'add',
        result: 3,
        success: true,
      };

      await auditLogger.logAuth(event);

      const events = await auditLogger.query();
      expect(events[0].result).toBeUndefined();
    });

    it('should include user when includeUser is true', async () => {
      auditLogger = new AuditLogger(logger, { includeUser: true });

      const event: AuditEvent = {
        timestamp: new Date(),
        userId: 'user123',
        service: 'test',
        method: 'method',
        success: true,
      };

      await auditLogger.logAuth(event);

      const events = await auditLogger.query();
      expect(events[0].userId).toBe('user123');
    });

    it('should exclude user when includeUser is false', async () => {
      auditLogger = new AuditLogger(logger, { includeUser: false });

      const event: AuditEvent = {
        timestamp: new Date(),
        userId: 'user123',
        service: 'test',
        method: 'method',
        success: true,
      };

      await auditLogger.logAuth(event);

      const events = await auditLogger.query();
      expect(events[0].userId).toBeUndefined();
    });

    it('should call custom logger function', async () => {
      const customLogger = jest.fn();
      auditLogger = new AuditLogger(logger, { logger: customLogger });

      const event: AuditEvent = {
        timestamp: new Date(),
        service: 'test',
        method: 'method',
        success: true,
      };

      await auditLogger.logAuth(event);

      expect(customLogger).toHaveBeenCalled();
      expect(customLogger.mock.calls[0][0]).toMatchObject({
        service: 'test',
        method: 'method',
        success: true,
      });
    });

    it('should handle custom logger errors gracefully', async () => {
      const customLogger = jest.fn(() => {
        throw new Error('Custom logger failed');
      });
      auditLogger = new AuditLogger(logger, { logger: customLogger });

      const event: AuditEvent = {
        timestamp: new Date(),
        service: 'test',
        method: 'method',
        success: true,
      };

      // Should not throw
      await expect(auditLogger.logAuth(event)).resolves.not.toThrow();

      // Event should still be stored
      const events = await auditLogger.query();
      expect(events).toHaveLength(1);
    });

    it('should update configuration dynamically', async () => {
      auditLogger = new AuditLogger(logger, { includeArgs: false });

      // Log without args
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'test',
        method: 'method1',
        args: [1, 2],
        success: true,
      });

      // Update config
      auditLogger.configure({ includeArgs: true });

      // Log with args
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'test',
        method: 'method2',
        args: [3, 4],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args).toBeUndefined();
      expect(events[1].args).toEqual([3, 4]);
    });
  });

  describe('Query Filtering', () => {
    beforeEach(async () => {
      auditLogger = new AuditLogger(logger, { includeUser: true, includeArgs: true });

      // Log multiple events
      await auditLogger.logAuth({
        timestamp: new Date('2025-01-01T10:00:00Z'),
        userId: 'user1',
        service: 'service1',
        method: 'method1',
        success: true,
      });

      await auditLogger.logAuth({
        timestamp: new Date('2025-01-01T11:00:00Z'),
        userId: 'user2',
        service: 'service2',
        method: 'method2',
        success: false,
        error: 'Error occurred',
      });

      await auditLogger.logAuth({
        timestamp: new Date('2025-01-01T12:00:00Z'),
        userId: 'user1',
        service: 'service1',
        method: 'method3',
        success: true,
      });
    });

    it('should filter by userId', async () => {
      const events = await auditLogger.query({ userId: 'user1' });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.userId === 'user1')).toBe(true);
    });

    it('should filter by service', async () => {
      const events = await auditLogger.query({ service: 'service1' });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.service === 'service1')).toBe(true);
    });

    it('should filter by method', async () => {
      const events = await auditLogger.query({ method: 'method1' });
      expect(events).toHaveLength(1);
      expect(events[0].method).toBe('method1');
    });

    it('should filter by success status', async () => {
      const successEvents = await auditLogger.query({ success: true });
      expect(successEvents).toHaveLength(2);
      expect(successEvents.every((e) => e.success)).toBe(true);

      const failedEvents = await auditLogger.query({ success: false });
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].success).toBe(false);
    });

    it('should filter by time range', async () => {
      const events = await auditLogger.query({
        startTime: new Date('2025-01-01T10:30:00Z'),
        endTime: new Date('2025-01-01T11:30:00Z'),
      });
      expect(events).toHaveLength(1);
      expect(events[0].method).toBe('method2');
    });

    it('should support pagination with limit', async () => {
      const events = await auditLogger.query({ limit: 2 });
      expect(events).toHaveLength(2);
    });

    it('should support pagination with offset', async () => {
      const events = await auditLogger.query({ offset: 1, limit: 2 });
      expect(events).toHaveLength(2);
      expect(events[0].method).toBe('method2');
    });

    it('should combine multiple filters', async () => {
      const events = await auditLogger.query({
        userId: 'user1',
        service: 'service1',
        success: true,
      });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.userId === 'user1')).toBe(true);
      expect(events.every((e) => e.service === 'service1')).toBe(true);
      expect(events.every((e) => e.success)).toBe(true);
    });
  });

  describe('MemoryAuditAdapter', () => {
    let adapter: MemoryAuditAdapter;

    beforeEach(() => {
      adapter = new MemoryAuditAdapter(5);
      auditLogger = new AuditLogger(logger, { storage: adapter });
    });

    it('should store events in memory', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'test',
        method: 'method',
        success: true,
      });

      expect(adapter.size()).toBe(1);
    });

    it('should implement circular buffer when max size reached', async () => {
      // Log 6 events (max is 5)
      for (let i = 0; i < 6; i++) {
        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'test',
          method: `method${i}`,
          success: true,
        });
      }

      expect(adapter.size()).toBe(5);
      const events = adapter.getAll();
      // First event should be dropped
      expect(events[0].method).toBe('method1');
      expect(events[4].method).toBe('method5');
    });

    it('should clear all events', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'test',
        method: 'method',
        success: true,
      });

      await adapter.clear();
      expect(adapter.size()).toBe(0);
    });
  });

  describe('FileAuditAdapter', () => {
    let adapter: FileAuditAdapter;
    let tempFile: string;

    beforeEach(() => {
      tempFile = path.join(os.tmpdir(), `audit-test-${Date.now()}.log`);
      adapter = new FileAuditAdapter(tempFile);
      auditLogger = new AuditLogger(logger, { storage: adapter, async: false });
    });

    afterEach(async () => {
      adapter.destroy();
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });

    it('should save events to file', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'test',
        method: 'method',
        success: true,
      });

      await adapter.flush();

      expect(fs.existsSync(tempFile)).toBe(true);
      const content = fs.readFileSync(tempFile, 'utf-8');
      expect(content).toContain('test');
      expect(content).toContain('method');
    });

    it('should query events from file', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        userId: 'user1',
        service: 'service1',
        method: 'method1',
        success: true,
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        userId: 'user2',
        service: 'service2',
        method: 'method2',
        success: true,
      });

      const events = await auditLogger.query({ userId: 'user1' });
      expect(events).toHaveLength(1);
      expect(events[0].userId).toBe('user1');
    });

    it('should clear file', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'test',
        method: 'method',
        success: true,
      });

      await adapter.flush();
      expect(fs.existsSync(tempFile)).toBe(true);

      await adapter.clear();
      expect(fs.existsSync(tempFile)).toBe(false);
    });

    it('should auto-flush on large queue', async () => {
      // Write 100+ events to trigger auto-flush
      for (let i = 0; i < 105; i++) {
        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'test',
          method: `method${i}`,
          success: true,
        });
      }

      expect(fs.existsSync(tempFile)).toBe(true);
      const events = await auditLogger.query();
      expect(events.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Security and Data Sanitization', () => {
    beforeEach(() => {
      auditLogger = new AuditLogger(logger, { includeArgs: true, includeResult: true });
    });

    it('should redact passwords in args', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'auth',
        method: 'login',
        args: [{ username: 'user', password: 'secret123' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].username).toBe('user');
      expect(events[0].args![0].password).toBe('[REDACTED]');
    });

    it('should redact tokens in args', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'api',
        method: 'call',
        args: [{ token: 'bearer-token-123', data: 'value' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].token).toBe('[REDACTED]');
      expect(events[0].args![0].data).toBe('value');
    });

    it('should redact secrets in nested objects', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'api',
        method: 'call',
        args: [
          {
            config: {
              apiKey: 'secret-key',
              url: 'https://api.example.com',
            },
          },
        ],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].config.apiKey).toBe('[REDACTED]');
      expect(events[0].args![0].config.url).toBe('https://api.example.com');
    });

    it('should truncate large events', async () => {
      // Create large data
      const largeData = 'x'.repeat(15000);

      auditLogger = new AuditLogger(logger, {
        includeArgs: true,
        maxEventSize: 10000,
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'test',
        method: 'method',
        args: [largeData],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].metadata?.truncated).toBe(true);
      expect(events[0].args).toEqual(['[TRUNCATED]']);
    });
  });

  describe('Auth Decision Logging', () => {
    beforeEach(() => {
      auditLogger = new AuditLogger(logger, { includeUser: true });
    });

    it('should log auth decisions', async () => {
      const decision: PolicyDecision = {
        allowed: true,
        reason: 'User has required role',
        metadata: { policy: 'admin-only' },
      };

      await auditLogger.logAuth({
        timestamp: new Date(),
        userId: 'user123',
        service: 'admin',
        method: 'deleteUser',
        authDecision: decision,
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].authDecision).toBeDefined();
      expect(events[0].authDecision?.allowed).toBe(true);
      expect(events[0].authDecision?.reason).toBe('User has required role');
    });

    it('should log failed auth decisions', async () => {
      const decision: PolicyDecision = {
        allowed: false,
        reason: 'Insufficient permissions',
      };

      await auditLogger.logAuth({
        timestamp: new Date(),
        userId: 'user123',
        service: 'admin',
        method: 'deleteUser',
        authDecision: decision,
        success: false,
      });

      const events = await auditLogger.query({ success: false });
      expect(events).toHaveLength(1);
      expect(events[0].authDecision?.allowed).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle storage errors gracefully', async () => {
      const faultyAdapter: AuditStorageAdapter = {
        save: jest.fn().mockRejectedValue(new Error('Storage failed')),
        query: jest.fn().mockResolvedValue([]),
        clear: jest.fn().mockResolvedValue(undefined),
      };

      auditLogger = new AuditLogger(logger, {
        storage: faultyAdapter,
        async: false,
      });

      // Should not throw
      await expect(
        auditLogger.logAuth({
          timestamp: new Date(),
          service: 'test',
          method: 'method',
          success: true,
        })
      ).resolves.not.toThrow();
    });

    it('should handle query errors gracefully', async () => {
      const faultyAdapter: AuditStorageAdapter = {
        save: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockRejectedValue(new Error('Query failed')),
        clear: jest.fn().mockResolvedValue(undefined),
      };

      auditLogger = new AuditLogger(logger, { storage: faultyAdapter });

      const events = await auditLogger.query();
      expect(events).toEqual([]);
    });
  });

  describe('Performance', () => {
    it('should handle high throughput (1000+ events/sec)', async () => {
      auditLogger = new AuditLogger(logger, { async: true });

      const count = 2000;
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(
          auditLogger.logAuth({
            timestamp: new Date(),
            userId: `user${i}`,
            service: 'test',
            method: 'method',
            success: true,
          })
        );
      }

      await Promise.all(promises);
      const duration = performance.now() - startTime;
      const throughput = (count / duration) * 1000;

      console.log(`Throughput: ${throughput.toFixed(0)} events/sec`);
      expect(throughput).toBeGreaterThan(1000);
    });

    it('should handle batch queries efficiently', async () => {
      auditLogger = new AuditLogger(logger);

      // Log 1000 events
      for (let i = 0; i < 1000; i++) {
        await auditLogger.logAuth({
          timestamp: new Date(),
          userId: `user${i % 10}`,
          service: 'test',
          method: 'method',
          success: true,
        });
      }

      const startTime = performance.now();
      const events = await auditLogger.query({ userId: 'user5' });
      const duration = performance.now() - startTime;

      expect(events).toHaveLength(100);
      expect(duration).toBeLessThan(50); // Should be fast
    });
  });

  describe('Custom Storage Adapter', () => {
    it('should support custom storage adapter', async () => {
      const customEvents: AuditEvent[] = [];
      const customAdapter: AuditStorageAdapter = {
        save: async (event) => {
          customEvents.push(event);
        },
        query: async (filter) =>
          customEvents.filter((e) => {
            if (filter.userId && e.userId !== filter.userId) return false;
            return true;
          }),
        clear: async () => {
          customEvents.length = 0;
        },
      };

      auditLogger = new AuditLogger(logger, { storage: customAdapter });

      await auditLogger.logAuth({
        timestamp: new Date(),
        userId: 'user1',
        service: 'test',
        method: 'method',
        success: true,
      });

      expect(customEvents).toHaveLength(1);
      const events = await auditLogger.query({ userId: 'user1' });
      expect(events).toHaveLength(1);
    });
  });
});
