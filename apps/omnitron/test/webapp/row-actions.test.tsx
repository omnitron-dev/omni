// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RowActions } from '../../webapp/src/components/row-actions.js';

afterEach(cleanup);

describe('Console row commands', () => {
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
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Actions for worker' })).toBeInTheDocument();
    const disabled = screen.getByRole('menuitem', { name: 'Change role' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(disabled);
    expect(grant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect' }));
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });
});
