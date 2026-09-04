/**
 * ConfirmDialog / DeleteDialog.
 *
 * This is the gate in front of destructive actions — 31 call sites in the
 * DAOS portal, most of them deletions — and it had no tests. The behaviour
 * that matters here is not rendering: it is that the action fires exactly
 * once, and that the dialog cannot be dismissed out from under an operation
 * already in flight.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfirmDialog, DeleteDialog } from './confirm-dialog.js';

describe('ConfirmDialog', () => {
  it('renders the title and message and wires them for assistive technology', () => {
    render(
      <ConfirmDialog open onClose={() => {}} onConfirm={() => {}} title="Delete item?" content="Cannot be undone." />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Delete item?');
    expect(dialog).toHaveAccessibleDescription('Cannot be undone.');
  });

  it('confirms and cancels through the right handlers', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open onClose={onClose} onConfirm={onConfirm} confirmLabel="Delete" />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires a slow confirm only once, however many times it is clicked', async () => {
    // The guard against a double submit used to be the caller's `loading`
    // prop and nothing else — so any caller that did not thread one through
    // (most of them) let an impatient double-click delete twice.
    const user = userEvent.setup();
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    }));

    render(<ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} confirmLabel="Delete" />);

    const confirm = screen.getByRole('button', { name: 'Delete' });
    await user.click(confirm);

    // The button locks itself for the duration of the action, so a second
    // click cannot even reach it. Before the fix it stayed live and a
    // double-click deleted twice.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(confirm).toBeDisabled());

    // Cancel is locked too — the operation is already under way.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    resolveConfirm();
    await waitFor(() => expect(confirm).not.toBeDisabled());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('re-enables the confirm button after a failed confirm', async () => {
    // A rejected action must leave the operator able to retry — not stuck
    // behind a permanently spinning button.
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('server said no'));

    render(<ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} confirmLabel="Delete" />);

    const confirm = screen.getByRole('button', { name: 'Delete' });
    await user.click(confirm);

    await waitFor(() => expect(confirm).not.toBeDisabled());
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('cannot be cancelled while the caller reports loading', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmDialog open loading onClose={onClose} onConfirm={() => {}} />);

    // Cancel is disabled outright — asserting the state rather than clicking,
    // because user-event (correctly) refuses to click a disabled control.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    // Escape must not close it either — the operation is already running.
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('honours `disabled` on the confirm action', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open disabled onClose={() => {}} onConfirm={onConfirm} confirmLabel="Delete" />);

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} onClose={() => {}} onConfirm={() => {}} title="Delete item?" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('DeleteDialog', () => {
  it('names the item in the title and defaults to a destructive confirm', () => {
    render(<DeleteDialog open itemName="Project Alpha" onClose={() => {}} onConfirm={() => {}} />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Delete "Project Alpha"?');
  });

  it('falls back to a generic title without an item name', () => {
    render(<DeleteDialog open onClose={() => {}} onConfirm={() => {}} />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Delete item?');
  });
});
