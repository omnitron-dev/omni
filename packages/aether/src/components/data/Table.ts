/**
 * Table Component (Styled)
 *
 * A styled table component with advanced features:
 * - Sorting and filtering support
 * - Row selection and hover states
 * - Responsive design variants
 * - Border and layout variants
 * - Striped and hoverable options
 */

import { styled } from '../../styling/styled.js';
import {
  Table as TablePrimitive,
  TableCaption as TableCaptionPrimitive,
  TableHeader as TableHeaderPrimitive,
  TableBody as TableBodyPrimitive,
  TableFooter as TableFooterPrimitive,
  TableRow as TableRowPrimitive,
  TableHead as TableHeadPrimitive,
  TableCell as TableCellPrimitive,
  type TableProps as TablePrimitiveProps,
  type TableCaptionProps,
  type TableHeaderProps,
  type TableBodyProps,
  type TableFooterProps,
  type TableRowProps,
  type TableHeadProps,
  type TableCellProps,
} from '../../primitives/Table.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Table Root - Styled table container
 */
export const Table = styled<
  {
    size?: 'sm' | 'md' | 'lg';
    variant?: 'simple' | 'striped' | 'bordered' | 'unstyled';
    layout?: 'auto' | 'fixed';
  },
  TablePrimitiveProps
>(TablePrimitive, {
  base: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.75rem',
        lineHeight: '1rem',
      },
      md: {
        fontSize: '0.875rem',
        lineHeight: '1.25rem',
      },
      lg: {
        fontSize: '1rem',
        lineHeight: '1.5rem',
      },
    },
    variant: {
      simple: {
        borderBottom: '1px solid #e5e7eb',
      },
      striped: {
        borderBottom: '1px solid #e5e7eb',
      },
      bordered: {
        border: '1px solid #e5e7eb',
      },
      unstyled: {},
    },
    layout: {
      auto: {
        tableLayout: 'auto',
      },
      fixed: {
        tableLayout: 'fixed',
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'simple',
    layout: 'auto',
  },
});

/**
 * Table Caption - Styled table caption
 */
export const TableCaption = styled(TableCaptionPrimitive, {
  base: {
    padding: '0.75rem',
    fontSize: '0.875rem',
    color: '#6b7280',
    textAlign: 'left',
    captionSide: 'bottom',
  },
});

/**
 * Table Header - Styled table header
 */
export const TableHeader = styled(TableHeaderPrimitive, {
  base: {
    backgroundColor: '#f9fafb',
  },
});

/**
 * Table Body - Styled table body
 */
export const TableBody = styled<
  {
    striped?: boolean;
    hoverable?: boolean;
  },
  TableBodyProps
>(TableBodyPrimitive, {
  base: {},
  variants: {
    striped: {
      true: {},
      false: {},
    },
    hoverable: {
      true: {},
      false: {},
    },
  },
  defaultVariants: {
    striped: 'false',
    hoverable: 'false',
  },
});

/**
 * Table Footer - Styled table footer
 */
export const TableFooter = styled(TableFooterPrimitive, {
  base: {
    backgroundColor: '#f9fafb',
    fontWeight: '500',
  },
});

/**
 * Table Row - Styled table row
 */
export const TableRow = styled<
  {
    hoverable?: boolean;
  },
  TableRowProps
>(TableRowPrimitive, {
  base: {
    borderBottom: '1px solid #e5e7eb',
    transition: 'background-color 0.15s ease',
  },
  variants: {
    hoverable: {
      true: {
        cursor: 'pointer',
      },
      false: {},
    },
  },
  defaultVariants: {
    hoverable: 'false',
  },
});

/**
 * Table Head - Styled table header cell
 */
export const TableHead = styled<
  {
    align?: 'left' | 'center' | 'right';
  },
  TableHeadProps
>(TableHeadPrimitive, {
  base: {
    padding: '0.75rem 1rem',
    fontWeight: '600',
    textAlign: 'left',
    color: '#374151',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  variants: {
    align: {
      left: {
        textAlign: 'left',
      },
      center: {
        textAlign: 'center',
      },
      right: {
        textAlign: 'right',
      },
    },
  },
  defaultVariants: {
    align: 'left',
  },
});

/**
 * Table Cell - Styled table data cell
 */
export const TableCell = styled<
  {
    align?: 'left' | 'center' | 'right';
  },
  TableCellProps
>(TableCellPrimitive, {
  base: {
    padding: '0.75rem 1rem',
    color: '#111827',
    textAlign: 'left',
  },
  variants: {
    align: {
      left: {
        textAlign: 'left',
      },
      center: {
        textAlign: 'center',
      },
      right: {
        textAlign: 'right',
      },
    },
  },
  defaultVariants: {
    align: 'left',
  },
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
// Display names
// ============================================================================

Table.displayName = 'Table';
TableCaption.displayName = 'Table.Caption';
TableHeader.displayName = 'Table.Header';
TableBody.displayName = 'Table.Body';
TableFooter.displayName = 'Table.Footer';
TableRow.displayName = 'Table.Row';
TableHead.displayName = 'Table.Head';
TableCell.displayName = 'Table.Cell';

// ============================================================================
// Type exports
// ============================================================================

export type {
  TablePrimitiveProps as TableProps,
  TableCaptionProps,
  TableHeaderProps,
  TableBodyProps,
  TableFooterProps,
  TableRowProps,
  TableHeadProps,
  TableCellProps,
};
