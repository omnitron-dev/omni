// @vitest-environment happy-dom

/**
 * What the status bar says when one of its three queries fails.
 *
 * It rebuilds its whole state on every poll from `Promise.allSettled`, so a
 * sub-query that rejected used to contribute `0`. The bar renders the nodes
 * and alerts chips only when the count is above zero, so a failing
 * `alerts.getSummary()` made the alert chip disappear — and a chip that is
 * not there reads as "nothing is firing", which is a claim rather than a
 * silence, on the one surface an operator glances at from every page.
 *
 * Carrying the last known count forward can show an alert that has since
 * cleared. That direction is the safe one: a stale count sends someone to the
 * alerts page, a false zero sends them nowhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const status = vi.fn();
const listNodes = vi.fn();
const getSummary = vi.fn();

vi.mock('src/netron/client', () => ({
  daemon: { status: () => status() },
  nodes: { listNodes: () => listNodes() },
  alerts: { getSummary: () => getSummary() },
}));

vi.mock('src/stores/project.store', () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ activeProject: null, activeStack: null, projects: [] }),
  useActiveProjectStacks: () => [],
}));

/**
 * The realtime store, driven by the test.
 *
 * The bar polls every 30s when the socket is up, which is far too long to
 * wait for a second poll. It also re-fetches immediately on a realtime event,
 * and that path is the one an operator actually hits — an alert firing IS a
 * realtime event. Driving it here keeps the test at millisecond scale and
 * exercises the path that matters.
 */
let realtime: { connected: boolean; lastEvent: { channel: string } | null } = {
  connected: true,
  lastEvent: null,
};
vi.mock('src/stores/realtime.store', () => ({
  useRealtimeStore: (selector: (s: unknown) => unknown) => selector(realtime),
}));

const { StatusBar } = await import('../../webapp/src/components/status-bar.js');

/** The nodes chip renders `Nodes` beside `online/total`. */
const nodesChip = () =>
  screen.queryAllByText((_c, el) => /^Nodes\s*\d+\/\d+$/.test(el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''));

/** The alert chip's text is split across JSX nodes, so match the whole line. */
const alertChip = () =>
  screen.queryAllByText((_content, el) => /^\d+ alerts?$/.test(el?.textContent?.trim() ?? ''));

beforeEach(() => {
  status.mockReset();
  listNodes.mockReset();
  getSummary.mockReset();
  status.mockResolvedValue({ apps: [], uptime: 1000, version: '1.0.0', pid: 1 });
  listNodes.mockResolvedValue([]);
  realtime = { connected: true, lastEvent: null };
});

describe('StatusBar', () => {
  it('keeps the alert count when the alerts query fails', async () => {
    getSummary.mockResolvedValueOnce({ firing: 3 });
    getSummary.mockRejectedValue(new Error('daemon unreachable'));

    const { rerender } = render(<StatusBar />);
    await waitFor(() => expect(alertChip().length).toBeGreaterThan(0));

    // A realtime event drives the second poll; its alerts call rejects.
    // Before this the chip vanished, which on a status bar reads as
    // "nothing is firing".
    realtime = { connected: true, lastEvent: { channel: 'alert.fired' } };
    rerender(<StatusBar />);

    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    expect(alertChip().length).toBeGreaterThan(0);
  });

  it('keeps the alert count when the POLL\'s alerts call fails', async () => {
    // The realtime path and the poll path each build the count, and a test
    // that drives one says nothing about the other: restoring the defect in
    // the poll left both tests above green. This drives the poll, with the
    // clock advanced rather than waited out.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getSummary.mockResolvedValueOnce({ firing: 4 });
      getSummary.mockRejectedValue(new Error('daemon unreachable'));

      render(<StatusBar />);
      await vi.waitFor(() => expect(alertChip().length).toBeGreaterThan(0));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });

      await vi.waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
      expect(alertChip().length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the node counts when the nodes call fails', async () => {
    // The same shape one chip over. Left untested, restoring the defect here
    // passed every assertion above — the nodes branch and the alerts branch
    // are separate code, and a test aimed at one is silent about the other.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listNodes.mockResolvedValueOnce([
        { status: { omnitronConnected: true } },
        { status: { omnitronConnected: false } },
      ]);
      listNodes.mockRejectedValue(new Error('daemon unreachable'));
      getSummary.mockResolvedValue({ firing: 0 });

      render(<StatusBar />);
      await vi.waitFor(() => expect(nodesChip().length).toBeGreaterThan(0));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });

      await vi.waitFor(() => expect(listNodes).toHaveBeenCalledTimes(2));
      expect(nodesChip().length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a cleared alert as cleared', async () => {
    // The carry-forward must not outlive a successful answer, or a resolved
    // alert would stay on screen for as long as the page is open.
    getSummary.mockResolvedValueOnce({ firing: 2 });
    getSummary.mockResolvedValue({ firing: 0 });

    const { rerender } = render(<StatusBar />);
    await waitFor(() => expect(alertChip().length).toBeGreaterThan(0));

    realtime = { connected: true, lastEvent: { channel: 'alert.resolved' } };
    rerender(<StatusBar />);

    await waitFor(() => expect(alertChip()).toEqual([]));
  });
});
