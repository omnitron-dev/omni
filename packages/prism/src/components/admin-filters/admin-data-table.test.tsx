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
  const nameColumns = [{ key: 'name', header: 'Name', render: (r: { name: string }) => r.name }];

  /**
   * The pagination props the component requires. Omitted here originally,
   * which the runtime tolerated and `tsc` did not — the suite was green while
   * the package's typecheck was red, because the build does not typecheck
   * tests. Two checks, one of them not consulted.
   */
  const paging = { total: 0, page: 1, pageSize: 25, onPageChange: () => {} };

  it('says there is nothing when there is nothing', () => {
    render(<AdminDataTable {...paging} data={[]} columns={nameColumns} emptyMessage="No orders yet" />);

    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });

  it('says it could not load, and why, when the load failed', () => {
    render(
      <AdminDataTable
        {...paging}
        data={[]}
        columns={nameColumns}
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

  it('shows the rows it got AND says the rest is missing', () => {
    // The partial failure, and the case that matters most. A list short
    // because one of its sources failed looks exactly like a list that is
    // short. This was originally treated as "rows are their own answer",
    // which left the defect intact in precisely the situation where an
    // operator is most likely to act on what they see.
    render(
      <AdminDataTable
        {...paging}
        total={1}
        data={[{ name: 'row' }]}
        columns={nameColumns}
        loadError="pending, processing"
      />
    );

    expect(screen.getByText('row')).toBeInTheDocument();
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText('pending, processing')).toBeInTheDocument();
  });

  it('says nothing extra when the rows are all there', () => {
    render(<AdminDataTable {...paging} total={1} data={[{ name: 'row' }]} columns={nameColumns} />);

    expect(screen.getByText('row')).toBeInTheDocument();
    expect(screen.queryByText(/could not/i)).not.toBeInTheDocument();
  });

  it('announces the partial failure to a screen reader', () => {
    // A warning a sighted user can see and a screen-reader user cannot is
    // the same failure one level down.
    render(
      <AdminDataTable {...paging} total={1} data={[{ name: 'row' }]} columns={nameColumns} loadError="one source" />
    );

    expect(screen.getByRole('status')).toHaveTextContent('one source');
  });

  it('treats an empty error string as no error', () => {
    // A caller threading `error ?? ''` through must not flip the table into
    // its failure state with nothing to say.
    render(<AdminDataTable {...paging} data={[]} columns={nameColumns} emptyMessage="No orders yet" loadError="" />);

    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });

  it('lets the host name the failure, in both states', () => {
    // `loadError` is a reason the caller has already translated; the two
    // sentences AROUND it were English literals in this file. That was
    // invisible while one consumer passed `loadError` at all — and the moment
    // four Russian screens did, they would have grown an English heading.
    const labels = { empty: 'Не удалось загрузить данные', partial: 'Часть данных не загрузилась' };

    const { unmount } = render(
      <AdminDataTable
        {...paging}
        data={[]}
        columns={nameColumns}
        emptyMessage="No orders yet"
        loadError="backend unreachable"
        loadErrorLabels={labels}
      />
    );
    expect(screen.getByText(labels.empty)).toBeInTheDocument();
    expect(screen.queryByText('Could not load this data')).not.toBeInTheDocument();
    // The caller's own reason still shows beneath it.
    expect(screen.getByText('backend unreachable')).toBeInTheDocument();
    unmount();

    render(
      <AdminDataTable
        {...paging}
        total={1}
        data={[{ name: 'row' }]}
        columns={nameColumns}
        loadError="one source"
        loadErrorLabels={labels}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(labels.partial);
    expect(screen.queryByText('Some of this data could not be loaded')).not.toBeInTheDocument();
  });

  it('still says something when the host names nothing', () => {
    // The control: the prop is optional, and every existing consumer omits
    // it. Defaulting to silence would be worse than defaulting to English.
    render(<AdminDataTable {...paging} data={[]} columns={nameColumns} loadError="down" />);

    expect(screen.getByText('Could not load this data')).toBeInTheDocument();
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

describe('rowSx', () => {
  it('paints state that belongs to the whole row', () => {
    // omnitron's alerts page dims a disabled rule. Without this the choice is
    // between losing the signal and applying it cell by cell, which makes one
    // row look like six unrelated ones.
    const ruleRows = [
      { id: '1', name: 'cpu-high', enabled: true },
      { id: '2', name: 'disk-low', enabled: false },
    ];
    const { container } = render(
      <AdminDataTable
        columns={[{ key: 'name', header: 'Name', render: (r: (typeof ruleRows)[number]) => r.name }]}
        data={ruleRows}
        total={ruleRows.length}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
        rowSx={(r) => ({ opacity: r.enabled ? 1 : 0.5 })}
      />,
    );
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
    expect(getComputedStyle(bodyRows[0]!).opacity).toBe('1');
    expect(getComputedStyle(bodyRows[1]!).opacity).toBe('0.5');
  });

  it('is optional — rows render unstyled without it', () => {
    const { container } = render(
      <AdminDataTable
        columns={[
          { key: 'name', header: 'Name', render: (r: { id: string; name: string }) => r.name },
        ]}
        data={[{ id: '1', name: 'only' }]}
        total={1}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
      />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('loading placeholders', () => {
  const cols = [
    { key: 'name', header: 'Name', render: (r: { id: string; name: string }) => r.name },
    { key: 'status', header: 'Status', render: (r: { id: string; name: string }) => r.name },
  ];

  const skeletons = (c: HTMLElement) => c.querySelectorAll('.MuiSkeleton-root').length;

  it('does not draw one placeholder per page slot', () => {
    // pageSize is a ceiling on what the table MAY hold, not a prediction of
    // what is coming. omnitron's /deployments has no deployments and drew 25.
    const { container } = render(
      <AdminDataTable
        columns={cols}
        data={[]}
        total={0}
        page={0}
        pageSize={25}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
        loading
      />,
    );
    expect(skeletons(container)).toBe(5 * cols.length);
  });

  it('never overshoots a deliberately small page', () => {
    const { container } = render(
      <AdminDataTable
        columns={cols}
        data={[]}
        total={0}
        page={0}
        pageSize={2}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
        loading
      />,
    );
    expect(skeletons(container)).toBe(2 * cols.length);
  });

  it('honours an explicit count', () => {
    const { container } = render(
      <AdminDataTable
        columns={cols}
        data={[]}
        total={0}
        page={0}
        pageSize={25}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
        loading
        loadingRows={3}
      />,
    );
    expect(skeletons(container)).toBe(3 * cols.length);
  });
});

describe('renderExpanded', () => {
  const cols = [{ key: 'name', header: 'Name', render: (r: { id: string; name: string }) => r.name }];
  const expandableRows = [
    { id: '1', name: 'nightly' },
    { id: '2', name: 'release' },
  ];

  it('puts the detail in a full-width row under the row it belongs to', () => {
    const { container } = render(
      <AdminDataTable
        columns={cols}
        data={expandableRows}
        total={expandableRows.length}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
        renderExpanded={(r) => (r.id === '1' ? <div data-testid="detail">steps</div> : null)}
      />,
    );
    expect(screen.getByTestId('detail')).toBeTruthy();
    const bodyRows = container.querySelectorAll('tbody tr');
    // two data rows plus one detail row, and the detail follows ITS row
    expect(bodyRows).toHaveLength(3);
    expect(bodyRows[1]!.querySelector('[data-testid="detail"]')).toBeTruthy();
    expect(bodyRows[1]!.querySelector('td')!.getAttribute('colspan')).toBe('1');
  });

  it('spans the checkbox column too when selectable', () => {
    const { container } = render(
      <AdminDataTable
        columns={cols}
        data={[expandableRows[0]!]}
        total={1}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
        selectable
        renderExpanded={() => <span>detail</span>}
      />,
    );
    const detailCell = container.querySelectorAll('tbody tr')[1]!.querySelector('td')!;
    expect(detailCell.getAttribute('colspan')).toBe('2');
  });

  it('adds nothing when no row is expanded', () => {
    const { container } = render(
      <AdminDataTable
        columns={cols}
        data={expandableRows}
        total={expandableRows.length}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
        renderExpanded={() => null}
      />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('is optional', () => {
    const { container } = render(
      <AdminDataTable
        columns={cols}
        data={expandableRows}
        total={expandableRows.length}
        page={0}
        pageSize={10}
        onPageChange={() => {}}
        rowKey={(r) => r.id}
      />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});
