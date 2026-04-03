/**
 * Integration Tests for AuditLogger
 *
 * Tests real implementations (NO MOCKS except for logger):
 * - MemoryAuditAdapter: save, query with filters, clear, circular buffer behavior, size()
 * - FileAuditAdapter: save, query, clear, flush, auto-flush, destroy
 * - AuditLogger: logAuth, query, clearLogs, configure, getConfig
 * - Data sanitization (password, token, secret fields redaction)
 * - Event size limiting and truncation
 * - Async vs sync modes
 * - Custom logger callback
 * - Pagination (offset, limit)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AuditLogger,
  MemoryAuditAdapter,
  FileAuditAdapter,
  type EnhancedAuditEvent,
} from '../../../src/netron/auth/audit-logger.js';
import type { AuditEvent, PolicyDecision } from '../../../src/netron/auth/types.js';
import type { ILogger, LogLevel } from '../../../src/types/logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Shared call tracking for mock logger and all its children
 */
interface LoggerCalls {
  trace: any[][];
  debug: any[][];
  info: any[][];
  warn: any[][];
  error: any[][];
  fatal: any[][];
}

/**
 * Mock logger implementing ILogger interface
 * Only the logger is mocked - all other components use real implementations
 * Child loggers share the same calls object for tracking
 */
function createMockLogger(sharedCalls?: LoggerCalls): ILogger & { calls: LoggerCalls } {
  const calls: LoggerCalls = sharedCalls || {
    trace: [],
    debug: [],
    info: [],
    warn: [],
    error: [],
    fatal: [],
  };

  let currentLevel: LogLevel = 'info';

  const createLogFn =
    (level: keyof LoggerCalls) =>
    (...args: any[]) => {
      calls[level].push(args);
    };

  const logger: ILogger & { calls: LoggerCalls } = {
    trace: createLogFn('trace'),
    debug: createLogFn('debug'),
    info: createLogFn('info'),
    warn: createLogFn('warn'),
    error: createLogFn('error'),
    fatal: createLogFn('fatal'),
    child: (_bindings: object) => createMockLogger(calls), // Share calls with children
    time: (_label?: string) => () => {},
    isLevelEnabled: (_level: LogLevel) => true,
    setLevel: (level: LogLevel) => {
      currentLevel = level;
    },
    getLevel: () => currentLevel,
    calls,
  };

  return logger;
}

