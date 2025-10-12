/**
 * Table Primitive
 *
 * A headless table component with accessibility support.
 * Provides structure and ARIA attributes without styling or complex logic.
 *
 * @example
 * ```tsx
 * <Table>
 *   <Table.Caption>User List</Table.Caption>
 *   <Table.Header>
 *     <Table.Row>
 *       <Table.Head>Name</Table.Head>
 *       <Table.Head>Email</Table.Head>
 *     </Table.Row>
 *   </Table.Header>
 *   <Table.Body>
 *     <Table.Row>
 *       <Table.Cell>John Doe</Table.Cell>
 *       <Table.Cell>john@example.com</Table.Cell>
 *     </Table.Row>
 *   </Table.Body>
 * </Table>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext } from '../core/component/context.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface TableProps {
  children?: any;
  [key: string]: any;
}

export interface TableCaptionProps {
  children?: any;
  [key: string]: any;
}

export interface TableHeaderProps {
  children?: any;
  [key: string]: any;
}

export interface TableBodyProps {
  children?: any;
  [key: string]: any;
}

export interface TableFooterProps {
  children?: any;
  [key: string]: any;
}

export interface TableRowProps {
  children?: any;
  /** Whether the row is selected */
  selected?: boolean;
  [key: string]: any;
}

export interface TableHeadProps {
  children?: any;
  /** Scope of the header cell */
  scope?: 'col' | 'row' | 'colgroup' | 'rowgroup';
  /** Whether the column is sortable (adds cursor pointer) */
  sortable?: boolean;
  /** Current sort direction */
  sortDirection?: 'asc' | 'desc' | 'none';
  style?: any;
  [key: string]: any;
}

export interface TableCellProps {
  children?: any;
  [key: string]: any;
}

interface TableContextValue {
  // Reserved for future enhancements
}

// ============================================================================
// Context
// ============================================================================

const TableContext = createContext<TableContextValue | undefined>(undefined);

// ============================================================================
// Components
// ============================================================================

/**
 * Table Root
 * Renders a semantic <table> element with ARIA attributes
 */
export const Table = defineComponent<TableProps>((props) => () => {
  const { children, ...restProps } = props;

  const contextValue: TableContextValue = {};

  return jsx(TableContext.Provider, {
    value: contextValue,
    children: jsx('table', {
      ...restProps,
      'data-table': '',
      role: 'table',
      children,
    }),
  });
});

/**
 * Table Caption
 * Renders a <caption> element for table description
 */
export const TableCaption = defineComponent<TableCaptionProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('caption', {
    ...restProps,
    'data-table-caption': '',
    children,
  });
});

/**
 * Table Header
 * Renders a <thead> element for table headers
 */
export const TableHeader = defineComponent<TableHeaderProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('thead', {
    ...restProps,
    'data-table-header': '',
    children,
  });
});

/**
 * Table Body
 * Renders a <tbody> element for table body rows
 */
export const TableBody = defineComponent<TableBodyProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('tbody', {
    ...restProps,
    'data-table-body': '',
    children,
  });
});

/**
 * Table Footer
 * Renders a <tfoot> element for table footer
 */
export const TableFooter = defineComponent<TableFooterProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('tfoot', {
    ...restProps,
    'data-table-footer': '',
    children,
  });
});

/**
 * Table Row
 * Renders a <tr> element with optional selected state
 */
export const TableRow = defineComponent<TableRowProps>((props) => () => {
  const { children, selected, ...restProps } = props;

  return jsx('tr', {
    ...restProps,
    'data-table-row': '',
    'data-selected': selected ? '' : undefined,
    'aria-selected': selected ? 'true' : undefined,
    children,
  });
});

/**
 * Table Head
 * Renders a <th> element with optional sorting support
 */
export const TableHead = defineComponent<TableHeadProps>((props) => () => {
  const { children, scope = 'col', sortable, sortDirection = 'none', style, ...restProps } = props;

  return jsx('th', {
    ...restProps,
    scope,
    'data-table-head': '',
    'data-sortable': sortable ? '' : undefined,
    'aria-sort':
      sortable && sortDirection !== 'none' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined,
    style: sortable ? { cursor: 'pointer', ...style } : style,
    children,
  });
});

/**
 * Table Cell
 * Renders a <td> element for table data
 */
export const TableCell = defineComponent<TableCellProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('td', {
    ...restProps,
    'data-table-cell': '',
    children,
  });
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Table as any).Caption = TableCaption;
(Table as any).Header = TableHeader;
(Table as any).Body = TableBody;
(Table as any).Footer = TableFooter;
(Table as any).Row = TableRow;
(Table as any).Head = TableHead;
(Table as any).Cell = TableCell;

// ============================================================================
// Type augmentation for sub-components
// ============================================================================

export interface TableComponent {
  (props: TableProps): any;
  Caption: typeof TableCaption;
  Header: typeof TableHeader;
  Body: typeof TableBody;
  Footer: typeof TableFooter;
  Row: typeof TableRow;
  Head: typeof TableHead;
  Cell: typeof TableCell;
}
