// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { ConsoleKeyboard } from '../../webapp/src/components/console-keyboard.js';
import { FilePane } from '../../webapp/src/components/files/file-pane.js';
vi.mock('src/netron/client', () => ({
  files: {
    roots: vi.fn(async () => ({ protocol: 1, roots: [{ id: 'root', label: 'Root', readOnly: false }] })),
    list: vi.fn(async () => ({
      entries: [
        { name: 'alpha.txt', path: 'alpha.txt', kind: 'file', size: 1 },
        { name: 'beta.txt', path: 'beta.txt', kind: 'file', size: 2 },
        { name: 'gamma.txt', path: 'gamma.txt', kind: 'file', size: 3 },
      ],
      next: null,
      revision: 'one',
    })),
  },
}));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
const action = vi.fn(),
  open = vi.fn();
function Workspace({ compact = false, visible = true }) {
  const [active, setActive] = useState<'left' | 'right'>('left');
  const switchPanel = () => {
    const side = active === 'left' ? 'right' : 'left';
    setActive(side);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-file-side=${side}] [data-file-list]`)?.focus()
    );
  };
  return (
    <main id="main-content">
      {(['left', 'right'] as const).map((side) => (
        <FilePane
          key={side}
          side={side}
          hosts={[{ id: 'local', name: 'Local', isLocal: true }]}
          active={active === side}
          hidden={compact && active !== side}
          visible={visible}
          refreshKey={0}
          onFocus={() => setActive(side)}
          onSelection={() => {}}
          onAction={action}
          onOpen={open}
          onSwitchPanel={switchPanel}
        />
      ))}
    </main>
  );
}
function mount(compact = false, visible = true) {
  return render(
    <MemoryRouter>
      <ConsoleKeyboard navigation={[]}>
        <Workspace compact={compact} visible={visible} />
      </ConsoleKeyboard>
    </MemoryRouter>
  );
}
describe('File panel keyboard', () => {
  it.each([false, true])(
    'switches panels with Tab and Shift Tab (compact=%s), preserving control access',
    async (compact) => {
      mount(compact);
      const left = await screen.findByRole('table', { name: 'left files' });
      await waitFor(() => expect(left.querySelectorAll('tbody tr')).toHaveLength(3));
      left.focus();
      fireEvent.keyDown(left, { key: 'Tab' });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('table', { name: 'right files' })));
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('table', { name: 'left files' })));
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(document.activeElement?.getAttribute('role')).toBe('combobox');
      expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(true);
    }
  );
  it('moves the cursor independently of selection, extends ranges and uses the existing actions', async () => {
    action.mockClear();
    open.mockClear();
    mount();
    const table = await screen.findByRole('table', { name: 'left files' });
    await waitFor(() => expect(table.querySelectorAll('tbody tr')).toHaveLength(3));
    table.focus();
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('beta.txt');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', shiftKey: true });
    expect(table.querySelectorAll('tbody input:checked')).toHaveLength(2);
    fireEvent.keyDown(document.activeElement!, { key: 'F5' });
    expect(action).toHaveBeenCalledWith('copy');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    table.focus();
    fireEvent.keyDown(table, { key: 'Home' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'alpha.txt' }),
      expect.objectContaining({ path: 'alpha.txt' }),
      false
    );
  });
  it('does not register commands from a retained inactive page', async () => {
    action.mockClear();
    mount(false, false);
    const table = await screen.findByRole('table', { name: 'left files' });
    await waitFor(() => expect(table.querySelectorAll('tbody tr')).toHaveLength(3));
    table.focus();
    fireEvent.keyDown(table, { key: 'Delete' });
    expect(action).not.toHaveBeenCalled();
  });
});
