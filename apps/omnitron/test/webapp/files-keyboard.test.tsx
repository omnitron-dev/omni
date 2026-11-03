// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState, type ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { files } from '../../webapp/src/netron/client.js';
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
    <><nav aria-label="Sidebar"><button>Sidebar link</button></nav><main id="main-content">
      {(['left', 'right'] as const).map((side) => {
        const props = {
          side,
          hosts: [{ id: 'local', name: 'Local', host: 'localhost', isLocal: true }],
          discovery: { pending: false },
          retryDiscovery: () => {},
          active: active === side,
          hidden: compact && active !== side,
          visible,
          refreshKey: 0,
          onFocus: () => setActive(side),
          onSelection: () => {},
          onAction: action,
          onOpen: open,
          onSwitchPanel: switchPanel,
        } satisfies ComponentProps<typeof FilePane>;
        return <FilePane key={side} {...props} />;
      })}
    </main></>
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
  it.each([false, true])('enters at the list from sidebar Tab, then cycles panels exactly as pointer entry (compact=%s)', async compact => {
    mount(compact);
    const left = await screen.findByRole('table', { name: 'left files' });
    await waitFor(() => expect(left.querySelectorAll('tbody tr')).toHaveLength(3));
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Sidebar link' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(left);
    await user.tab();
    await waitFor(() => expect(document.activeElement?.closest('[data-file-side]')?.getAttribute('data-file-side')).toBe('right'));
    await user.tab({ shift: true });
    await waitFor(() => expect(document.activeElement).toBe(left));
    await user.click(within(left).getByRole('row', { name: 'file beta.txt' }));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('file beta.txt');
    await user.tab();
    await waitFor(() => expect(document.activeElement?.closest('[data-file-side]')?.getAttribute('data-file-side')).toBe('right'));
    expect(document.querySelectorAll('[data-cursor="true"]')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New right location tab' }));
    await user.tab();
    const right = screen.getByRole('region', { name: 'right file panel' });
    expect(document.activeElement).toBe(within(right).getByRole('button', { name: /^Root$/ }));
    await user.keyboard('{Escape}');
    expect(document.activeElement?.hasAttribute('data-file-list')).toBe(true);
    await user.keyboard('{F6}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sidebar link' }));
  });
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
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New left location tab' }));
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
  it('keeps parent navigation out of selections and destructive actions, including empty directories', async () => {
    const prior = vi.mocked(files.list).getMockImplementation();
    vi.mocked(files.list).mockImplementation(async location => ({ entries: location.path ? [] : [{ name: 'folder', path: 'folder', kind: 'directory', size: 0, modifiedAt: '', mode: 0o755, version: 'folder' }], next: null, revision: 'one' }));
    try {
      action.mockClear(); mount();
      const left = await screen.findByRole('table', { name: 'left files' });
      await waitFor(() => expect(left.querySelectorAll('tbody tr')).toHaveLength(1));
      left.focus(); fireEvent.keyDown(left, { key: 'ArrowRight' });
      await waitFor(() => expect(screen.getByRole('row', { name: 'Parent directory' })).toBeTruthy());
      fireEvent.keyDown(document.activeElement!, { key: ' ' });
      fireEvent.keyDown(document.activeElement!, { key: 'a', ctrlKey: true });
      fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
      expect(action).not.toHaveBeenCalled();
      expect(left.querySelectorAll('tbody input:checked')).toHaveLength(0);
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
      await waitFor(() => expect(screen.queryByRole('row', { name: 'Parent directory' })).toBeNull());
    } finally { vi.mocked(files.list).mockImplementation(prior!); }
  });
});
