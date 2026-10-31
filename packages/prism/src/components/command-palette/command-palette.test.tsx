import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type CommandAction } from './command-palette.js';

function makeActions(): CommandAction[] {
  return [
    {
      id: 'go-users',
      title: 'Go to Users',
      group: 'Navigation',
      keywords: ['admin', 'list'],
      onSelect: vi.fn(),
    },
    {
      id: 'go-orgs',
      title: 'Go to Orgs',
      group: 'Navigation',
      onSelect: vi.fn(),
    },
    {
      id: 'rotate-key',
      title: 'Rotate signing key',
      group: 'Actions',
      keywords: ['signing', 'rotate'],
      onSelect: vi.fn(),
    },
  ];
}

describe('CommandPalette', () => {
  it('opens via Cmd+K and renders all actions', async () => {
    render(<CommandPalette actions={makeActions()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    expect(await screen.findByPlaceholderText(/Type a command/i)).toBeInTheDocument();
    expect(screen.getByText('Go to Users')).toBeInTheDocument();
    expect(screen.getByText('Go to Orgs')).toBeInTheDocument();
    expect(screen.getByText('Rotate signing key')).toBeInTheDocument();
  });

  it('opens via Ctrl+K (non-mac fallback)', async () => {
    render(<CommandPalette actions={makeActions()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(await screen.findByPlaceholderText(/Type a command/i)).toBeInTheDocument();
  });

  it('filters actions by title substring', async () => {
    const user = userEvent.setup();
    render(<CommandPalette actions={makeActions()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText(/Type a command/i);
    await user.type(input, 'rotate');
    expect(screen.getByText('Rotate signing key')).toBeInTheDocument();
    expect(screen.queryByText('Go to Users')).not.toBeInTheDocument();
  });

  it('filters by keyword (synonyms)', async () => {
    const user = userEvent.setup();
    render(<CommandPalette actions={makeActions()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText(/Type a command/i);
    await user.type(input, 'signing');
    expect(screen.getByText('Rotate signing key')).toBeInTheDocument();
    expect(screen.queryByText('Go to Users')).not.toBeInTheDocument();
  });

  it('Enter triggers the highlighted action and closes', async () => {
    const actions = makeActions();
    render(<CommandPalette actions={actions} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText(/Type a command/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(actions[0]!.onSelect).toHaveBeenCalledTimes(1));
  });

  it('ArrowDown moves the highlight to the next action', async () => {
    const actions = makeActions();
    render(<CommandPalette actions={actions} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText(/Type a command/i);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(actions[1]!.onSelect).toHaveBeenCalledTimes(1));
  });

  it('Escape closes the palette without firing any action', async () => {
    const actions = makeActions();
    render(<CommandPalette actions={actions} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText(/Type a command/i);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Type a command/i)).not.toBeInTheDocument();
    });
    for (const a of actions) expect(a.onSelect).not.toHaveBeenCalled();
  });

  it('renders empty state when no actions match', async () => {
    const user = userEvent.setup();
    render(<CommandPalette actions={makeActions()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText(/Type a command/i);
    await user.type(input, 'nonexistent-zzz');
    expect(screen.getByText(/No matching commands/i)).toBeInTheDocument();
  });

  it('disabled actions do not fire onSelect', async () => {
    const handler = vi.fn();
    const actions: CommandAction[] = [
      {
        id: 'disabled-act',
        title: 'Disabled action',
        disabled: true,
        onSelect: handler,
      },
    ];
    render(<CommandPalette actions={actions} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    const input = await screen.findByPlaceholderText(/Type a command/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    // Give microtasks a chance to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Command palette ownership and visual order', () => {
  it('does not execute an IME commit and follows the displayed group order', () => {
    const actions = makeActions();
    const mixed = [actions[0]!, actions[2]!, actions[1]!];
    render(<CommandPalette actions={mixed} open disableShortcut />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(actions[0]!.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions[1]!.onSelect).toHaveBeenCalledOnce();
    expect(actions[2]!.onSelect).not.toHaveBeenCalled();
  });
  it('does not reopen on a shortcut already consumed by a child', () => {
    render(<CommandPalette actions={makeActions()} />);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    event.preventDefault();
    fireEvent(window, event);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
