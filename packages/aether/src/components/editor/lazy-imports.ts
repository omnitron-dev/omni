/**
 * Lazy imports for Advanced Editor
 *
 * Provides dynamic import utilities for code splitting and lazy loading
 * This helps reduce initial bundle size and improve load times
 */

import type { IExtension } from './core/types.js';

/**
 * Lazy load collaboration extensions
 */
export const loadCollaborationExtensions = async (): Promise<{
  CollaborationExtension: typeof import('./extensions/collaboration/CollaborationExtension.js').CollaborationExtension;
  CollaborationCursorExtension: typeof import('./extensions/collaboration/CollaborationCursorExtension.js').CollaborationCursorExtension;
}> => {
  const [collaboration, cursor] = await Promise.all([
    import('./extensions/collaboration/CollaborationExtension.js'),
    import('./extensions/collaboration/CollaborationCursorExtension.js'),
  ]);

  return {
    CollaborationExtension: collaboration.CollaborationExtension,
    CollaborationCursorExtension: cursor.CollaborationCursorExtension,
  };
};

/**
 * Lazy load table extensions
 */
export const loadTableExtensions = async (): Promise<{
  TableExtension: typeof import('./extensions/table/TableExtension.js').TableExtension;
  TableCellExtension: typeof import('./extensions/table/TableCellExtension.js').TableCellExtension;
  TableHeaderExtension: typeof import('./extensions/table/TableHeaderExtension.js').TableHeaderExtension;
  TableRowExtension: typeof import('./extensions/table/TableRowExtension.js').TableRowExtension;
}> => {
  const [table, cell, header, row] = await Promise.all([
    import('./extensions/table/TableExtension.js'),
    import('./extensions/table/TableCellExtension.js'),
    import('./extensions/table/TableHeaderExtension.js'),
    import('./extensions/table/TableRowExtension.js'),
  ]);

  return {
    TableExtension: table.TableExtension,
    TableCellExtension: cell.TableCellExtension,
    TableHeaderExtension: header.TableHeaderExtension,
    TableRowExtension: row.TableRowExtension,
  };
};

/**
 * Lazy load code extensions
 */
export const loadCodeExtensions = async (): Promise<{
  CodeBlockExtension: typeof import('./extensions/code/CodeBlockExtension.js').CodeBlockExtension;
  SyntaxHighlightExtension: typeof import('./extensions/code/SyntaxHighlightExtension.js').SyntaxHighlightExtension;
}> => {
  const [codeBlock, syntaxHighlight] = await Promise.all([
    import('./extensions/code/CodeBlockExtension.js'),
    import('./extensions/code/SyntaxHighlightExtension.js'),
  ]);

  return {
    CodeBlockExtension: codeBlock.CodeBlockExtension,
    SyntaxHighlightExtension: syntaxHighlight.SyntaxHighlightExtension,
  };
};

/**
 * Lazy load markdown extensions
 */
export const loadMarkdownExtensions = async (): Promise<{
  MarkdownExtension: typeof import('./extensions/markdown/MarkdownExtension.js').MarkdownExtension;
}> => {
  const module = await import('./extensions/markdown/MarkdownExtension.js');

  return {
    MarkdownExtension: module.MarkdownExtension,
  };
};

/**
 * Lazy load search extension
 */
export const loadSearchExtension = async (): Promise<{
  SearchExtension: typeof import('./extensions/search/SearchExtension.js').SearchExtension;
}> => {
  const module = await import('./extensions/search/SearchExtension.js');
  return {
    SearchExtension: module.SearchExtension,
  };
};

/**
 * Lazy load media extensions
 */
export const loadMediaExtensions = async (): Promise<{
  ImageExtension: typeof import('./extensions/media/ImageExtension.js').ImageExtension;
}> => {
  const module = await import('./extensions/media/ImageExtension.js');
  return {
    ImageExtension: module.ImageExtension,
  };
};

/**
 * Lazy load performance extensions
 */
