// @vitest-environment happy-dom

/**
 * A breakdown beside a total it did not add up to — the console's half.
 *
 * The log page printed the rows its filter matched beside `getLogStats`'s
 * levels: the whole table's, 9 159 730 rows, refetched on every change of
 * filter and narrowed by none — «Showing 100 of 48 991» beside «error: 42 650»
 * for an hour that held 149. The breakdown is now the query's own
 * (`queryLogs().byLevel`, whose sum is its total), and the whole table is
 * grouped once, for the list of apps that have logged.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

import { useProjectStore } from '../../webapp/src/stores/project.store.js';

const { queryLogs, getLogStats } = vi.hoisted(() => {
  const entry = (i: number, level: string) => ({
    id: `l${i}`,
    timestamp: new Date(Date.now() - i * 1_000).toISOString(),
    nodeId: null,
    app: 'daos/dev/main',
    level,
    message: `line ${i}`,
    labels: null,
    traceId: null,
    spanId: null,
    metadata: null,
  });

  /** An hour: 149 errors among 48 991 rows, and a level no known one — as recorded. */
  const hour = {
    entries: [entry(1, 'info'), entry(2, 'error')],
    total: 48_991,
    byLevel: [
      { level: 'medium', count: 2 },
      { level: 'warn', count: 705 },
      { level: 'error', count: 149 },
      { level: 'info', count: 44_185 },
      { level: 'debug', count: 3_950 },
    ],
    hasMore: true,
  };

  /** The same hour, ERROR only. */
  const errors = { entries: [entry(2, 'error')], total: 149, byLevel: [{ level: 'error', count: 149 }], hasMore: true };

  /** The whole table — what the page used to print beside the hour's total. */
  const wholeTable = {
    byApp: [{ app: 'daos/dev/main', count: 9_159_730 }],
    byLevel: [
      { level: 'debug', count: 762_291 },
      { level: 'info', count: 8_215_811 },
      { level: 'warn', count: 138_116 },
      { level: 'error', count: 42_650 },
      { level: 'fatal', count: 1 },
    ],
    totalCount: 9_159_730,
    oldestEntry: null,
    newestEntry: null,
  };

  return {
    queryLogs: vi.fn(async (filter: { level?: string[] }) => (filter.level?.includes('error') ? errors : hour)),
    getLogStats: vi.fn(async () => wholeTable),
  };
});

vi.mock('src/netron/client', () => ({
  logs: { queryLogs, getLogStats, streamLogs: vi.fn(async () => []) },
  daemon: { list: vi.fn(async () => []) },
  nodes: { listNodes: vi.fn(async () => []) },
  project: {},
}));

async function renderPage() {
  useProjectStore.setState({ activeProject: 'daos', activeStack: null });
  const { default: LogsPage } = await import('../../webapp/src/pages/logs.js');
  render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter>
        <LogsPage />
      </MemoryRouter>
    </ThemeProvider>
  );
  await screen.findByText('Showing 2 of 48,991');
}

/** The breakdown as a reader sees it, in the order shown. */
const breakdown = () => screen.queryAllByText(/^[\w-]+: [\d,]+$/).map((node) => node.textContent);

describe('a breakdown beside a total it did not add up to', () => {
  it("breaks down the rows the total counts — the query's own levels, not the whole table's", async () => {
    await renderPage();

    expect(breakdown()).toEqual(['debug: 3,950', 'info: 44,185', 'warn: 705', 'error: 149', 'medium: 2']);
    expect(screen.queryByText('error: 42,650')).not.toBeInTheDocument();
  });

  it('narrows with the filter, and does not group the whole table again for it', async () => {
    getLogStats.mockClear();
    await renderPage();
    const asked = getLogStats.mock.calls.length;

    // The level chip: `error` in the DOM, capitals by CSS.
    fireEvent.click(screen.getByText('error', { selector: 'span' }));

    await screen.findByText('Showing 1 of 149');
    await waitFor(() => expect(breakdown()).toEqual(['error: 149']));
    expect(getLogStats.mock.calls.length).toBe(asked);
  });
});
