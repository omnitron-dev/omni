/**
 * AdminDataTable — the table every admin screen in the portal is built on
 * (22 call sites) and, until now, untested.
 *
 * The properties pinned here are the ones whose failure is quiet: which row a
 * selection actually refers to, whether a sort request reaches the caller,
 * and whether pagination reports the page the operator asked for. A table
 * that renders correctly while mis-identifying its rows is worse than one
 * that renders wrong.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdminDataTable } from './admin-data-table.js';
import type { ColumnDef } from './admin-data-table.js';

interface Row {
  id: string;
  name: string;
  amount: string;
}

const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.name },
  { key: 'amount', header: 'Amount', align: 'right', render: (row) => row.amount },
];

const rows: Row[] = [
  { id: 'a', name: 'Alpha', amount: '1.5' },
  { id: 'b', name: 'Beta', amount: '2.5' },
  { id: 'c', name: 'Gamma', amount: '3.5' },
];

function renderTable(props: Partial<React.ComponentProps<typeof AdminDataTable<Row>>> = {}) {
  return render(
    <AdminDataTable<Row>
      columns={columns}
      data={rows}
      total={rows.length}
      page={0}
      pageSize={10}
      onPageChange={() => {}}
      {...props}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminDataTable — empty versus unable', () => {
  /**
   * "No data found" and "we could not load this" looked identical, and the
   * first reads as a healthy answer. Not hypothetical: the omnitron console's
   * traces page had both of its queries failing against the database schema,
   * had never returned a row, and displayed "No traces collected yet" for as
   * long as the page had existed.
   */
  const columns = [{ key: 'name', header: 'Name', render: (r: { name: string }) => r.name }];

  it('says there is nothing when there is nothing', () => {
    render(<AdminDataTable data={[]} columns={columns} emptyMessage="No orders yet" />);

    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });

  it('says it could not load, and why, when the load failed', () => {
    render(
      <AdminDataTable
        data={[]}
        columns={columns}
        emptyMessage="No orders yet"
        loadError="column child.trace_id does not exist"
      />
    );

    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
    expect(screen.getByText('column child.trace_id does not exist')).toBeInTheDocument();
    // The reassuring message must NOT also be on screen: an operator reading
    // both would take the calmer one.
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
  });

  it('shows rows rather than either message when there is data', () => {
    render(<AdminDataTable data={[{ name: 'row' }]} columns={columns} loadError="stale" />);

    expect(screen.getByText('row')).toBeInTheDocument();
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });

  it('treats an empty error string as no error', () => {
    // A caller threading `error ?? ''` through must not flip the table into
    // its failure state with nothing to say.
    render(<AdminDataTable data={[]} columns={columns} emptyMessage="No orders yet" loadError="" />);

    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });
});

describe('AdminDataTable', () => {
  it('renders a row per record and a cell per column', () => {
    renderTable();

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('shows the empty message instead of an empty grid', () => {
    renderTable({ data: [], total: 0, emptyMessage: 'Nothing here yet' });
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('reports a row click with the row itself, not its index', () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    screen.getByText('Beta').click();

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it('requests a sort by column key', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderTable({ onSort, sortBy: 'name', sortOrder: 'asc' });

    await user.click(screen.getByText('Name'));

    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('does not offer sorting on columns that did not ask for it', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderTable({ onSort });

    await user.click(screen.getByText('Amount'));

    expect(onSort).not.toHaveBeenCalled();
  });

  // --- Selection identity -------------------------------------------------

  it('selects by row id, so the selection survives reordering', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const { rerender } = renderTable({ selectable: true, selectedKeys: new Set<string>(), onSelectionChange });

    // Second data row (first checkbox is the header's select-all).
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[2]!);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect([...onSelectionChange.mock.calls[0]![0]]).toEqual(['b']);

    // Reorder the data; the selected key must still point at Beta.
    const reordered = [rows[2]!, rows[1]!, rows[0]!];
    rerender(
      <AdminDataTable<Row>
        columns={columns}
        data={reordered}
        total={reordered.length}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        selectable
        selectedKeys={new Set(['b'])}
        onSelectionChange={onSelectionChange}
      />
    );

    const betaRow = screen.getByText('Beta').closest('tr')!;
    expect(within(betaRow).getByRole('checkbox')).toBeChecked();
  });

  it('warns when selection is enabled but rows have no stable key', () => {
    // Index-based keys make a selection positional: sort or page, and a bulk
    // action re-targets rows the operator never picked. Silence would let
    // that reach production; this is the one place it can still be caught.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AdminDataTable<{ name: string }>
        columns={[{ key: 'name', header: 'Name', render: (row) => row.name }]}
        data={[{ name: 'Alpha' }, { name: 'Beta' }]}
        total={2}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        selectable
        selectedKeys={new Set<string>()}
        onSelectionChange={() => {}}
      />
    );

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('no stable key'));
  });

  it('does not warn when rows carry an id', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderTable({ selectable: true, selectedKeys: new Set<string>(), onSelectionChange: () => {} });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('toggles every row on the page from the header checkbox', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderTable({ selectable: true, selectedKeys: new Set<string>(), onSelectionChange });

    await user.click(screen.getAllByRole('checkbox')[0]!);

    expect([...onSelectionChange.mock.calls[0]![0]].sort()).toEqual(['a', 'b', 'c']);
  });

  it('renders bulk actions only while something is selected', () => {
    const bulkActions = (selected: ReadonlySet<string>) => <button type="button">Delete {selected.size}</button>;

    const { rerender } = renderTable({ selectable: true, selectedKeys: new Set<string>(), bulkActions });
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();

    rerender(
      <AdminDataTable<Row>
        columns={columns}
        data={rows}
        total={rows.length}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        selectable
        selectedKeys={new Set(['a', 'b'])}
        bulkActions={bulkActions}
      />
    );
    expect(screen.getByRole('button', { name: 'Delete 2' })).toBeInTheDocument();
  });

  // --- Pagination ---------------------------------------------------------

  it('reports the requested page', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    renderTable({ total: 42, pageSize: 10, onPageChange });

    await user.click(screen.getByRole('button', { name: /next page/i }));

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('shows a skeleton while loading rather than an empty state', () => {
    renderTable({ loading: true, data: [], total: 0, emptyMessage: 'Nothing here yet' });
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
  });
});
