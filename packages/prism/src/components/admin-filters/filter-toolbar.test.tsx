/**
 * FilterToolbar — the filter bar above every admin table.
 *
 * The property worth pinning hardest: the search box keeps local state so
 * typing stays responsive, which means it can disagree with the filters that
 * are actually applied. A box showing a term nobody is filtering by is a lie
 * the operator has no way to detect.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilterToolbar } from './filter-toolbar.js';
import type { FilterConfig, FilterValues } from './filter-toolbar.js';

const filters: FilterConfig[] = [
  { key: 'search', type: 'search', label: 'Search', placeholder: 'Search orders...' },
  {
    key: 'status',
    type: 'select',
    label: 'Status',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'Closed' },
    ],
  },
];

function renderToolbar(values: FilterValues, onChange = vi.fn(), extra = {}) {
  const result = render(
    <FilterToolbar filters={filters} values={values} onChange={onChange} searchDebounce={20} {...extra} />
  );
  return { ...result, onChange };
}

describe('FilterToolbar', () => {
  it('seeds the search box from the applied value', () => {
    renderToolbar({ search: 'widgets' });
    expect(screen.getByDisplayValue('widgets')).toBeInTheDocument();
  });

  it('propagates typed search after the debounce', async () => {
    const user = userEvent.setup();
    const { onChange } = renderToolbar({ search: '' });

    await user.type(screen.getByPlaceholderText('Search orders...'), 'abc');

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'abc' }));
    });
  });

  it('adopts an external search change', async () => {
    // A parent that resets or restores filters — switching tabs, clearing
    // programmatically, loading a saved view — used to leave the box showing
    // the old term while nothing filtered by it.
    const { rerender } = renderToolbar({ search: 'widgets' });
    expect(screen.getByDisplayValue('widgets')).toBeInTheDocument();

    rerender(
      <FilterToolbar filters={filters} values={{ search: '' }} onChange={vi.fn()} searchDebounce={20} />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search orders...')).toHaveValue('');
    });
  });

  it('does not clobber in-progress typing when the parent echoes a value back', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderToolbar({ search: '' }, onChange);

    const box = screen.getByPlaceholderText('Search orders...');
    await user.type(box, 'ab');

    await waitFor(() => expect(onChange).toHaveBeenCalled());

    // Parent applies what the toolbar just sent — the box must not reset.
    rerender(
      <FilterToolbar filters={filters} values={{ search: 'ab' }} onChange={onChange} searchDebounce={20} />
    );

    await user.type(box, 'c');
    expect(box).toHaveValue('abc');
  });

  it('clears the search box when reset is pressed', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderToolbar({ search: 'widgets', status: 'open' }, vi.fn(), { onReset });

    await user.click(screen.getByRole('button', { name: /reset/i }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Search orders...')).toHaveValue('');
  });

  it('builds cleared values itself when no onReset is given', async () => {
    const user = userEvent.setup();
    const { onChange } = renderToolbar({ search: 'widgets', status: 'open' });

    await user.click(screen.getByRole('button', { name: /reset/i }));

    expect(onChange).toHaveBeenCalledWith({ search: '', status: '' });
  });

  it('reports a select change immediately, without debounce', async () => {
    const user = userEvent.setup();
    const { onChange } = renderToolbar({ search: '', status: '' });

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Closed' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
  });

  it('names its selects for assistive technology', () => {
    // The visible label is rendered as placeholder text inside the control,
    // which looks right and leaves the field with no accessible name: a
    // screen-reader user hears "combo box" and nothing about what it filters.
    renderToolbar({ search: '', status: '' });

    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  });

  it('accepts a localized reset label', () => {
    renderToolbar({ search: 'x' }, vi.fn(), { resetLabel: 'Сбросить' });
    expect(screen.getByRole('button', { name: 'Сбросить' })).toBeInTheDocument();
  });
});
