import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defaultLogger } from '../../../src/rotif/utils/logger.js';

describe('Rotif - Logger', () => {
  let consoleSpy: {
    debug: any;
    info: any;
    warn: any;
    error: any;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  describe('defaultLogger', () => {
    it('should have all required methods', () => {
      expect(defaultLogger.debug).toBeDefined();
      expect(defaultLogger.info).toBeDefined();
      expect(defaultLogger.warn).toBeDefined();
      expect(defaultLogger.error).toBeDefined();
    });

    it('should log debug messages with prefix', () => {
      defaultLogger.debug('test message');

      expect(consoleSpy.debug).toHaveBeenCalledWith('[rotif] DEBUG: test message', '');
    });

    it('should log info messages with prefix', () => {
      defaultLogger.info('test info');

      expect(consoleSpy.info).toHaveBeenCalledWith('[rotif] INFO: test info', '');
    });

    it('should log warn messages with prefix', () => {
      defaultLogger.warn('test warning');

      expect(consoleSpy.warn).toHaveBeenCalledWith('[rotif] WARN: test warning', '');
    });

    it('should log error messages with prefix', () => {
      defaultLogger.error('test error');

      expect(consoleSpy.error).toHaveBeenCalledWith('[rotif] ERROR: test error', '');
    });

    it('should include metadata when provided', () => {
      const meta = { userId: 123, action: 'test' };

      defaultLogger.debug('message', meta);

      expect(consoleSpy.debug).toHaveBeenCalledWith('[rotif] DEBUG: message', meta);
    });

    it('should handle undefined metadata', () => {
      defaultLogger.info('message', undefined);

      expect(consoleSpy.info).toHaveBeenCalledWith('[rotif] INFO: message', '');
    });

    it('should handle null metadata', () => {
      defaultLogger.warn('message', null);

      expect(consoleSpy.warn).toHaveBeenCalledWith('[rotif] WARN: message', '');
    });

    it('should handle object metadata', () => {
      const meta = {
        error: new Error('test'),
        stack: 'stack trace',
        details: { code: 500 },
      };

      defaultLogger.error('error occurred', meta);

      expect(consoleSpy.error).toHaveBeenCalledWith('[rotif] ERROR: error occurred', meta);
    });

    it('should handle string metadata', () => {
      defaultLogger.info('message', 'extra info');

      expect(consoleSpy.info).toHaveBeenCalledWith('[rotif] INFO: message', 'extra info');
    });

    it('should handle number metadata', () => {
      defaultLogger.debug('count', 42);

      expect(consoleSpy.debug).toHaveBeenCalledWith('[rotif] DEBUG: count', 42);
    });
  });
});
