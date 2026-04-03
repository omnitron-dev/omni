import { describe, it, expect, vi } from 'vitest';
import { MetricsService } from '../../src/monitoring/metrics.service.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { IProcessMetrics } from '@omnitron-dev/titan-pm';

function createMockOrchestrator(metricsData: Record<string, IProcessMetrics | null> = {}): OrchestratorService {
  return {
    getMetrics: vi.fn().mockResolvedValue(metricsData),
  } as unknown as OrchestratorService;
}

describe('MetricsService', () => {
  it('aggregates metrics from orchestrator', async () => {
    const orch = createMockOrchestrator({
      main: { cpu: 10, memory: 100_000, requests: 50, errors: 2 },
      storage: { cpu: 5, memory: 200_000, requests: 30, errors: 1 },
    });
    const service = new MetricsService(orch);
    const result = await service.getMetrics();

    expect(result.apps['main']).toEqual({
      cpu: 10,
      memory: 100_000,
      requests: 50,
      errors: 2,
    });
    expect(result.apps['storage']).toEqual({
      cpu: 5,
      memory: 200_000,
      requests: 30,
      errors: 1,
    });
    expect(result.totals.cpu).toBe(15);
    expect(result.totals.memory).toBe(300_000);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('handles null metrics gracefully', async () => {
    const orch = createMockOrchestrator({
      main: null,
    });
    const service = new MetricsService(orch);
    const result = await service.getMetrics();

    expect(result.apps['main']).toEqual({ cpu: 0, memory: 0 });
    expect(result.totals.cpu).toBe(0);
    expect(result.totals.memory).toBe(0);
  });

  it('passes appName filter to orchestrator', async () => {
    const orch = createMockOrchestrator({
      main: { cpu: 10, memory: 100_000 },
    });
    const service = new MetricsService(orch);
    await service.getMetrics('main');

    expect(orch.getMetrics).toHaveBeenCalledWith('main');
  });

  it('includes latency when available', async () => {
    const latency = { p50: 5, p95: 20, p99: 50, mean: 10 };
    const orch = createMockOrchestrator({
      main: { cpu: 1, memory: 1000, requests: 10, errors: 0, latency },
    });
    const service = new MetricsService(orch);
    const result = await service.getMetrics();

    expect(result.apps['main']!.latency).toEqual(latency);
  });

  it('handles empty metrics map', async () => {
    const orch = createMockOrchestrator({});
    const service = new MetricsService(orch);
    const result = await service.getMetrics();

    expect(Object.keys(result.apps)).toHaveLength(0);
    expect(result.totals).toEqual({ cpu: 0, memory: 0 });
  });
});
