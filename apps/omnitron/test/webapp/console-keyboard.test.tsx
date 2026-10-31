// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRef } from 'react';
import { ConsoleKeyboard, useConsoleActions } from '../../webapp/src/components/console-keyboard.js';
import { focusRegion } from '../../webapp/src/components/keyboard-model.js';
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
const refresh = vi.fn(),
  destructive = vi.fn();
function Workspace({ disabled = false }: { disabled?: boolean }) {
  const region = useRef<HTMLDivElement>(null);
  useConsoleActions(
    [{ id: 'copy', title: 'Copy selected files', key: 'F5', disabled, onSelect: destructive }],
    true,
    region
  );
  return (
    <main id="main-content">
      <section data-keyboard-region="Tools">
        <button data-console-command="refresh" onClick={refresh}>
          Refresh
        </button>
        <input data-console-command="search" aria-label="Filter" />
      </section>
      <div ref={region} data-keyboard-region="Files" tabIndex={0}>
        Files
      </div>
      <section data-keyboard-region="Hidden" hidden>
        <button>Hidden control</button>
      </section>
      <section data-keyboard-region="SSH">
        <textarea className="xterm" aria-label="SSH" />
      </section>
    </main>
  );
}
function mount(disabled = false) {
  return render(
    <MemoryRouter>
      <ConsoleKeyboard navigation={[{ subheader: 'Allowed', items: [{ title: 'Nodes', path: '/nodes' }] }]}>
        <Workspace disabled={disabled} />
      </ConsoleKeyboard>
    </MemoryRouter>
  );
}
describe('Console keyboard ownership', () => {
  it('respects editors, handled keys, IME and disabled local commands', () => {
    refresh.mockClear();
    destructive.mockClear();
    mount(true);
    const files = screen.getByText('Files');
    files.focus();
    expect(fireEvent.keyDown(files, { key: 'F5' })).toBe(false);
    expect(destructive).not.toHaveBeenCalled();
    fireEvent.keyDown(files, { key: 'r' });
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('Filter'), { key: 'r' });
    fireEvent.keyDown(files, { key: 'r', isComposing: true });
    const handled = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    handled.preventDefault();
    files.dispatchEvent(handled);
    fireEvent.keyDown(screen.getByLabelText('SSH'), { key: 'r' });
    fireEvent.keyDown(screen.getByLabelText('SSH'), { key: 'k', ctrlKey: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('cycles visible regions in both directions and lets SSH yield only via F6', () => {
    mount();
    focusRegion(-1);
    expect(document.activeElement).toBe(screen.getByLabelText('SSH'));
    fireEvent.keyDown(document.activeElement!, { key: 'F6' });
    expect(document.activeElement).toBe(screen.getByText('Refresh'));
    fireEvent.keyDown(document.activeElement!, { key: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('SSH'));
  });
  it('offers authorized navigation and focuses search after releasing the modal', async () => {
    mount();
    screen.getByText('Files').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByText('Nodes')).toBeTruthy();
    expect(screen.queryByText('Access control')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Focus search' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Filter')));
  });
  it('suspends page commands behind a dialog', () => {
    destructive.mockClear();
    mount();
    screen.getByText('Files').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'F5' });
    expect(destructive).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.activeElement!, { key: '/', ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'F5' });
    expect(destructive).toHaveBeenCalledTimes(1);
  });
});
