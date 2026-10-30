// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const { api } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    apps: vi.fn(),
    stacks: vi.fn(),
    series: vi.fn(),
    storage: vi.fn(),
    stats: vi.fn(),
    ingestion: vi.fn(),
    nodes: vi.fn(),
  },
}));
vi.mock('src/netron/client', () => ({
  daemon: { list: api.list },
  project: { getProjectApps: api.apps, listStacks: api.stacks },
  metrics: { querySeries: api.series, getStorageStatus: api.storage },
  logs: { getLogStats: api.stats, getIngestionStats: api.ingestion },
  nodes: { listNodes: api.nodes },
}));
vi.mock('src/hooks/use-stack-context', () => ({
  useStackContext: () => ({ activeProject: 'sample', activeStack: 'dev', namespacePrefix: 'sample/dev/' }),
}));
vi.mock('src/components/metric-chart', () => ({
  MetricChart: ({ title, lines, error }: any) => (
    <section aria-label={`${title} chart`}>
      {lines.map((line: any) => (
        <span key={line.id}>{line.name}</span>
      ))}
      {error}
    </section>
  ),
}));
vi.mock('@omnitron-dev/prism/components/chart', () => ({ Chart: () => null, useChart: (options: unknown) => options }));
import MetricsPage from '../../webapp/src/pages/metrics.js';
const app = {
  name: 'worker',
  handleKey: 'sample/dev/worker',
  stack: 'dev',
  stackType: 'local',
  status: 'online',
  cpu: 150,
  memory: 1024,
  restarts: 0,
  uptime: 1,
  pid: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  api.storage.mockResolvedValue({ type: 'postgres', durability: 'persistent', pendingSamples: 0, capacity: 50000, pendingBytes: 0, capacityBytes: 16777216, writing: false, writtenSamples: 123, droppedSamples: 0, failedWrites: 0, lastWriteAt: new Date().toISOString(), oldestPendingAt: null, lastError: null, cleanupError: null, syncError: null });
  api.list.mockResolvedValue([
    { ...app, name: app.handleKey },
    { ...app, name: 'other/dev/worker', memory: 1e9 },
  ]);
  api.apps.mockResolvedValue([app]);
  api.stacks.mockResolvedValue([{ name: 'dev', type: 'local', apps: [app], nodes: [] }]);
  api.nodes.mockResolvedValue([]);
  api.ingestion.mockResolvedValue({ ingestedTotal: 100 });
  api.stats.mockResolvedValue({ byLevel: [] });
  api.series.mockResolvedValue([
    { name: 'memory_bytes', app: 'sample/dev/worker', labels: {}, points: [{ timestamp: Date.now(), value: 1024 }] },
  ]);
});

describe('metrics for the selected deployment', () => {
  it('counts only selected apps, displays memory without CPU history, and defers the store scan', async () => {
    render(
      <MemoryRouter>
        <MetricsPage />
      </MemoryRouter>
    );
    expect(await screen.findByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('150.0%')).toBeInTheDocument();
    expect(screen.getByText('1 KiB')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Resident memory chart' })).toHaveTextContent('worker')
    );
    expect(screen.getByRole('region', { name: 'CPU chart' })).not.toHaveTextContent('worker');
    expect(api.stats).not.toHaveBeenCalled();
    expect(api.series).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Log store/ }));
    await waitFor(() => expect(api.stats).toHaveBeenCalledTimes(1));
  });
  it('keeps the last history and reports a failed refresh', async () => {
    render(
      <MemoryRouter>
        <MetricsPage />
      </MemoryRouter>
    );
    await screen.findByText('worker');
    api.series.mockRejectedValue(new Error('History offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metrics' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Resident memory chart' })).toHaveTextContent('History offline')
    );
    expect(screen.getByRole('region', { name: 'Resident memory chart' })).toHaveTextContent('worker');
  });
  it('replaces a previous confirmation with an explicit warning when storage diagnostics stop responding', async () => {
    render(<MemoryRouter><MetricsPage /></MemoryRouter>);
    await screen.findByText('postgres · database writes confirmed');
    api.storage.mockRejectedValue(new Error('Storage diagnostics unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metrics' }));
    await screen.findByText('Metrics persistence is not reported');
    expect(screen.queryByText('postgres · database writes confirmed')).not.toBeInTheDocument();
    expect(screen.getByText(/Storage diagnostics unavailable/)).toBeInTheDocument();
    api.storage.mockResolvedValue({ type: 'postgres', durability: 'persistent', pendingSamples: 2,
      capacity: 50000, droppedSamples: 0, lastWriteAt: null, lastError: 'database is read-only' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metrics' }));
    await screen.findByText(/Write failed: database is read-only/);
  });
});
