import { describe, it, expect, beforeEach } from 'vitest';
import { HealthCheckManager } from '../../../src/monitoring/health-check.js';

describe('HealthCheckManager', () => {
  let manager: HealthCheckManager;

  beforeEach(() => {
    manager = new HealthCheckManager();
  });

  it('should register health check', () => {
    manager.registerCheck({
      name: 'test',
      check: async () => ({
        name: 'test',
        status: 'healthy',
        timestamp: Date.now(),
        duration: 0,
      }),
    });
    expect(manager).toBeDefined();
  });

  it('should run checks', async () => {
    manager.registerCheck({
      name: 'check1',
      check: async () => ({
        name: 'check1',
        status: 'healthy',
        timestamp: Date.now(),
        duration: 0,
      }),
    });

    const report = await manager.runChecks();
    expect(report.status).toBe('healthy');
    expect(report.checks).toHaveLength(1);
  });

  it('should detect unhealthy status', async () => {
    manager.registerCheck({
      name: 'failing',
      check: async () => ({
        name: 'failing',
        status: 'unhealthy',
        timestamp: Date.now(),
        duration: 0,
      }),
    });

    const report = await manager.runChecks();
    expect(report.status).toBe('degraded');
  });

  it('should handle timeout', async () => {
    manager.registerCheck({
      name: 'slow',
      timeout: 10,
      check: async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          name: 'slow',
          status: 'healthy',
          timestamp: Date.now(),
          duration: 0,
        };
      },
    });

    const report = await manager.runChecks();
    expect(report.checks[0].status).toBe('unhealthy');
  });

  it('should check if ready', async () => {
    manager.registerCheck({
      name: 'test',
      check: async () => ({
        name: 'test',
        status: 'healthy',
        timestamp: Date.now(),
        duration: 0,
      }),
    });

    const ready = await manager.isReady();
    expect(ready).toBe(true);
  });

  it('should be alive', () => {
    expect(manager.isAlive()).toBe(true);
  });

  it('should track uptime', () => {
    const uptime = manager.getUptime();
    expect(uptime).toBeGreaterThanOrEqual(0);
  });
});
