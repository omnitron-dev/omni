import { StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataGridBlock, useDataGridBlock } from './data-grid-block.js';
import type { DataGridFetchResult } from './types.js';

const columns = [{ field: 'name', headerName: 'Name', width: 200 }];
const rows = [{ id: 1, name: 'Alpha North' }, { id: 2, name: 'Beta South' }];

describe('DataGridBlock quick search', () => {
  it('filters real rows, keeps focus across toolbar updates and clears with Escape', async () => {
    const onFilterChange = vi.fn();
    const grid = () => <DataGridBlock columns={columns} rows={rows} disableVirtualization onFilterChange={onFilterChange}
      toolbar={{ quickFilter: { debounceMs: 0 } }} />;
    const { rerender } = render(grid());
    const search = screen.getByRole('searchbox', { name: 'Search...' });
    search.focus();
    fireEvent.change(search, { target: { value: 'Alpha North' } });
    await waitFor(() => expect(screen.queryByText('Beta South')).toBeNull());
    expect(screen.getByText('Alpha North')).toBeVisible();
    expect(onFilterChange.mock.lastCall?.[0].quickFilterValues).toEqual(['Alpha', 'North']);
    rerender(grid());
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.getByText('Beta South')).toBeVisible());
  });

  it('reflects the controlled server model and sends terms to the caller', async () => {
    const listener = vi.fn();
    const grid = (term: string) => <DataGridBlock columns={columns} rows={rows} disableVirtualization
      toolbar={{ quickFilter: { debounceMs: 0 } }} pagination={{ mode: 'server', rowCount: 10 }}
      filterModel={{ items: [], quickFilterValues: [term] }} onFilterChange={listener} />;
    const { rerender } = render(grid('North'));
    const search = screen.getByRole('searchbox');
    expect(search).toHaveValue('North');
    fireEvent.change(search, { target: { value: 'South' } });
    await waitFor(() => expect(listener.mock.lastCall?.[0].quickFilterValues).toEqual(['South']));
    rerender(grid('West'));
    await waitFor(() => expect(search).toHaveValue('West'));
    expect(screen.getByText('Beta South')).toBeVisible();
  });

  it('keeps the latest response and aborts superseded and unmounted requests under StrictMode', async () => {
    const requests: { signal: AbortSignal; finish: (value: DataGridFetchResult) => void }[] = [];
    const { result, unmount } = renderHook(() => useDataGridBlock({ fetcher: ({ signal }) =>
      new Promise<DataGridFetchResult>(resolve => { requests.push({ signal: signal!, finish: resolve }); }) }), { wrapper: StrictMode });
    const old = requests.at(-1)!;
    act(() => result.current.refresh());
    const latest = requests.at(-1)!;
    expect(old.signal.aborted).toBe(true);
    await act(async () => { latest.finish({ rows, total: 2 }); });
    await act(async () => { old.finish({ rows: [], total: 0 }); });
    expect(result.current).toMatchObject({ rows, total: 2, loading: false });
    act(() => result.current.refresh());
    unmount();
    expect(requests.at(-1)!.signal.aborted).toBe(true);
  });
});
