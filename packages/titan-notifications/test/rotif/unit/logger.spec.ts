import { describe, it, expect, vi } from 'vitest';
import { createNullLogger } from '../../../src/modules/logger/logger.types.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';

describe('Rotif - Logger', () => {
  const mockLogger: ILogger = {
    child: vi.fn(() => mockLogger),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    time: vi.fn(() => vi.fn()),
    isLevelEnabled: vi.fn(() => true),
    setLevel: vi.fn(),
    getLevel: vi.fn(() => 'info' as any),
  };

  describe('createNullLogger', () => {
    it('should create a logger with all required methods', () => {
      const logger = createNullLogger();

      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.trace).toBeDefined();
      expect(logger.fatal).toBeDefined();
      expect(logger.child).toBeDefined();
      expect(logger.time).toBeDefined();
      expect(logger.isLevelEnabled).toBeDefined();
    });

    it('should not throw when calling log methods', () => {
      const logger = createNullLogger();

      expect(() => logger.debug('test message')).not.toThrow();
      expect(() => logger.info('test info')).not.toThrow();
      expect(() => logger.warn('test warning')).not.toThrow();
      expect(() => logger.error('test error')).not.toThrow();
    });

    it('should handle metadata in log calls', () => {
      const logger = createNullLogger();
      const meta = { userId: 123, action: 'test' };

      expect(() => logger.debug(meta, 'message')).not.toThrow();
      expect(() => logger.info(meta, 'message')).not.toThrow();
    });

    it('should return a null logger from child', () => {
      const logger = createNullLogger();
      const childLogger = logger.child({ service: 'test' });

      expect(childLogger).toBeDefined();
      expect(childLogger.debug).toBeDefined();
    });

    it('should return false from isLevelEnabled', () => {
      const logger = createNullLogger();

      expect(logger.isLevelEnabled('debug')).toBe(false);
      expect(logger.isLevelEnabled('info')).toBe(false);
    });

    it('should return a noop function from time', () => {
      const logger = createNullLogger();
      const stopTimer = logger.time('test');

      expect(stopTimer).toBeDefined();
      expect(typeof stopTimer).toBe('function');
      expect(() => stopTimer()).not.toThrow();
    });
  });

  describe('mock logger', () => {
    it('should track calls to debug', () => {
      mockLogger.debug('test message');

      expect(mockLogger.debug).toHaveBeenCalledWith('test message');
    });

    it('should track calls to info', () => {
      mockLogger.info('test info');

      expect(mockLogger.info).toHaveBeenCalledWith('test info');
    });

    it('should track calls with metadata', () => {
      const meta = { userId: 123 };
      mockLogger.error(meta, 'error occurred');

      expect(mockLogger.error).toHaveBeenCalledWith(meta, 'error occurred');
    });
  });
});
