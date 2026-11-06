// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RowActions } from '../../webapp/src/components/row-actions.js';

afterEach(cleanup);

describe('Console row commands', () => {
  it('keeps destructive commands last and separated without making them the initial keyboard target', async () => {
    const remove = vi.fn();
    render(<RowActions label="Actions for worker" actions={[
      { id: 'remove', label: 'Remove worker', color: 'error', onClick: remove },
      { id: 'inspect', label: 'Inspect worker', onClick: vi.fn() },
    ]} />);
    const trigger = screen.getByRole('button', { name: 'Actions for worker' });
    await act(async () => { trigger.focus(); });
    await act(async () => { fireEvent.click(trigger); });
    const menu = screen.getByRole('menu');
    const inspect = screen.getByRole('menuitem', { name: 'Inspect worker' });
    const destructive = screen.getByRole('menuitem', { name: 'Remove worker' });
    expect(screen.getAllByRole('menuitem')).toEqual([inspect, destructive]);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    await waitFor(() => expect(inspect).toHaveFocus());
    await act(async () => { fireEvent.keyDown(menu, { key: 'End' }); });
    expect(destructive).toHaveFocus();
    await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not add an empty group when only protected destructive commands are available', async () => {
    const remove = vi.fn();
    render(<RowActions label="Worker operations" actions={[
      { id: 'remove', label: 'Remove worker', color: 'error', disabled: true, onClick: remove },
    ]} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Worker operations' })); });
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    const item = screen.getByRole('menuitem', { name: 'Remove worker' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { fireEvent.click(item); });
    expect(remove).not.toHaveBeenCalled();
  });

  it('names its menu, keeps protected actions disabled, and does not activate the parent row', async () => {
    const parent = vi.fn();
    const inspect = vi.fn();
    const grant = vi.fn();
    render(
      <div onClick={parent}>
        <RowActions
          label="Actions for worker"
          actions={[
            { id: 'inspect', label: 'Inspect', onClick: inspect },
            { id: 'grant', label: 'Change role', disabled: true, onClick: grant },
          ]}
        />
      </div>
    );
    const trigger = screen.getByRole('button', { name: 'Actions for worker' });
    await act(async () => { fireEvent.click(trigger); });
    expect(screen.getByRole('menu', { name: 'Actions for worker' })).toBeInTheDocument();
    const disabled = screen.getByRole('menuitem', { name: 'Change role' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { fireEvent.click(disabled); });
    expect(grant).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect' })); });
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });
});
