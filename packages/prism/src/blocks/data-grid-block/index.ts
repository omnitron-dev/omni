/**
 * DataGrid Block
 *
 * Advanced data table block with toolbar, pagination, sorting, filtering,
 * row actions, and server-side data support.
 *
 * @module @omnitron-dev/prism/blocks/data-grid-block
 */

export { DataGridBlock, useDataGridBlock, useDataGridBlockContext } from './data-grid-block.js';

export type {
  DataGridBlockProps,
  DataGridBlockContextValue,
  DataGridRowAction,
  DataGridToolbarConfig,
  DataGridPaginationConfig,
  DataGridSelectionConfig,
  DataGridEmptyConfig,
  QuickFilterConfig,
  ExportConfig,
  ColumnVisibilityConfig,
  UseDataGridBlockOptions,
  UseDataGridBlockReturn,
  DataGridFetchParams,
  DataGridFetchResult,
} from './types.js';