describe('AuditLogger Integration Tests', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  describe('MemoryAuditAdapter', () => {
    let adapter: MemoryAuditAdapter;

    describe('save operation', () => {
      beforeEach(() => {
        adapter = new MemoryAuditAdapter(100);
      });

      it('should save events and track count via size()', async () => {
        const event: AuditEvent = {
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: true,
        };

        expect(adapter.size()).toBe(0);

        await adapter.save(event);
        expect(adapter.size()).toBe(1);

        await adapter.save({ ...event, method: 'method2' });
        expect(adapter.size()).toBe(2);

        await adapter.save({ ...event, method: 'method3' });
        expect(adapter.size()).toBe(3);
      });

      it('should automatically set success=true when no error present', async () => {
        const event: AuditEvent = {
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
        } as AuditEvent;

        await adapter.save(event);

        const events = await adapter.query({});
        expect(events[0].success).toBe(true);
      });

      it('should automatically set success=false when error present', async () => {
        const event: EnhancedAuditEvent = {
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: undefined as any,
          error: 'Something went wrong',
        };

        await adapter.save(event);

        const events = await adapter.query({});
        expect(events[0].success).toBe(false);
      });
    });

    describe('circular buffer behavior', () => {
      it('should implement circular buffer when max size is reached', async () => {
        adapter = new MemoryAuditAdapter(5); // Small buffer for testing

        // Add 7 events to a buffer of size 5
        for (let i = 0; i < 7; i++) {
          await adapter.save({
            timestamp: new Date(2025, 0, 1, 10, 0, i), // Different timestamps
            service: 'testService',
            method: `method${i}`,
            success: true,
          });
        }

        // Should only have 5 events (buffer size)
        expect(adapter.size()).toBe(5);

        // First two events should be dropped
        const events = adapter.getAll();
        expect(events.map((e) => e.method)).toEqual(['method2', 'method3', 'method4', 'method5', 'method6']);
      });

      it('should maintain chronological order in getAll() after buffer wrap', async () => {
        adapter = new MemoryAuditAdapter(3);

        for (let i = 0; i < 5; i++) {
          await adapter.save({
            timestamp: new Date(2025, 0, 1, 10, 0, i),
            service: 'testService',
            method: `method${i}`,
            success: true,
          });
        }

        const events = adapter.getAll();
        // Should be in chronological order (oldest to newest)
        expect(events[0].method).toBe('method2');
        expect(events[1].method).toBe('method3');
        expect(events[2].method).toBe('method4');
      });

      it('should handle exact buffer size without wrapping', async () => {
        adapter = new MemoryAuditAdapter(3);

        for (let i = 0; i < 3; i++) {
          await adapter.save({
            timestamp: new Date(),
            service: 'testService',
            method: `method${i}`,
            success: true,
          });
        }

        expect(adapter.size()).toBe(3);
        const events = adapter.getAll();
        expect(events.map((e) => e.method)).toEqual(['method0', 'method1', 'method2']);
      });
    });

    describe('query with filters', () => {
      beforeEach(async () => {
        adapter = new MemoryAuditAdapter(100);

        // Populate with test data
        const baseTime = new Date('2025-01-15T10:00:00Z');

        await adapter.save({
          timestamp: new Date(baseTime.getTime()),
          userId: 'user1',
          service: 'serviceA',
          method: 'methodX',
          success: true,
        });

        await adapter.save({
          timestamp: new Date(baseTime.getTime() + 60000), // +1 min
          userId: 'user2',
          service: 'serviceA',
          method: 'methodY',
          success: false,
          error: 'Permission denied',
        } as EnhancedAuditEvent);

        await adapter.save({
          timestamp: new Date(baseTime.getTime() + 120000), // +2 min
          userId: 'user1',
          service: 'serviceB',
          method: 'methodX',
          success: true,
        });

        await adapter.save({
          timestamp: new Date(baseTime.getTime() + 180000), // +3 min
          userId: 'user3',
          service: 'serviceB',
          method: 'methodZ',
          success: true,
        });
      });

      it('should filter by userId', async () => {
        const events = await adapter.query({ userId: 'user1' });
        expect(events).toHaveLength(2);
        expect(events.every((e) => e.userId === 'user1')).toBe(true);
      });

      it('should filter by service', async () => {
        const events = await adapter.query({ service: 'serviceA' });
        expect(events).toHaveLength(2);
        expect(events.every((e) => e.service === 'serviceA')).toBe(true);
      });

      it('should filter by method', async () => {
        const events = await adapter.query({ method: 'methodX' });
        expect(events).toHaveLength(2);
        expect(events.every((e) => e.method === 'methodX')).toBe(true);
      });

      it('should filter by success status', async () => {
        const successEvents = await adapter.query({ success: true });
        expect(successEvents).toHaveLength(3);

        const failedEvents = await adapter.query({ success: false });
        expect(failedEvents).toHaveLength(1);
        expect(failedEvents[0].error).toBe('Permission denied');
      });

      it('should filter by startTime', async () => {
        const events = await adapter.query({
          startTime: new Date('2025-01-15T10:01:30Z'),
        });
        expect(events).toHaveLength(2);
      });

      it('should filter by endTime', async () => {
        const events = await adapter.query({
          endTime: new Date('2025-01-15T10:01:30Z'),
        });
        expect(events).toHaveLength(2);
      });

      it('should filter by time range (startTime and endTime)', async () => {
        const events = await adapter.query({
          startTime: new Date('2025-01-15T10:00:30Z'),
          endTime: new Date('2025-01-15T10:02:30Z'),
        });
        expect(events).toHaveLength(2);
      });

      it('should combine multiple filters', async () => {
        const events = await adapter.query({
          userId: 'user1',
          service: 'serviceA',
          success: true,
        });
        expect(events).toHaveLength(1);
        expect(events[0].method).toBe('methodX');
      });

      it('should return empty array when no matches', async () => {
        const events = await adapter.query({ userId: 'nonexistent' });
        expect(events).toHaveLength(0);
      });
    });

    describe('pagination (offset, limit)', () => {
      beforeEach(async () => {
        adapter = new MemoryAuditAdapter(100);

        for (let i = 0; i < 10; i++) {
          await adapter.save({
            timestamp: new Date(2025, 0, 1, 10, 0, i),
            service: 'testService',
            method: `method${i}`,
            success: true,
          });
        }
      });

      it('should apply limit', async () => {
        const events = await adapter.query({ limit: 3 });
        expect(events).toHaveLength(3);
        expect(events[0].method).toBe('method0');
        expect(events[2].method).toBe('method2');
      });

      it('should apply offset', async () => {
        const events = await adapter.query({ offset: 5 });
        expect(events).toHaveLength(5);
        expect(events[0].method).toBe('method5');
      });

      it('should apply both offset and limit', async () => {
        const events = await adapter.query({ offset: 3, limit: 4 });
        expect(events).toHaveLength(4);
        expect(events[0].method).toBe('method3');
        expect(events[3].method).toBe('method6');
      });

      it('should handle offset beyond total count', async () => {
        const events = await adapter.query({ offset: 20 });
        expect(events).toHaveLength(0);
      });

      it('should handle limit larger than remaining items', async () => {
        const events = await adapter.query({ offset: 8, limit: 10 });
        expect(events).toHaveLength(2);
      });
    });

    describe('clear operation', () => {
      it('should clear all events', async () => {
        adapter = new MemoryAuditAdapter(100);

        for (let i = 0; i < 5; i++) {
          await adapter.save({
            timestamp: new Date(),
            service: 'testService',
            method: `method${i}`,
            success: true,
          });
        }

        expect(adapter.size()).toBe(5);

        await adapter.clear();

        expect(adapter.size()).toBe(0);
        const events = await adapter.query({});
        expect(events).toHaveLength(0);
      });

      it('should allow adding events after clear', async () => {
        adapter = new MemoryAuditAdapter(100);

        await adapter.save({
          timestamp: new Date(),
          service: 'testService',
          method: 'method1',
          success: true,
        });

        await adapter.clear();

        await adapter.save({
          timestamp: new Date(),
          service: 'testService',
          method: 'method2',
          success: true,
        });

        expect(adapter.size()).toBe(1);
        const events = await adapter.query({});
        expect(events[0].method).toBe('method2');
      });
    });
  });

  describe('FileAuditAdapter', () => {
    let adapter: FileAuditAdapter;
    let tempDir: string;
    let tempFile: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
      tempFile = path.join(tempDir, 'audit.log');
    });

    afterEach(async () => {
      if (adapter) {
        adapter.destroy();
      }
      // Clean up temp files
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    describe('save and flush', () => {
      it('should save events to file after flush', async () => {
        adapter = new FileAuditAdapter(tempFile);

        await adapter.save({
          timestamp: new Date('2025-01-15T10:00:00Z'),
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        await adapter.flush();

        expect(fs.existsSync(tempFile)).toBe(true);

        const content = fs.readFileSync(tempFile, 'utf-8');
        expect(content).toContain('testService');
        expect(content).toContain('testMethod');
      });

      it('should append multiple events to file', async () => {
        adapter = new FileAuditAdapter(tempFile);

        await adapter.save({
          timestamp: new Date(),
          service: 'service1',
          method: 'method1',
          success: true,
        });

        await adapter.save({
          timestamp: new Date(),
          service: 'service2',
          method: 'method2',
          success: false,
        });

        await adapter.flush();

        const content = fs.readFileSync(tempFile, 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(2);

        const event1 = JSON.parse(lines[0]);
        const event2 = JSON.parse(lines[1]);
        expect(event1.service).toBe('service1');
        expect(event2.service).toBe('service2');
      });

      it('should not create file when no events saved', async () => {
        adapter = new FileAuditAdapter(tempFile);
        await adapter.flush();

        expect(fs.existsSync(tempFile)).toBe(false);
      });
    });

    describe('auto-flush behavior', () => {
      it('should auto-flush when queue reaches 100 events', async () => {
        adapter = new FileAuditAdapter(tempFile);

        // Add 105 events to trigger auto-flush at 100
        for (let i = 0; i < 105; i++) {
          await adapter.save({
            timestamp: new Date(),
            service: 'testService',
            method: `method${i}`,
            success: true,
          });
        }

        // File should exist after auto-flush triggered at 100
        expect(fs.existsSync(tempFile)).toBe(true);

        // Flush remaining to get complete picture
        await adapter.flush();

        const content = fs.readFileSync(tempFile, 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(100);
      });

      it('should support auto-flush interval', async () => {
        adapter = new FileAuditAdapter(tempFile, { flushInterval: 100 });

        await adapter.save({
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        // Wait for auto-flush interval
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(fs.existsSync(tempFile)).toBe(true);
        const content = fs.readFileSync(tempFile, 'utf-8');
        expect(content).toContain('testService');
      });
    });

    describe('query from file', () => {
      beforeEach(async () => {
        adapter = new FileAuditAdapter(tempFile);

        const baseTime = new Date('2025-01-15T10:00:00Z');

        await adapter.save({
          timestamp: new Date(baseTime.getTime()),
          userId: 'user1',
          service: 'serviceA',
          method: 'methodX',
          success: true,
        });

        await adapter.save({
          timestamp: new Date(baseTime.getTime() + 60000),
          userId: 'user2',
          service: 'serviceB',
          method: 'methodY',
          success: false,
        });

        await adapter.save({
          timestamp: new Date(baseTime.getTime() + 120000),
          userId: 'user1',
          service: 'serviceA',
          method: 'methodZ',
          success: true,
        });

        await adapter.flush();
      });

      it('should query events from file', async () => {
        const events = await adapter.query({});
        expect(events).toHaveLength(3);
      });

      it('should filter by userId', async () => {
        const events = await adapter.query({ userId: 'user1' });
        expect(events).toHaveLength(2);
      });

      it('should filter by service', async () => {
        const events = await adapter.query({ service: 'serviceA' });
        expect(events).toHaveLength(2);
      });

      it('should filter by success status', async () => {
        const events = await adapter.query({ success: false });
        expect(events).toHaveLength(1);
        expect(events[0].userId).toBe('user2');
      });

      it('should apply pagination', async () => {
        const events = await adapter.query({ offset: 1, limit: 1 });
        expect(events).toHaveLength(1);
        expect(events[0].userId).toBe('user2');
      });

      it('should restore Date objects from JSON', async () => {
        const events = await adapter.query({});
        expect(events[0].timestamp).toBeInstanceOf(Date);
      });

      it('should return empty array when file does not exist', async () => {
        const newAdapter = new FileAuditAdapter(path.join(tempDir, 'nonexistent.log'));
        const events = await newAdapter.query({});
        expect(events).toHaveLength(0);
        newAdapter.destroy();
      });
    });

    describe('clear operation', () => {
      it('should clear file and pending writes', async () => {
        adapter = new FileAuditAdapter(tempFile);

        await adapter.save({
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        await adapter.flush();
        expect(fs.existsSync(tempFile)).toBe(true);

        await adapter.clear();
        expect(fs.existsSync(tempFile)).toBe(false);

        const events = await adapter.query({});
        expect(events).toHaveLength(0);
      });

      it('should clear pending writes before they are flushed', async () => {
        adapter = new FileAuditAdapter(tempFile);

        await adapter.save({
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        // Clear before flush
        await adapter.clear();

        // Now flush - should not create file since queue was cleared
        await adapter.flush();

        expect(fs.existsSync(tempFile)).toBe(false);
      });
    });

    describe('destroy operation', () => {
      it('should clear interval and flush pending writes on destroy', async () => {
        adapter = new FileAuditAdapter(tempFile, { flushInterval: 100 });

        await adapter.save({
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        adapter.destroy();

        // Wait a bit for async flush in destroy
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(fs.existsSync(tempFile)).toBe(true);
      });

      it('should handle destroy on empty adapter', () => {
        adapter = new FileAuditAdapter(tempFile);
        expect(() => adapter.destroy()).not.toThrow();
      });
    });

    describe('directory creation', () => {
      it('should create parent directories if they do not exist', async () => {
        const nestedPath = path.join(tempDir, 'level1', 'level2', 'audit.log');
        adapter = new FileAuditAdapter(nestedPath);

        await adapter.save({
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        await adapter.flush();

        expect(fs.existsSync(nestedPath)).toBe(true);
      });
    });
  });

  describe('AuditLogger', () => {
    let auditLogger: AuditLogger;

    describe('logAuth', () => {
      it('should log events with default configuration', async () => {
        auditLogger = new AuditLogger(logger);

        await auditLogger.logAuth({
          timestamp: new Date(),
          userId: 'user1',
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        // Small delay for async operation
        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events).toHaveLength(1);
        expect(events[0].userId).toBe('user1');
      });

      it('should include args when includeArgs is true', async () => {
        auditLogger = new AuditLogger(logger, { includeArgs: true });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'calculator',
          method: 'add',
          args: [10, 20],
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].args).toEqual([10, 20]);
      });

      it('should exclude args when includeArgs is false', async () => {
        auditLogger = new AuditLogger(logger, { includeArgs: false });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'calculator',
          method: 'add',
          args: [10, 20],
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].args).toBeUndefined();
      });

      it('should include result when includeResult is true', async () => {
        auditLogger = new AuditLogger(logger, { includeResult: true });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'calculator',
          method: 'add',
          result: { sum: 30 },
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].result).toEqual({ sum: 30 });
      });

      it('should exclude result when includeResult is false', async () => {
        auditLogger = new AuditLogger(logger, { includeResult: false });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'calculator',
          method: 'add',
          result: { sum: 30 },
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].result).toBeUndefined();
      });

      it('should include userId when includeUser is true', async () => {
        auditLogger = new AuditLogger(logger, { includeUser: true });

        await auditLogger.logAuth({
          timestamp: new Date(),
          userId: 'user123',
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].userId).toBe('user123');
      });

      it('should exclude userId when includeUser is false', async () => {
        auditLogger = new AuditLogger(logger, { includeUser: false });

        await auditLogger.logAuth({
          timestamp: new Date(),
          userId: 'user123',
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].userId).toBeUndefined();
      });

      it('should log auth decisions', async () => {
        auditLogger = new AuditLogger(logger);

        const decision: PolicyDecision = {
          allowed: true,
          reason: 'User has admin role',
          metadata: { policy: 'admin-access' },
        };

        await auditLogger.logAuth({
          timestamp: new Date(),
          userId: 'admin1',
          service: 'adminService',
          method: 'deleteUser',
          authDecision: decision,
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].authDecision).toBeDefined();
        expect(events[0].authDecision?.allowed).toBe(true);
        expect(events[0].authDecision?.reason).toBe('User has admin role');
      });

      it('should set success=false from authDecision.allowed', async () => {
        auditLogger = new AuditLogger(logger);

        await auditLogger.logAuth({
          timestamp: new Date(),
          userId: 'user1',
          service: 'adminService',
          method: 'deleteUser',
          authDecision: { allowed: false, reason: 'Insufficient permissions' },
          success: true, // Will be overridden by authDecision.allowed
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].success).toBe(false);
      });

      it('should set success=false when error present', async () => {
        auditLogger = new AuditLogger(logger);

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          error: 'Something went wrong',
          success: true, // Will be overridden
        } as AuditEvent);

        await new Promise((resolve) => setTimeout(resolve, 10));

        const events = await auditLogger.query();
        expect(events[0].success).toBe(false);
        expect((events[0] as EnhancedAuditEvent).error).toBe('Something went wrong');
      });
    });

    describe('query', () => {
      beforeEach(async () => {
        auditLogger = new AuditLogger(logger, { includeUser: true, async: false });

        await auditLogger.logAuth({
          timestamp: new Date('2025-01-15T10:00:00Z'),
          userId: 'user1',
          service: 'serviceA',
          method: 'methodX',
          success: true,
        });

        await auditLogger.logAuth({
          timestamp: new Date('2025-01-15T11:00:00Z'),
          userId: 'user2',
          service: 'serviceB',
          method: 'methodY',
          success: false,
        });

        await auditLogger.logAuth({
          timestamp: new Date('2025-01-15T12:00:00Z'),
          userId: 'user1',
          service: 'serviceA',
          method: 'methodZ',
          success: true,
        });
      });

      it('should query all events with empty filter', async () => {
        const events = await auditLogger.query({});
        expect(events).toHaveLength(3);
      });

      it('should filter by userId', async () => {
        const events = await auditLogger.query({ userId: 'user1' });
        expect(events).toHaveLength(2);
      });

      it('should filter by service', async () => {
        const events = await auditLogger.query({ service: 'serviceB' });
        expect(events).toHaveLength(1);
      });

      it('should filter by time range', async () => {
        const events = await auditLogger.query({
          startTime: new Date('2025-01-15T10:30:00Z'),
          endTime: new Date('2025-01-15T11:30:00Z'),
        });
        expect(events).toHaveLength(1);
        expect(events[0].userId).toBe('user2');
      });

      it('should handle query errors gracefully', async () => {
        // Create logger with faulty storage
        const faultyLogger = new AuditLogger(logger, {
          storage: {
            save: async () => {},
            query: async () => {
              throw new Error('Query failed');
            },
            clear: async () => {},
          },
        });

        const events = await faultyLogger.query({});
        expect(events).toEqual([]);
      });
    });

    describe('clearLogs', () => {
      it('should clear all logs', async () => {
        auditLogger = new AuditLogger(logger, { async: false });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'testService',
          method: 'testMethod',
          success: true,
        });

        expect(await auditLogger.query()).toHaveLength(1);

        await auditLogger.clearLogs();

        expect(await auditLogger.query()).toHaveLength(0);
      });
    });

    describe('configure', () => {
      it('should update configuration dynamically', async () => {
        auditLogger = new AuditLogger(logger, { includeArgs: false, async: false });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'testService',
          method: 'method1',
          args: [1, 2],
          success: true,
        });

        // Update config
        auditLogger.configure({ includeArgs: true });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'testService',
          method: 'method2',
          args: [3, 4],
          success: true,
        });

        const events = await auditLogger.query();
        expect(events[0].args).toBeUndefined();
        expect(events[1].args).toEqual([3, 4]);
      });

      it('should update storage adapter', async () => {
        const adapter1 = new MemoryAuditAdapter(100);
        const adapter2 = new MemoryAuditAdapter(100);

        auditLogger = new AuditLogger(logger, { storage: adapter1, async: false });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'testService',
          method: 'method1',
          success: true,
        });

        expect(adapter1.size()).toBe(1);
        expect(adapter2.size()).toBe(0);

        auditLogger.configure({ storage: adapter2 });

        await auditLogger.logAuth({
          timestamp: new Date(),
          service: 'testService',
          method: 'method2',
          success: true,
        });

        expect(adapter1.size()).toBe(1);
        expect(adapter2.size()).toBe(1);
      });
    });

    describe('getConfig', () => {
      it('should return current configuration', () => {
        auditLogger = new AuditLogger(logger, {
          includeArgs: true,
          includeResult: true,
          includeUser: false,
          maxEventSize: 5000,
          async: false,
        });

        const config = auditLogger.getConfig();

        expect(config.includeArgs).toBe(true);
        expect(config.includeResult).toBe(true);
        expect(config.includeUser).toBe(false);
        expect(config.maxEventSize).toBe(5000);
        expect(config.async).toBe(false);
      });

      it('should return defaults when not configured', () => {
        auditLogger = new AuditLogger(logger);

        const config = auditLogger.getConfig();

        expect(config.includeArgs).toBe(false);
        expect(config.includeResult).toBe(false);
        expect(config.includeUser).toBe(true);
        expect(config.maxEventSize).toBe(10240); // 10KB
        expect(config.async).toBe(true);
      });
    });
  });

  describe('Data Sanitization', () => {
    let auditLogger: AuditLogger;

    beforeEach(() => {
      auditLogger = new AuditLogger(logger, {
        includeArgs: true,
        includeResult: true,
        async: false,
      });
    });

    it('should redact password fields', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'authService',
        method: 'login',
        args: [{ username: 'john', password: 'supersecret123' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].username).toBe('john');
      expect(events[0].args![0].password).toBe('[REDACTED]');
    });

    it('should redact token fields', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'apiService',
        method: 'call',
        args: [{ token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', data: 'test' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].token).toBe('[REDACTED]');
      expect(events[0].args![0].data).toBe('test');
    });

    it('should redact secret fields', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'configService',
        method: 'setSecret',
        args: [{ secret: 'my-api-secret', name: 'aws_key' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].secret).toBe('[REDACTED]');
      expect(events[0].args![0].name).toBe('aws_key');
    });

    it('should redact key fields', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'configService',
        method: 'setApiKey',
        args: [{ apiKey: 'sk_live_abc123', environment: 'production' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].apiKey).toBe('[REDACTED]');
      expect(events[0].args![0].environment).toBe('production');
    });

    it('should redact pwd fields (exact match only)', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'authService',
        method: 'changePassword',
        args: [{ pwd: 'secret123', userId: 'user1' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].pwd).toBe('[REDACTED]');
      expect(events[0].args![0].userId).toBe('user1');
    });

    it('should NOT redact fields that only contain "pwd" as substring', async () => {
      // Note: The implementation only redacts exact "pwd" match, not substrings like "oldPwd"
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'authService',
        method: 'changePassword',
        args: [{ oldPwd: 'old123', newPwd: 'new456', userId: 'user1' }],
        success: true,
      });

      const events = await auditLogger.query();
      // These are NOT redacted because they don't match exactly "pwd"
      expect(events[0].args![0].oldPwd).toBe('old123');
      expect(events[0].args![0].newPwd).toBe('new456');
      expect(events[0].args![0].userId).toBe('user1');
    });

    it('should redact nested sensitive fields', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'configService',
        method: 'updateConfig',
        args: [
          {
            database: {
              host: 'localhost',
              password: 'dbpass123',
              credentials: {
                secretKey: 'nested-secret',
              },
            },
            name: 'myapp',
          },
        ],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].database.host).toBe('localhost');
      expect(events[0].args![0].database.password).toBe('[REDACTED]');
      expect(events[0].args![0].database.credentials.secretKey).toBe('[REDACTED]');
      expect(events[0].args![0].name).toBe('myapp');
    });

    it('should redact fields in arrays', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'batchService',
        method: 'createUsers',
        args: [
          [
            { username: 'user1', password: 'pass1' },
            { username: 'user2', password: 'pass2' },
          ],
        ],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0][0].username).toBe('user1');
      expect(events[0].args![0][0].password).toBe('[REDACTED]');
      expect(events[0].args![0][1].username).toBe('user2');
      expect(events[0].args![0][1].password).toBe('[REDACTED]');
    });

    it('should sanitize result data', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'authService',
        method: 'authenticate',
        result: { userId: 'user1', accessToken: 'jwt-token-123', refreshToken: 'refresh-123' },
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].result.userId).toBe('user1');
      expect(events[0].result.accessToken).toBe('[REDACTED]');
      expect(events[0].result.refreshToken).toBe('[REDACTED]');
    });

    it('should handle null and undefined values', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        args: [{ value: null, other: undefined, name: 'test' }],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args![0].value).toBeNull();
      expect(events[0].args![0].other).toBeUndefined();
      expect(events[0].args![0].name).toBe('test');
    });

    it('should handle primitive values', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        args: ['string', 123, true],
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args).toEqual(['string', 123, true]);
    });
  });

  describe('Event Size Limiting and Truncation', () => {
    let auditLogger: AuditLogger;

    it('should truncate events exceeding maxEventSize', async () => {
      auditLogger = new AuditLogger(logger, {
        includeArgs: true,
        includeResult: true,
        maxEventSize: 500, // Small limit for testing
        async: false,
      });

      const largeData = 'x'.repeat(1000);

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        args: [largeData],
        result: largeData,
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args).toEqual(['[TRUNCATED]']);
      expect(events[0].result).toBe('[TRUNCATED]');
      expect(events[0].metadata?.truncated).toBe(true);
      expect(events[0].metadata?.originalSize).toBeGreaterThan(500);
    });

    it('should log warning when truncating', async () => {
      auditLogger = new AuditLogger(logger, {
        includeArgs: true,
        maxEventSize: 200,
        async: false,
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        args: ['x'.repeat(500)],
        success: true,
      });

      // Check that warn was called
      expect(logger.calls.warn.length).toBeGreaterThan(0);
      const warnCall = logger.calls.warn.find((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('truncating'))
      );
      expect(warnCall).toBeDefined();
    });

    it('should not truncate events within size limit', async () => {
      auditLogger = new AuditLogger(logger, {
        includeArgs: true,
        includeResult: true,
        maxEventSize: 10000,
        async: false,
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        args: ['small data'],
        result: 'small result',
        success: true,
      });

      const events = await auditLogger.query();
      expect(events[0].args).toEqual(['small data']);
      expect(events[0].result).toBe('small result');
      expect(events[0].metadata?.truncated).toBeUndefined();
    });
  });

  describe('Async vs Sync Modes', () => {
    it('should operate in async mode (non-blocking)', async () => {
      const slowAdapter: MemoryAuditAdapter & { saveDelay: number } = new MemoryAuditAdapter(100) as any;
      slowAdapter.saveDelay = 100;
      const originalSave = slowAdapter.save.bind(slowAdapter);
      slowAdapter.save = async (event: AuditEvent) => {
        await new Promise((resolve) => setTimeout(resolve, slowAdapter.saveDelay));
        return originalSave(event);
      };

      const auditLogger = new AuditLogger(logger, {
        storage: slowAdapter,
        async: true, // Non-blocking
      });

      const start = Date.now();

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        success: true,
      });

      const elapsed = Date.now() - start;

      // Should return quickly in async mode (not wait for slow save)
      expect(elapsed).toBeLessThan(50);

      // Wait for save to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      const events = await auditLogger.query();
      expect(events).toHaveLength(1);
    });

    it('should operate in sync mode (blocking)', async () => {
      const slowAdapter: MemoryAuditAdapter & { saveDelay: number } = new MemoryAuditAdapter(100) as any;
      slowAdapter.saveDelay = 50;
      const originalSave = slowAdapter.save.bind(slowAdapter);
      slowAdapter.save = async (event: AuditEvent) => {
        await new Promise((resolve) => setTimeout(resolve, slowAdapter.saveDelay));
        return originalSave(event);
      };

      const auditLogger = new AuditLogger(logger, {
        storage: slowAdapter,
        async: false, // Blocking
      });

      const start = Date.now();

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        success: true,
      });

      const elapsed = Date.now() - start;

      // Should wait for save in sync mode
      expect(elapsed).toBeGreaterThanOrEqual(50);

      const events = await auditLogger.query();
      expect(events).toHaveLength(1);
    });

    it('should handle async save errors gracefully', async () => {
      const errorAdapter = new MemoryAuditAdapter(100);
      let shouldFail = true;
      const originalSave = errorAdapter.save.bind(errorAdapter);
      errorAdapter.save = async (event: AuditEvent) => {
        if (shouldFail) {
          throw new Error('Save failed');
        }
        return originalSave(event);
      };

      const auditLogger = new AuditLogger(logger, {
        storage: errorAdapter,
        async: true,
      });

      // Should not throw even though save will fail
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        success: true,
      });

      // Wait for async error handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Error should be logged
      expect(logger.calls.error.length).toBeGreaterThan(0);
    });
  });

  describe('Custom Logger Callback', () => {
    it('should call custom logger function for each event', async () => {
      const customLoggerCalls: AuditEvent[] = [];
      const customLogger = (event: AuditEvent) => {
        customLoggerCalls.push(event);
      };

      const auditLogger = new AuditLogger(logger, {
        logger: customLogger,
        async: false,
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        success: true,
      });

      expect(customLoggerCalls).toHaveLength(1);
      expect(customLoggerCalls[0].service).toBe('testService');
    });

    it('should continue storing events even if custom logger fails', async () => {
      const customLogger = () => {
        throw new Error('Custom logger error');
      };

      const auditLogger = new AuditLogger(logger, {
        logger: customLogger,
        async: false,
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'testMethod',
        success: true,
      });

      // Event should still be stored
      const events = await auditLogger.query();
      expect(events).toHaveLength(1);

      // Error should be logged
      expect(logger.calls.error.length).toBeGreaterThan(0);
    });

    it('should support setting custom logger via configure', async () => {
      const customLoggerCalls: AuditEvent[] = [];

      const auditLogger = new AuditLogger(logger, { async: false });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'method1',
        success: true,
      });

      // No custom logger yet
      expect(customLoggerCalls).toHaveLength(0);

      // Configure custom logger
      auditLogger.configure({
        logger: (event) => customLoggerCalls.push(event),
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'method2',
        success: true,
      });

      expect(customLoggerCalls).toHaveLength(1);
      expect(customLoggerCalls[0].method).toBe('method2');
    });

    it('should support removing custom logger via configure', async () => {
      const customLoggerCalls: AuditEvent[] = [];

      const auditLogger = new AuditLogger(logger, {
        logger: (event) => customLoggerCalls.push(event),
        async: false,
      });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'method1',
        success: true,
      });

      expect(customLoggerCalls).toHaveLength(1);

      // Remove custom logger
      auditLogger.configure({ logger: null });

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'method2',
        success: true,
      });

      // Should not have increased
      expect(customLoggerCalls).toHaveLength(1);
    });
  });

  describe('Pagination (offset, limit)', () => {
    let auditLogger: AuditLogger;

    beforeEach(async () => {
      auditLogger = new AuditLogger(logger, { async: false });

      for (let i = 0; i < 20; i++) {
        await auditLogger.logAuth({
          timestamp: new Date(2025, 0, 1, 10, 0, i),
          service: 'testService',
          method: `method${i}`,
          success: true,
        });
      }
    });

    it('should support limit', async () => {
      const events = await auditLogger.query({ limit: 5 });
      expect(events).toHaveLength(5);
    });

    it('should support offset', async () => {
      const events = await auditLogger.query({ offset: 10 });
      expect(events).toHaveLength(10);
      expect(events[0].method).toBe('method10');
    });

    it('should support combined offset and limit', async () => {
      const events = await auditLogger.query({ offset: 5, limit: 5 });
      expect(events).toHaveLength(5);
      expect(events[0].method).toBe('method5');
      expect(events[4].method).toBe('method9');
    });

    it('should implement proper pagination for large datasets', async () => {
      // Page 1
      const page1 = await auditLogger.query({ offset: 0, limit: 10 });
      expect(page1).toHaveLength(10);
      expect(page1[0].method).toBe('method0');

      // Page 2
      const page2 = await auditLogger.query({ offset: 10, limit: 10 });
      expect(page2).toHaveLength(10);
      expect(page2[0].method).toBe('method10');

      // No overlap between pages
      const page1Methods = page1.map((e) => e.method);
      const page2Methods = page2.map((e) => e.method);
      expect(page1Methods.filter((m) => page2Methods.includes(m))).toHaveLength(0);
    });
  });

  describe('Integration with FileAuditAdapter', () => {
    let auditLogger: AuditLogger;
    let fileAdapter: FileAuditAdapter;
    let tempFile: string;

    beforeEach(() => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-integration-'));
      tempFile = path.join(tempDir, 'audit.log');
      fileAdapter = new FileAuditAdapter(tempFile);
      auditLogger = new AuditLogger(logger, {
        storage: fileAdapter,
        includeArgs: true,
        includeResult: true,
        includeUser: true,
        async: false,
      });
    });

    afterEach(async () => {
      fileAdapter.destroy();
      const dir = path.dirname(tempFile);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should persist events to file and query them', async () => {
      await auditLogger.logAuth({
        timestamp: new Date('2025-01-15T10:00:00Z'),
        userId: 'user1',
        service: 'authService',
        method: 'login',
        args: [{ username: 'john', password: 'secret' }],
        result: { token: 'jwt-token' },
        success: true,
      });

      await auditLogger.logAuth({
        timestamp: new Date('2025-01-15T11:00:00Z'),
        userId: 'user2',
        service: 'dataService',
        method: 'getData',
        success: true,
      });

      // Query all
      const allEvents = await auditLogger.query({});
      expect(allEvents).toHaveLength(2);

      // Query by user
      const user1Events = await auditLogger.query({ userId: 'user1' });
      expect(user1Events).toHaveLength(1);
      expect(user1Events[0].service).toBe('authService');

      // Verify sanitization persists
      expect(user1Events[0].args![0].password).toBe('[REDACTED]');
      expect(user1Events[0].result.token).toBe('[REDACTED]');
    });

    it('should handle clear and re-add operations', async () => {
      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'method1',
        success: true,
      });

      expect(await auditLogger.query()).toHaveLength(1);

      await auditLogger.clearLogs();

      expect(await auditLogger.query()).toHaveLength(0);

      await auditLogger.logAuth({
        timestamp: new Date(),
        service: 'testService',
        method: 'method2',
        success: true,
      });

      const events = await auditLogger.query();
      expect(events).toHaveLength(1);
      expect(events[0].method).toBe('method2');
    });
  });
});
