import { describe, it, expect, vi } from 'vitest';
import { metricsWindow, monitoringReading } from '../../src/mcp/monitoring-reading.js';
import { validateLogQuery } from '../../src/services/log-query.js';
import { createMonitoringTools } from '../../src/mcp/tool-groups/monitoring.tools.js';

describe('monitoring evidence and budgets', () => {
  it('preserves successful sources without treating an unavailable source as healthy', async () => {
    const result = await monitoringReading({
      metrics: async () => ({ timestamp: 123, value: 7 }),
      alerts: async () => {
        throw Error('store unavailable');
      },
    });
    expect(result.state).toBe('partial');
    expect(result.sources.metrics).toMatchObject({ status: 'available', value: { timestamp: 123 } });
    expect(result.sources.alerts).toMatchObject({ status: 'unavailable', error: 'store unavailable' });
  });
  it('marks oversized evidence limited instead of returning a misleading subset', async () => {
    const result = await monitoringReading({ series: async () => ['x'.repeat(1000)] }, 100);
    expect(result.state).toBe('partial');
    expect(result.sources.series).toMatchObject({ status: 'limited' });
    expect(result.sources.series).not.toHaveProperty('value');
  });
  it('returns available evidence when another source never answers', async () => {
    vi.useFakeTimers();
    try {
      const pending = monitoringReading(
        { metrics: async () => ({ value: 7 }), alerts: () => new Promise(() => {}) },
        1024,
        100
      );
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;
      expect(result).toMatchObject({
        state: 'partial',
        sources: {
          metrics: { status: 'available' },
          alerts: { status: 'unavailable', error: expect.stringContaining('deadline') },
        },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects unbounded, invalid and reversed metric windows', () => {
    for (const input of [
      {},
      { names: ['cpu'], apps: ['api'], limit: Infinity },
      { names: ['cpu'], apps: ['api'], from: '2026-01-01', to: '2026-02-01' },
      { names: ['cpu'], apps: ['api'], from: 'bad' },
    ])
      expect(() => metricsWindow(input)).toThrow();
  });
  it('rejects invalid log queries before issuing database work', () => {
    for (const filter of [
      { limit: -1 },
      { tail: Infinity },
      { offset: 100001 },
      { level: ['invented'] },
      { from: 'invalid' },
      { from: '2026-02-01', to: '2026-01-01' },
    ])
      expect(() => validateLogQuery(filter)).toThrow();
    expect(() => validateLogQuery({ app: 'project/prod/api', level: ['error', 'fatal'], tail: 100 })).not.toThrow();
  });
  it('does not query full log counts or acknowledge alerts when taking a snapshot', async () => {
    const queryLogs = vi.fn(),
      getLogStats = vi.fn(),
      acknowledgeAlert = vi.fn();
    const services = {
      OmnitronMetrics: { getSnapshot: async () => ({ timestamp: 0 }) },
      OmnitronLogs: {
        getIngestionStats: async () => ({ ingestedTotal: 7, droppedTotal: 2, bufferSize: 1 }),
        queryLogs,
        getLogStats,
      },
      OmnitronAlerts: { getSummary: async () => ({ firing: 1 }), acknowledgeAlert },
    };
    const tools = createMonitoringTools({ service: async (name: keyof typeof services) => services[name] } as never);
    const result = await tools.find((t) => t.name === 'monitoring.snapshot')!.handler({});
    expect(result).toMatchObject({ state: 'complete', sources: { ingestion: { value: { droppedTotal: 2 } } } });
    expect(queryLogs).not.toHaveBeenCalled();
    expect(getLogStats).not.toHaveBeenCalled();
    expect(acknowledgeAlert).not.toHaveBeenCalled();
  });
});
