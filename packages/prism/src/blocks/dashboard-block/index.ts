/**
 * Dashboard Block
 *
 * Reusable dashboard widget/card block with header, content, and footer slots.
 *
 * @module @omnitron/prism/blocks/dashboard-block
 */

export {
  DashboardBlock,
  DashboardBlockHeader,
  DashboardBlockContent,
  DashboardBlockFooter,
  useDashboardBlockContext,
} from './dashboard-block.js';

export { useDashboardBlock } from './use-dashboard-block.js';
export type {
  UseDashboardBlockReturn,
  UseDashboardBlockOptions,
  DashboardBlockState,
  DashboardBlockActions,
} from './use-dashboard-block.js';

export type {
  DashboardBlockProps,
  DashboardBlockVariant,
  DashboardBlockSize,
  DashboardBlockHeaderProps,
  DashboardBlockContentProps,
  DashboardBlockFooterProps,
  DashboardBlockContextValue,
  LoadingConfig,
  ErrorConfig,
} from './types.js';
