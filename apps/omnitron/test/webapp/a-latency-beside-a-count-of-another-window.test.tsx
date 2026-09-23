// @vitest-environment happy-dom

/**
 * A latency beside a count of another window.
 *
 * The app page's metrics drew «Requests 101 · Errors (5xx) 0 · Latency p95
 * 25034 ms» side by side, with no word on what each counted over: requests
 * and errors since the process started, latency over the last 60 s — six
 * requests on daos main (2026-09-23), three of them its notification
 * long-poll, which holds a request 25 s by design. The p50 of the same six
 * was 261 ms. Each card now says what it counts over, and the latency card
 * gives the median and the count beside the tail.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

import { latencyCaption } from '../../webapp/src/utils/app-address.js';

const { app, aggregate } = vi.hoisted(() => {
  const MB = 1024 * 1024;
  const app = {
    name: 'daos/dev/main',
    status: 'online',
    pid: 26669,
    cpu: 7.4,
    memory: 367 * MB,
    uptime: 60_000,
    restarts: 0,
    instances: 1,
    port: 3001,
    processes: [],
  };
  return {
    app,
    aggregate: {
      apps: {
        'daos/dev/main': {
          cpu: 7.4,
          memory: 367 * MB,
          traffic: 'measured',
          requests: 116,
          errors: 0,
          latency: { p50: 260.6, p95: 25066.8, p99: 25066.8, mean: 12581.6, max: 25066.8, count: 6, windowMs: 60_000 },
        },
      },
    },
  };
});

vi.mock('react-apexcharts', () => ({ default: () => null }));
vi.mock('src/netron/client', () => ({
  daemon: {
    getApp: vi.fn(async () => app),
    inspect: vi.fn(async () => ({
      name: 'daos/dev/main',
      pid: 26669,
      status: 'online',
      memory: { heapUsed: 1, heapTotal: 2, external: 0, arrayBuffers: 0, rss: 3 },
      uptime: 60_000,
      restarts: 0,
      services: [],
      children: [],
      pools: [],
      logPaths: {},
      config: {},
    })),
    getMetrics: vi.fn(async () => aggregate),
  },
  logs: { streamLogs: vi.fn(async () => []) },
  metrics: { querySeries: vi.fn(async () => []) },
}));

describe('a latency beside a count of another window', () => {
  it('says what each card counts over, and the median beside the tail', async () => {
    const { default: AppDetailPage } = await import('../../webapp/src/pages/apps/detail.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter initialEntries={['/apps/daos%2Fdev%2Fmain']}>
          <Routes>
            <Route path="/apps/:name" element={<AppDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Metrics' }));

    expect(await screen.findByText('25067')).toBeInTheDocument();
    expect(screen.getByText('p50 261 ms · 6 finished in the last 60 s')).toBeInTheDocument();
    expect(screen.getAllByText('since the process started')).toHaveLength(2);
  });

  it('says nothing finished rather than name a window it does not have', () => {
    expect(latencyCaption(null)).toBe('nothing finished in its window');
  });
});
