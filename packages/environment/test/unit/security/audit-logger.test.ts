import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger } from '../../../src/security/audit-logger.js';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger({ maxEvents: 100 });
  });

  it('should log events', () => {
    const event = logger.logSuccess('user1', 'read', 'config');
    expect(event.userId).toBe('user1');
    expect(event.result).toBe('success');
  });

  it('should log failure', () => {
    const event = logger.logFailure('user1', 'write', 'config', 'Permission denied');
    expect(event.result).toBe('failure');
    expect(event.reason).toBe('Permission denied');
  });

  it('should query events', () => {
    logger.logSuccess('user1', 'read', 'config');
    logger.logSuccess('user2', 'write', 'secret');
    const results = logger.query({ userId: 'user1' });
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe('user1');
  });

  it('should get statistics', () => {
    logger.logSuccess('user1', 'read', 'config');
    logger.logFailure('user1', 'write', 'config', 'Error');
    const stats = logger.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byResult.success).toBe(1);
    expect(stats.byResult.failure).toBe(1);
  });

  it('should respect max events limit', () => {
    const smallLogger = new AuditLogger({ maxEvents: 5 });
    for (let i = 0; i < 10; i++) {
      smallLogger.logSuccess(`user${i}`, 'read', 'config');
    }
    expect(smallLogger.getEventCount()).toBe(5);
  });

  it('should enable/disable logging', () => {
    logger.setEnabled(false);
    logger.logSuccess('user1', 'read', 'config');
    expect(logger.getEventCount()).toBe(0);
  });
});
