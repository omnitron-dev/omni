// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';
import type { AuditRow } from '../../src/shared/dto/audit.js';

const rpc = vi.hoisted(() => ({ available: vi.fn(), list: vi.fn(), permitted: true }));
vi.mock('src/netron/client', () => ({ audit: rpc }));
vi.mock('src/auth/access', () => ({ useAccess: () => ({ can: () => rpc.permitted }) }));
import AuditPage from '../../webapp/src/pages/audit.js';
import { useAuthStore } from '../../webapp/src/auth/store.js';

const base: AuditRow = {
  id: 'event-1',
  action: 'stack.start',
  actorType: 'user',
  actorId: 'omnitron-local',
  resourceType: 'stack',
  resourceId: 'original-project-name/dev',
  createdAt: '2026-11-02T03:55:01.123Z',
  ipAddress: null,
  details: { outcome: 'partial', notUp: 'collector', trees: [{ commit: 'a'.repeat(40), app: 'collector' }] },
};
const rows: AuditRow[] = [
  base,
  { ...base, id: 'event-2', actorType: 'system', actorId: null, details: null },
  { ...base, id: 'event-3', actorType: 'service', actorId: 'omnitron-local', details: null },
];
const view = () => (
  <ThemeProvider theme={createTheme()}>
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>
  </ThemeProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  rpc.permitted = true;
  rpc.available.mockResolvedValue({ available: true });
  rpc.list.mockResolvedValue(rows);
  useAuthStore.setState({ user: { id: 'reader', username: 'admin', displayName: 'Admin', role: 'admin' } });
});
afterEach(cleanup);

it('keeps time, identity and original details distinct, with keyboard disclosure and raw evidence', async () => {
  render(view());
  expect(await screen.findByText('Control-plane audit · all projects')).toBeInTheDocument();
  const buttons = await screen.findAllByRole('button', { name: /Details for stack.start/ });
  const first = within(buttons[0]!.closest('tr')!);
  expect(first.getAllByText('Local client').length).toBeGreaterThan(0);
  expect(screen.getAllByText('System').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Service: omnitron-local').length).toBeGreaterThan(0);
  expect(first.getByText('partial')).toBeInTheDocument();
  expect(screen.queryByText('a'.repeat(40))).not.toBeInTheDocument();
  fireEvent.click(buttons[0]!);
  const details = screen.getByRole('region', { name: 'Audit details: stack.start' });
  expect(within(details).getByText(base.createdAt)).toBeInTheDocument();
  expect(within(details).getByText('original-project-name/dev')).toBeInTheDocument();
  expect(within(details).getByText('omnitron-local')).toBeInTheDocument();
  expect(within(details).getByText(/does not identify a person/)).toBeInTheDocument();
  expect(within(details).getByText(/"commit":/)).toBeInTheDocument();
  fireEvent.click(within(details).getByRole('button', { name: 'Raw event' }));
  expect(screen.getByLabelText('Raw audit event').textContent).toBe(JSON.stringify(base, null, 2));
  fireEvent.keyDown(details, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Audit details: stack.start' })).not.toBeInTheDocument();
  expect(buttons[0]).toHaveFocus();
});

it('filters the stored actor kind and exact action without claiming a specific local tool', async () => {
  render(view());
  await screen.findAllByRole('button', { name: /Details for stack.start/ });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Actor' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Local client' }));
  await waitFor(() =>
    expect(rpc.list).toHaveBeenLastCalledWith({ limit: 100, actorType: 'user', actorId: 'omnitron-local' })
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Action (exact)' }), { target: { value: 'stack.start' } });
  await waitFor(() =>
    expect(rpc.list).toHaveBeenLastCalledWith({
      limit: 100,
      actorType: 'user',
      actorId: 'omnitron-local',
      action: 'stack.start',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  await waitFor(() => expect(rpc.list).toHaveBeenLastCalledWith({ limit: 100 }));
});

it('reports unavailable storage separately and clears the reading when permission is revoked', async () => {
  rpc.available.mockResolvedValueOnce({ available: false });
  const rendered = render(view());
  expect(await screen.findByText(/This daemon has no audit storage/)).toBeInTheDocument();
  expect(rpc.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh audit' }));
  await screen.findAllByRole('button', { name: /Details for stack.start/ });
  rpc.permitted = false;
  rendered.rerender(view());
  expect(screen.getByText(/Your role cannot read/)).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Audit events' })).not.toBeInTheDocument();
});

it('shows a pending read and a retryable failure without reporting an empty history', async () => {
  let reject!: (error: Error) => void;
  rpc.list.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  render(view());
  await waitFor(() => expect(rpc.list).toHaveBeenCalled());
  expect(screen.getByRole('status')).toHaveTextContent('Reading…');
  expect(screen.getByRole('button', { name: 'Refresh audit' })).toBeDisabled();
  await act(async () => {
    reject(Error('storage offline'));
  });
  expect(await screen.findByText(/Could not read the audit trail: storage offline/)).toBeInTheDocument();
  expect(screen.queryByText('Nothing recorded yet')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findAllByRole('button', { name: /Details for stack.start/ });
});

it('reads older events through an exact server cursor and freezes the snapshot until resume', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...base, id: `page-${index}` }));
  let finish!: (value: AuditRow[]) => void;
  rpc.list.mockResolvedValueOnce(firstPage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(view());
  const older = await screen.findByRole('button', { name: 'Load older' });
  act(() => {
    fireEvent.click(older);
    fireEvent.click(older);
  });
  expect(rpc.list).toHaveBeenCalledTimes(2);
  expect(rpc.list).toHaveBeenLastCalledWith({ limit: 100, beforeId: 'page-99' });
  expect(screen.getByRole('button', { name: 'Resume audit updates' })).toBeInTheDocument();
  expect(older).toBeDisabled();
  await act(async () => {
    finish([{ ...base, id: 'older-event', resourceId: 'older/project' }]);
  });
  expect(await screen.findByText('stack · older/project')).toBeInTheDocument();
  expect(screen.getByText('Start of matching history')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resume audit updates' }));
  await waitFor(() => expect(rpc.list).toHaveBeenLastCalledWith({ limit: 100 }));
  expect(screen.queryByText('stack · older/project')).not.toBeInTheDocument();
});

it('discards an in-flight historical page after a filter change, even when returning to the original filter', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...base, id: `page-${index}` }));
  let finish!: (value: AuditRow[]) => void;
  rpc.list.mockResolvedValueOnce(firstPage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Actor' }));
  fireEvent.click(await screen.findByRole('option', { name: 'System' }));
  await waitFor(() => expect(rpc.list).toHaveBeenLastCalledWith({ limit: 100, actorType: 'system' }));
  await act(async () => {
    finish([{ ...base, id: 'obsolete', resourceId: 'obsolete/project' }]);
  });
  expect(screen.queryByText('stack · obsolete/project')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  await waitFor(() => expect(rpc.list).toHaveBeenLastCalledWith({ limit: 100 }));
  expect(screen.queryByText('stack · obsolete/project')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).not.toHaveTextContent('Reading history');
});
