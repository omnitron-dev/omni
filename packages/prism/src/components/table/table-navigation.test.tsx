import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Table } from './table.js';
import { AdminDataTable } from '../admin-filters/admin-data-table.js';

describe.each(['Table', 'AdminDataTable'])('%s workspace navigation', (kind) => {
  function mount() {
    const onRowClick = vi.fn();
    const data = [{ id: 'one', name: 'Worker' }];
    const cell = () => <button onClick={(event) => event.stopPropagation()}>Inspect</button>;
    render(
      kind === 'Table' ? (
        <Table
          columns={[
            { id: 'name', label: 'Name' },
            { id: 'action', label: 'Action', render: cell },
          ]}
          data={data}
          onRowClick={onRowClick}
          scrollLabel="Workers"
          paginated
          page={0}
          rowsPerPage={10}
          onPageChange={vi.fn()}
        />
      ) : (
        <AdminDataTable
          columns={[
            { key: 'name', header: 'Name', render: (row) => row.name },
            { key: 'action', header: 'Action', render: cell },
          ]}
          data={data}
          onRowClick={onRowClick}
          scrollLabel="Workers"
          total={1}
          page={0}
          pageSize={10}
          onPageChange={vi.fn()}
        />
      )
    );
    return onRowClick;
  }

  it('keeps pagination outside the named keyboard-scrollable table', () => {
    mount();
    const viewport = screen.getByRole('region', { name: 'Workers' });
    expect(viewport).toHaveAttribute('tabindex', '0');
    expect(within(viewport).getByRole('table')).toBeInTheDocument();
    expect(within(viewport).queryByRole('button', { name: /next page/i })).toBeNull();
    expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
  });

  it('opens a focused row from the keyboard without intercepting its controls', () => {
    const onRowClick = mount();
    const row = screen.getByText('Worker').closest('tr')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inspect' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });
});
