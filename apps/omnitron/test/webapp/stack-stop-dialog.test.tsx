// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StackStopDialog } from '../../webapp/src/components/stack-stop-dialog.js';

const rpc = vi.hoisted(() => ({ invoke: vi.fn(), granted: true }));
vi.mock('src/netron/client', () => ({ daemonClient: { invoke: rpc.invoke } }));
vi.mock('src/auth/access', () => ({ Can: ({ children }: { children: ReactNode }) => rpc.granted ? children : null }));
const report = { project: 'sample', stack: 'dev', checkedAt: 'now', digest: 'a'.repeat(64),
  targets: [{ node: 'local', applications: ['api'], containers: ['postgres'] }] };
beforeEach(() => { vi.clearAllMocks(); rpc.granted = true; rpc.invoke.mockResolvedValue(report); });
afterEach(cleanup);
const open = (confirm = vi.fn()) => {
  render(<StackStopDialog project="sample" stack="dev" onClose={vi.fn()} onConfirm={confirm} />);
  return confirm;
};

it('discards an older destructive preview after switching to infrastructure preservation', async () => {
  let previous!: (value: typeof report) => void;
  rpc.invoke.mockImplementationOnce(() => new Promise(resolve => { previous = resolve; }))
    .mockResolvedValueOnce({ ...report, digest: 'b'.repeat(64), keepInfrastructure: true });
  const confirm = open();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep infrastructure' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop applications' }).hasAttribute('disabled')).toBe(false));
  await act(async () => { previous(report); });
  expect(screen.getByText('Containers kept · postgres')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Stop applications' }));
  expect(confirm).toHaveBeenCalledWith('b'.repeat(64), true);
  expect(rpc.invoke.mock.calls[1]?.[3]).toEqual([{ project: 'sample', stack: 'dev', keepInfrastructure: true }]);
});

it('blocks confirmation when an older controller does not confirm the selected mode', async () => {
  const confirm = open();
  await screen.findByText('Containers to remove · postgres');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep infrastructure' }));
  await screen.findByText(/cannot confirm infrastructure preservation/);
  expect(screen.getByRole('button', { name: 'Stop applications' }).hasAttribute('disabled')).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

it('never offers a mutating action to a reader without stop permission', async () => {
  rpc.granted = false; open();
  await screen.findByText('Containers to remove · postgres');
  expect(screen.queryByRole('button', { name: 'Stop stack' })).toBeNull();
});
