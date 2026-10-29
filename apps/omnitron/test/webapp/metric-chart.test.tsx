// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MetricChart } from '../../webapp/src/components/metric-chart.js';
vi.mock('@omnitron-dev/prism/components/chart', () => ({
  Chart: ({ series }: any) => <div data-testid="plot">{series.map((item: any) => item.name).join(',')}</div>,
  useChart: (options: unknown) => options,
}));
const lines = [
  { id: 'one', name: 'worker', data: [{ x: 10, y: 150 }], latest: 150, peak: 150, average: 150, lastAt: 10, count: 1 },
];
describe('chart controls and exact values', () => {
  it('toggles a series and provides an accessible table without hiding failure', () => {
    render(
      <MetricChart
        title="CPU"
        description="Test readings"
        lines={lines}
        format={(v) => `${v}%`}
        from={0}
        to={20}
        error="Collector unreachable"
      />
    );
    expect(screen.getByText(/Showing the last received samples/)).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /worker, 150%/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('plot')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all series' }));
    expect(screen.getByTestId('plot')).toHaveTextContent('worker');
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    const table = screen.getByRole('region', { name: 'CPU data' });
    expect(within(table).getByRole('columnheader', { name: 'Peak' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'worker' })).toBeInTheDocument();
  });
  it('distinguishes a failed query from an empty window', () => {
    const view = render(
      <MetricChart title="CPU" description="Test" lines={[]} format={String} from={0} to={20} error="Offline" />
    );
    expect(screen.getByText('History unavailable')).toBeInTheDocument();
    view.rerender(<MetricChart title="CPU" description="Test" lines={[]} format={String} from={0} to={20} />);
    expect(screen.getByText('No samples in this window')).toBeInTheDocument();
  });
});
