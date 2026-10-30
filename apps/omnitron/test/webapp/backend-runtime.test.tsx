// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
const status = vi.fn();
vi.mock('src/netron/client', () => ({ backendRuntime: { status: () => status() } }));
const { BackendRuntimeCard } = await import('../../webapp/src/components/backend-runtime');
afterEach(() => { cleanup(); status.mockReset(); });

it('shows owner loss without asserting that applications stopped', async () => {
  status.mockResolvedValue({ mode: 'resident', handoffSupported: true,
    owner: { id: 'owner', pid: 123 }, epoch: 7, phase: 'active',
    connection: { status: 'unavailable', observedAt: '2026-10-30T14:00:00Z', error: 'Owner observation timed out' } });
  render(<BackendRuntimeCard />);
  await waitFor(() => expect(screen.getByText('Owner unavailable')).toBeTruthy());
  expect(screen.getByText(/Application state is unknown/)).toBeTruthy();
  expect(screen.getByText(/Owner PID 123 · epoch 7/)).toBeTruthy();
});

it('does not manufacture a freshness reading from an older backend', async () => {
  status.mockResolvedValue({ mode: 'resident', handoffSupported: true, owner: { id: 'owner', pid: 123 }, epoch: 7, phase: 'active' });
  render(<BackendRuntimeCard />);
  await waitFor(() => expect(screen.getByText(/does not report owner connection freshness/)).toBeTruthy());
  expect(screen.queryByText('Owner connected')).toBeNull();
});
