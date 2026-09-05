/**
 * SearchInput — the search box used directly and inside FilterToolbar.
 *
 * It can run controlled, uncontrolled, or controlled-with-debounce, and the
 * third mode is where the interesting behaviour lives: the component holds a
 * draft while the parent holds the applied value, and those two must not
 * fight each other.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchInput } from './search-input.js';

describe('SearchInput', () => {
  it('reports every keystroke when not debounced', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Search" />);

    await user.type(screen.getByPlaceholderText('Search'), 'ab');

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('reports once after the debounce window', async () => {
    // The window has to outlast the typing, and how long typing takes is a
    // property of the machine, not of the component. At 40ms this failed
    // roughly one run in ten under load: the debounce fired mid-word, so
    // "still quiet" saw a call for 'a' and the count saw two. A test whose
    // verdict depends on host speed reports load, not correctness — and the
    // failure it produces ("expected not to be called, was called 2 times")
    // reads like a real defect in debouncing.
    //
    // 500ms is far longer than typing three characters takes anywhere, and
    // costs nothing: the assertion after it waits for the call rather than
    // for the window.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput debounce={500} onChange={onChange} placeholder="Search" />);

    await user.type(screen.getByPlaceholderText('Search'), 'abc');

    // Still quiet inside the window.
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('abc'), { timeout: 2000 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps showing what was typed while the debounce is pending', async () => {
    const user = userEvent.setup();
    render(<SearchInput debounce={40} value="" onChange={() => {}} placeholder="Search" />);

    const box = screen.getByPlaceholderText('Search');
    await user.type(box, 'abc');

    // The parent still holds '' — the box must show the draft, not the
    // applied value, or typing would appear to do nothing.
    expect(box).toHaveValue('abc');
  });

  it('adopts an external value change', async () => {
    const { rerender } = render(<SearchInput value="widgets" onChange={() => {}} placeholder="Search" />);
    expect(screen.getByPlaceholderText('Search')).toHaveValue('widgets');

    rerender(<SearchInput value="" onChange={() => {}} placeholder="Search" />);

    await waitFor(() => expect(screen.getByPlaceholderText('Search')).toHaveValue(''));
  });

  it('clears immediately, without waiting for the debounce', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput debounce={1000} value="widgets" onChange={onChange} placeholder="Search" />);

    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByPlaceholderText('Search')).toHaveValue('');
  });

  it('offers a clear affordance only when there is something to clear', async () => {
    const user = userEvent.setup();
    render(<SearchInput onChange={() => {}} placeholder="Search" />);

    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search'), 'x');

    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('works uncontrolled', async () => {
    const user = userEvent.setup();
    render(<SearchInput onChange={() => {}} placeholder="Search" />);

    await user.type(screen.getByPlaceholderText('Search'), 'typed');

    expect(screen.getByPlaceholderText('Search')).toHaveValue('typed');
  });
});
