### Table

A data table with sorting, filtering, pagination, and selection.

#### Features

- Column sorting
- Row selection (single/multi)
- Pagination
- Filtering
- Virtual scrolling (large datasets)
- Expandable rows
- Column resizing
- Column visibility toggle
- Sticky headers
- Responsive

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Table } from 'aether/primitives';

const Example793 = defineComponent(() => {
  interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    status: 'active' | 'inactive';
  }
  const users: User[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com', role: 'Admin', status: 'active' },
    { id: '2', name: 'Bob', email: 'bob@example.com', role: 'User', status: 'active' },
    { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'User', status: 'inactive' }
  ];
  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'role', header: 'Role', sortable: true },
    { key: 'status', header: 'Status', sortable: true }
  ];
  const selectedRows = signal<string[]>([]);

  return () => (
    <Table data={users} columns={columns} rowKey="id">
      {#let table}
        <div class="table-container">
          <table class="table">
            <Table.Header class="table-header">
              <Table.Row class="table-row">
                <Table.Head class="table-head-checkbox">
                  <Checkbox
                    checked={table.isAllSelected()}
                    indeterminate={table.isSomeSelected()}
                    onCheckedChange={table.toggleAllRows}
                  />
                </Table.Head>
                {#each columns as column}
                  <Table.Head
                    key={column.key}
                    sortable={column.sortable}
                    class="table-head"
                  >
                    {column.header}
                    {#if column.sortable}
                      <Table.SortIndicator column={column.key} />
                    {/if}
                  </Table.Head>
                {/each}
                <Table.Head class="table-head-actions">
                  Actions
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body class="table-body">
              {#each table.rows() as row}
                <Table.Row
                  key={row.id}
                  selected={table.isRowSelected(row.id)}
                  class="table-row"
                >
                  <Table.Cell class="table-cell-checkbox">
                    <Checkbox
                      checked={table.isRowSelected(row.id)}
                      onCheckedChange={() => table.toggleRow(row.id)}
                    />
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    {row.name}
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    {row.email}
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    <span class="badge badge-{row.role.toLowerCase()}">
                      {row.role}
                    </span>
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    <span class="status status-{row.status}">
                      {row.status}
                    </span>
                  </Table.Cell>
                  <Table.Cell class="table-cell-actions">
                    <DropdownMenu>
                      <DropdownMenu.Trigger class="btn-icon">
                        <MoreVerticalIcon />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item>Edit</DropdownMenu.Item>
                        <DropdownMenu.Item>Delete</DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </table>
          <!-- Pagination -->
          <Table.Pagination class="table-pagination">
            <Table.PageInfo>
              Showing {table.pageStart()} to {table.pageEnd()} of {table.totalRows()}
            </Table.PageInfo>
            <div class="pagination-controls">
              <button
                on:click={table.previousPage}
                disabled={!table.canPreviousPage()}
                class="btn-icon"
              >
                <ChevronLeftIcon />
              </button>
              <span>
                Page {table.currentPage()} of {table.totalPages()}
              </span>
              <button
                on:click={table.nextPage}
                disabled={!table.canNextPage()}
                class="btn-icon"
              >
                <ChevronRightIcon />
              </button>
            </div>
          </Table.Pagination>
        </div>
      {/let}
    </Table>
  );
});
```

#### With Filtering

```typescript
import { defineComponent, signal, computed } from 'aether';
const Example573 = defineComponent(() => {
  const searchQuery = signal('');
  const statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  const filteredUsers = computed(() => {
    return users.filter(user => {
      const matchesSearch =
        user.name.toLowerCase().includes(searchQuery().toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery().toLowerCase());
      const matchesStatus =
        statusFilter() === 'all' || user.status === statusFilter();
      return matchesSearch && matchesStatus;
    });
  });

  return () => (
    <div class="table-filters">
      <input
        type="search"
        placeholder="Search users..."
        bind:value={searchQuery}
        class="search-input"
      />
      <Select bind:value={statusFilter}>
        <Select.Trigger>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="all">All Status</Select.Item>
          <Select.Item value="active">Active</Select.Item>
          <Select.Item value="inactive">Inactive</Select.Item>
        </Select.Content>
      </Select>
    </div>
    <Table data={filteredUsers()} columns={columns} rowKey="id">
      <!-- ... -->
    </Table>
  );
});
```

#### Styling Example

```css
.table-container {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table-header {
  background: var(--color-background-secondary);
}

.table-row {
  border-bottom: 1px solid var(--color-border);
  transition: background-color var(--transition-fast);
}

.table-row:hover {
  background: var(--color-background-secondary);
}

.table-row[data-selected="true"] {
  background: var(--color-primary-50);
}

.table-head {
  padding: var(--spacing-3) var(--spacing-4);

  text-align: left;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;

  white-space: nowrap;
}

.table-head[data-sortable="true"] {
  cursor: pointer;
  user-select: none;
}

.table-head[data-sortable="true"]:hover {
  color: var(--color-text-primary);
}

.table-cell {
  padding: var(--spacing-3) var(--spacing-4);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.table-head-checkbox,
.table-cell-checkbox {
  width: 40px;
  padding-right: 0;
}

.table-head-actions,
.table-cell-actions {
  width: 60px;
  text-align: right;
}

.table-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-background-secondary);
  border-top: 1px solid var(--color-border);
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  font-size: var(--font-size-sm);
}

.badge {
  display: inline-block;
  padding: var(--spacing-1) var(--spacing-2);

  background: var(--color-background-tertiary);
  border-radius: var(--radius-full);

  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.status {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);

  font-size: var(--font-size-sm);
}

.status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-active::before {
  background: var(--color-success);
}

.status-inactive::before {
  background: var(--color-error);
}
```

#### API Reference

**`<Table>`** - Table component

Props:
- `data: T[]` - Table data
- `columns: Column[]` - Column definitions
- `rowKey: keyof T` - Unique row identifier
- `pageSize?: number` - Rows per page (default: 10)
- `sortable?: boolean` - Enable sorting (default: false)
- `selectable?: boolean` - Enable row selection (default: false)
- `onRowClick?: (row: T) => void` - Row click handler

Exposes:
- `table.rows: Signal<T[]>` - Current page rows
- `table.selectedRows: Signal<string[]>` - Selected row IDs
- `table.isAllSelected: () => boolean` - All rows selected
- `table.isSomeSelected: () => boolean` - Some rows selected
- `table.toggleAllRows: () => void` - Toggle all selection
- `table.toggleRow: (id) => void` - Toggle row selection
- `table.isRowSelected: (id) => boolean` - Check if row selected
- `table.currentPage: Signal<number>` - Current page number
- `table.totalPages: () => number` - Total page count
- `table.pageStart: () => number` - First row index
- `table.pageEnd: () => number` - Last row index
- `table.totalRows: () => number` - Total row count
- `table.nextPage: () => void` - Next page
- `table.previousPage: () => void` - Previous page
- `table.canNextPage: () => boolean` - Has next page
- `table.canPreviousPage: () => boolean` - Has previous page
- `table.sortBy: (column, direction) => void` - Sort table

**`<Table.Header>`** - Table header

**`<Table.Body>`** - Table body

**`<Table.Row>`** - Table row

Props:
- `key: string` - Row identifier
- `selected?: boolean` - Selected state

**`<Table.Head>`** - Header cell

Props:
- `key?: string` - Column identifier
- `sortable?: boolean` - Enable sorting

**`<Table.Cell>`** - Data cell

**`<Table.SortIndicator>`** - Sort direction indicator

Props:
- `column: string` - Column to indicate

**`<Table.Pagination>`** - Pagination controls

**`<Table.PageInfo>`** - Page info display

---