export const loadPerformanceExtensions = async (): Promise<{
  LazyLoadExtension: typeof import('./performance/LazyLoadExtension.js').LazyLoadExtension;
  VirtualScrollExtension: typeof import('./performance/VirtualScrollExtension.js').VirtualScrollExtension;
  DebounceExtension: typeof import('./performance/DebounceExtension.js').DebounceExtension;
  MemoizationExtension: typeof import('./performance/MemoizationExtension.js').MemoizationExtension;
}> => {
  const [lazyLoad, virtualScroll, debounce, memoization] = await Promise.all([
    import('./performance/LazyLoadExtension.js'),
    import('./performance/VirtualScrollExtension.js'),
    import('./performance/DebounceExtension.js'),
    import('./performance/MemoizationExtension.js'),
  ]);

  return {
    LazyLoadExtension: lazyLoad.LazyLoadExtension,
    VirtualScrollExtension: virtualScroll.VirtualScrollExtension,
    DebounceExtension: debounce.DebounceExtension,
    MemoizationExtension: memoization.MemoizationExtension,
  };
};

/**
 * Extension loader registry
 */
export const extensionLoaders = {
  collaboration: loadCollaborationExtensions,
  table: loadTableExtensions,
  code: loadCodeExtensions,
  markdown: loadMarkdownExtensions,
  search: loadSearchExtension,
  media: loadMediaExtensions,
  performance: loadPerformanceExtensions,
} as const;

/**
 * Extension group type
 */
export type ExtensionGroup = keyof typeof extensionLoaders;

/**
 * Preload extension group
 */
export const preloadExtensions = async (group: ExtensionGroup): Promise<void> => {
  await extensionLoaders[group]();
};

/**
 * Preload multiple extension groups
 */
export const preloadMultiple = async (groups: ExtensionGroup[]): Promise<void> => {
  await Promise.all(groups.map((group) => extensionLoaders[group]()));
};

/**
 * Preload all extensions
 */
export const preloadAll = async (): Promise<void> => {
  await Promise.all(Object.values(extensionLoaders).map((loader) => loader()));
};

/**
 * Extension loader factory
 * Creates a lazy loader for any extension
 */
export function createExtensionLoader<T extends IExtension>(
  importFn: () => Promise<{ default: new (...args: any[]) => T } | (new (...args: any[]) => T)>
): () => Promise<new (...args: any[]) => T> {
  let cached: (new (...args: any[]) => T) | undefined;

  return async () => {
    if (cached) {
      return cached;
    }

    const module = await importFn();
    cached = 'default' in module ? module.default : (module as any);
    return cached;
  };
}

/**
 * Code splitting boundaries
 *
 * These define the natural split points for the editor bundle:
 * 1. Core - Always loaded (base editor, basic marks/nodes)
 * 2. Essential - Loaded on demand (lists, basic formatting)
 * 3. Advanced - Lazy loaded (tables, collaboration, search)
 * 4. Optional - Lazy loaded (markdown, media)
 */
export const BUNDLE_BOUNDARIES = {
  /**
   * Core bundle - always loaded
   * Target: <20KB gzipped
   */
  core: [
    'EditorBridge',
    'ExtensionManager',
    'SchemaBuilder',
    'Extension',
    'BoldExtension',
    'ItalicExtension',
    'UnderlineExtension',
    'StrikeExtension',
    'LinkExtension',
  ],

  /**
   * Essential bundle - loaded on first interaction
   * Target: <15KB gzipped
   */
  essential: [
    'BulletListExtension',
    'OrderedListExtension',
    'ListItemExtension',
    'HeadingExtension',
    'BlockquoteExtension',
    'HorizontalRuleExtension',
  ],

  /**
   * Advanced bundle - loaded on demand
   * Target: <25KB gzipped
   */
  advanced: ['TableExtension', 'CodeBlockExtension', 'SearchExtension', 'CollaborationExtension'],

  /**
   * Optional bundle - loaded on demand
   * Target: <10KB gzipped
   */
  optional: ['MarkdownExtension', 'ImageExtension'],

  /**
   * Performance bundle - loaded during idle time
   * Target: <10KB gzipped
   */
  performance: ['LazyLoadExtension', 'VirtualScrollExtension', 'DebounceExtension', 'MemoizationExtension'],
} as const;

/**
 * Bundle size budget (gzipped)
 */
export const BUNDLE_SIZE_BUDGET = {
  core: 20 * 1024, // 20KB
  essential: 15 * 1024, // 15KB
  advanced: 25 * 1024, // 25KB
  optional: 10 * 1024, // 10KB
  performance: 10 * 1024, // 10KB
  total: 50 * 1024, // 50KB (core only, others are lazy)
} as const;
