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
import { MemoryRouter, useLocation } from 'react-router-dom';
import { type ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { render as renderView, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const can = vi.fn(() => true);
vi.mock('src/auth/access', () => ({ useAccess: () => ({ can }) }));
const render = (ui: ReactElement) => renderView(ui, { wrapper: MemoryRouter });
const status = vi.fn();
const ping = vi.fn();
const listNodes = vi.fn();
const getSummary = vi.fn();
const releaseRealtime = vi.fn();
const initializeRealtime = vi.fn(() => releaseRealtime);

vi.mock('src/netron/client', () => ({
  daemon: { status: () => status(), ping: () => ping() },
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
  useRealtimeStore: (selector: (s: unknown) => unknown) => selector({ ...realtime, initialize: initializeRealtime }),
}));

const { StatusBar } = await import('../../webapp/src/components/status-bar.js');

/** The nodes chip renders `Nodes` beside `online/total`. */
const nodesChip = () =>
  screen.queryAllByText((_c, el) => /^Nodes\s*\d+\/\d+$/.test(el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''));

/** The alert chip's text is split across JSX nodes, so match the whole line. */
const alertChip = () =>
  screen.queryAllByText((_content, el) => /^\d+ alerts?$/.test(el?.textContent?.trim() ?? ''));

beforeEach(() => {
  can.mockReturnValue(true);
  initializeRealtime.mockClear();
  releaseRealtime.mockClear();
  status.mockReset();
  ping.mockReset();
  ping.mockResolvedValue({ pid: 1, uptime: 1000, version: '1.0.0' });
  listNodes.mockReset();
  getSummary.mockReset();
  status.mockResolvedValue({ apps: [], uptime: 1000, version: '1.0.0', pid: 1 });
  listNodes.mockResolvedValue([]);
  realtime = { connected: true, lastEvent: null };
});

describe('StatusBar', () => {
  it('opens the firing list with the keyboard from the system workspace', async () => {
    function Location() { const { pathname, hash } = useLocation(); return <output>{pathname}{hash}</output>; }
    getSummary.mockResolvedValue({ firing: 1, resolved: 8 });
    render(<><StatusBar /><Location /></>);
    const link = await screen.findByRole('link', { name: 'View 1 firing alert across all workspaces' });
    expect(link).toHaveAttribute('href', '/alerts#firing');
    const user = userEvent.setup();
    await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('/alerts#firing')).toBeInTheDocument();
  });

  it('omits the global count and its query when alerts are unavailable to the caller', async () => {
    can.mockReturnValue(false);
    getSummary.mockResolvedValue({ firing: 2 });
    render(<StatusBar />);
    await screen.findByLabelText(/Infrastructure status/);
    expect(getSummary).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByLabelText(/Infrastructure status/)).not.toHaveAttribute('aria-label', expect.stringContaining('alerts'));
  });

  it('keeps a realtime subscription on routes that do not own one themselves', async () => {
    getSummary.mockResolvedValue({ firing: 0 });
    const { rerender, unmount } = render(<StatusBar />);
    await waitFor(() => expect(initializeRealtime).toHaveBeenCalledTimes(1));
    rerender(<StatusBar />);
    expect(initializeRealtime).toHaveBeenCalledTimes(1);
    unmount();
    expect(releaseRealtime).toHaveBeenCalledTimes(1);
  });
  it('keeps a reachable backend online when owner inventory is unavailable without inventing zero apps', async () => {
    status.mockRejectedValue(new Error('Execution owner inventory is stale'));
    getSummary.mockResolvedValue({ firing: 0 });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByLabelText(/Infrastructure status: online, applications unknown/)).toBeTruthy());
    expect(ping).toHaveBeenCalled();
    expect(screen.getByText('unknown')).toBeTruthy();
  });

  it('retains the actual application count and marks it stale after owner observation fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      status.mockResolvedValueOnce({ apps: [{ status: 'online' }], uptime: 1000, version: '1.0.0', pid: 1 });
      status.mockRejectedValue(new Error('Execution owner inventory is stale'));
      getSummary.mockResolvedValue({ firing: 0 });
      render(<StatusBar />);
      await vi.waitFor(() => expect(screen.getByLabelText(/applications 1\/1,/)).toBeTruthy());
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
      await vi.waitFor(() => expect(screen.getByLabelText(/Infrastructure status: online, applications 1\/1 stale/)).toBeTruthy());
    } finally { vi.useRealTimers(); }
  });

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
