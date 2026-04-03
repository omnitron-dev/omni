import { describe, it, expect, vi } from 'vitest';
import { HealthService } from '../../src/monitoring/health.service.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { IHealthStatus } from '@omnitron-dev/titan-pm';

function createMockOrchestrator(healthData: Record<string, IHealthStatus | null> = {}): OrchestratorService {
  return {
    getHealth: vi.fn().mockResolvedValue(healthData),
  } as unknown as OrchestratorService;
}

describe('HealthService', () => {
  it('aggregates health from orchestrator — all healthy', async () => {
    const orch = createMockOrchestrator({
      main: {
        status: 'healthy',
        checks: [{ name: 'http', status: 'pass' }],
        timestamp: Date.now(),
      },
      storage: {
        status: 'healthy',
        checks: [{ name: 'http', status: 'pass' }],
        timestamp: Date.now(),
      },
    });
    const service = new HealthService(orch);
    const result = await service.getHealth();

    expect(result.overall).toBe('healthy');
    expect(result.apps['main']!.status).toBe('healthy');
    expect(result.apps['storage']!.status).toBe('healthy');
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('reports degraded when any app is degraded', async () => {
    const orch = createMockOrchestrator({
      main: {
        status: 'healthy',
        checks: [{ name: 'http', status: 'pass' }],
        timestamp: Date.now(),
      },
      storage: {
        status: 'degraded',
        checks: [{ name: 'disk', status: 'warn', message: 'Low disk space' }],
        timestamp: Date.now(),
      },
    });
    const service = new HealthService(orch);
    const result = await service.getHealth();

    expect(result.overall).toBe('degraded');
    expect(result.apps['storage']!.checks[0]!.message).toBe('Low disk space');
  });

  it('reports unhealthy when any app is unhealthy', async () => {
    const orch = createMockOrchestrator({
      main: {
        status: 'unhealthy',
        checks: [{ name: 'http', status: 'fail', message: 'Connection refused' }],
        timestamp: Date.now(),
      },
      storage: {
        status: 'degraded',
        checks: [{ name: 'disk', status: 'warn' }],
        timestamp: Date.now(),
      },
    });
    const service = new HealthService(orch);
    const result = await service.getHealth();

    expect(result.overall).toBe('unhealthy');
  });

  it('reports unhealthy for null health data', async () => {
    const orch = createMockOrchestrator({
      main: null,
    });
    const service = new HealthService(orch);
    const result = await service.getHealth();

    expect(result.overall).toBe('unhealthy');
    expect(result.apps['main']!.status).toBe('unhealthy');
    expect(result.apps['main']!.checks[0]!.status).toBe('fail');
    expect(result.apps['main']!.checks[0]!.message).toContain('No health data');
  });

  it('passes appName filter to orchestrator', async () => {
    const orch = createMockOrchestrator({});
    const service = new HealthService(orch);
    await service.getHealth('storage');

    expect(orch.getHealth).toHaveBeenCalledWith('storage');
  });

  it('handles empty health map', async () => {
    const orch = createMockOrchestrator({});
    const service = new HealthService(orch);
    const result = await service.getHealth();

    expect(result.overall).toBe('healthy');
    expect(Object.keys(result.apps)).toHaveLength(0);
  });

  it('unhealthy takes priority over degraded', async () => {
    const orch = createMockOrchestrator({
      a: { status: 'degraded', checks: [], timestamp: Date.now() },
      b: { status: 'unhealthy', checks: [], timestamp: Date.now() },
      c: { status: 'healthy', checks: [], timestamp: Date.now() },
    });
    const service = new HealthService(orch);
    const result = await service.getHealth();

    expect(result.overall).toBe('unhealthy');
  });
});
