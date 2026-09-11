/**
 * `loading` has to draw something.
 *
 * The prop existed and did exactly one thing: suppress the empty state. A
 * table told it was loading therefore rendered a header over nothing, so every
 * consumer that wanted a loading state hand-rolled skeleton rows —
 * omnitron's console did it in seven pages, each with its own guess at how
 * many rows and how wide the cells should be.
 *
 * Drawing them inside the real table (rather than swapping in `TableSkeleton`,
 * which is a plain Box grid) keeps the header and the column widths still, so
 * the layout does not jump when the data arrives.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Table, type TableColumn } from './table.js';

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns: TableColumn<Row>[] = [
  { id: 'name', label: 'Name' },
  { id: 'status', label: 'Status', align: 'right' },
];

const rows: Row[] = [
  { id: 'a', name: 'main', status: 'online' },
  { id: 'b', name: 'storage', status: 'online' },
];

const skeletons = (container: HTMLElement) =>
  container.querySelectorAll('.MuiSkeleton-root').length;

describe('Table loading state', () => {
  it('draws placeholder rows, one skeleton per column', () => {
    const { container } = render(
      <Table columns={columns} data={[]} loading loadingRows={3} />,
    );
    expect(skeletons(container)).toBe(3 * columns.length);
  });

  it('keeps the header while loading, so columns do not jump', () => {
    render(<Table columns={columns} data={[]} loading />);
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  it('does not show the empty state while loading', () => {
    render(<Table columns={columns} data={[]} loading />);
    expect(screen.queryByText('No data available')).toBeNull();
  });

  it('shows the empty state once loading is over', () => {
    render(<Table columns={columns} data={[]} />);
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('draws no placeholders when data is present and loading is false', () => {
    const { container } = render(<Table columns={columns} data={rows} />);
    expect(skeletons(container)).toBe(0);
    expect(screen.getByText('main')).toBeTruthy();
  });

  it('hides stale rows while a reload is in flight', () => {
    // The alternative — placeholders stacked under the previous page's rows —
    // reads as "more data arrived", which is the opposite of what is happening.
    const { container } = render(<Table columns={columns} data={rows} loading loadingRows={2} />);
    expect(screen.queryByText('main')).toBeNull();
    expect(skeletons(container)).toBe(2 * columns.length);
  });

  it('accounts for the selection column', () => {
    const { container } = render(
      <Table columns={columns} data={[]} selectable loading loadingRows={2} />,
    );
    expect(skeletons(container)).toBe(2 * (columns.length + 1));
  });
});
