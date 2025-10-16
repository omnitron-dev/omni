/**
 * Advanced Editor Component
 *
 * A ProseMirror-based rich text editor with Aether signal integration
 *
 * @module components/editor
 */

// Main component
export { AdvancedEditor } from './AdvancedEditor.js';

// Core classes
export { Extension } from './core/Extension.js';
export { ExtensionManager } from './core/ExtensionManager.js';
export { SchemaBuilder } from './core/SchemaBuilder.js';
export { EditorBridge } from './core/EditorBridge.js';

// Types
export type {
  IExtension,
  ExtensionType,
  ExtensionOptions,
  SchemaContribution,
  EditorInstance,
  EditorSignals,
  EditorProps,
  ContentType,
  JSONContent,
  ParseOptions,
  SerializeOptions,
} from './core/types.js';

// Utilities
export {
  parseContent,
  serializeContent,
  serializeHTML,
  serializeJSON,
  serializeText,
  createEmptyDoc,
} from './utils/content.js';

export {
  setSelection,
  selectAll,
  selectStart,
  selectEnd,
  getSelectionStart,
  getSelectionEnd,
  isSelectionEmpty,
  getSelectionText,
  isMultiBlockSelection,
  getSelectionDepth,
} from './utils/selection.js';

export {
  canExecuteCommand,
  executeCommand,
  undoCommand,
  redoCommand,
  insertText,
  deleteSelection,
  insertNode,
  selectAllCommand,
} from './utils/commands.js';

// Signal utilities
export { createEditorSignals, updateEditorSignals } from './signals/editorSignals.js';

export {
  isDocumentEmpty,
  countWords,
  countCharacters,
  canUndoCommand,
  canRedoCommand,
  getActiveMarks,
  getCurrentNodeType,
  getSelectedText,
  computeDerivedState,
} from './signals/derivedSignals.js';

// Commands
export { CommandManager, ChainedCommands } from './commands/index.js';

// Components
export {
  Toolbar,
  ToolbarButton,
  LinkEditor,
  BubbleMenu,
  Statusbar,
  SearchPanel,
  getDefaultToolbarItems,
  getDefaultBubbleMenuItems,
  getDefaultStatusbarItems,
} from './components/index.js';
export type {
  ToolbarProps,
  ToolbarItem,
  ToolbarButtonConfig,
  ToolbarDropdown,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarButtonProps,
  LinkEditorProps,
  BubbleMenuProps,
  BubbleMenuItem,
  StatusbarProps,
  StatusbarItem,
  StatusbarText,
  StatusbarButton,
  StatusbarCustom,
  SearchPanelProps,
} from './components/index.js';

// Behavior extensions
export {
  HistoryExtension,
  PlaceholderExtension,
  DropCursorExtension,
  GapCursorExtension,
} from './extensions/behavior/index.js';
export type {
  HistoryOptions,
  PlaceholderOptions,
  DropCursorOptions,
} from './extensions/behavior/index.js';

// Search extension
export { SearchExtension } from './extensions/search/index.js';
export type { SearchOptions, SearchResult } from './extensions/search/index.js';

// Table extensions
export {
  TableExtension,
  TableRowExtension,
  TableCellExtension,
  TableHeaderExtension,
} from './extensions/table/index.js';
export type {
  TableOptions,
  TableCellOptions,
  TableHeaderOptions,
} from './extensions/table/index.js';

// Media extensions
export { LinkExtension, ImageExtension } from './extensions/media/index.js';
export type { LinkOptions, ImageOptions } from './extensions/media/index.js';

// Code extensions
export { CodeBlockExtension, SyntaxHighlightExtension } from './extensions/code/index.js';
export type { CodeBlockOptions, SyntaxHighlightOptions } from './extensions/code/index.js';

// Markdown extension
export { MarkdownExtension, parseMarkdown, serializeToMarkdown } from './extensions/markdown/index.js';
export type { MarkdownOptions } from './extensions/markdown/index.js';

// Markdown preview component
export { MarkdownPreview, markdownPreviewStyles } from './components/MarkdownPreview.js';
export type { MarkdownPreviewProps } from './components/MarkdownPreview.js';

// Collaboration extensions
export {
  CollaborationExtension,
  CollaborationCursorExtension,
} from './extensions/collaboration/index.js';
export type {
  CollaborationOptions,
  CollaborationCursorOptions,
  User,
  AwarenessState,
} from './extensions/collaboration/index.js';

// Performance extensions
export {
  LazyLoadExtension,
  VirtualScrollExtension,
  DebounceExtension,
  MemoizationExtension,
} from './performance/index.js';
export type {
  ExtensionLoader,
  ExtensionLoadingState,
  PreloadStrategy,
  LazyExtensionConfig,
  LazyLoadConfig,
  VirtualScrollConfig,
  DebounceOperation,
  OperationDebounceConfig,
  DebounceConfig,
  MemoizationConfig,
} from './performance/index.js';

// Performance utilities
export {
  performanceTracker,
  Timing,
  AsyncTiming,
  measureRender,
  measureRenderAsync,
  createPerformanceReport,
} from './utils/performance.js';
export type {
  PerformanceMark,
  PerformanceMeasure,
  PerformanceBudget,
  PerformanceMetrics,
  MemoryUsage,
  BudgetViolation,
} from './utils/performance.js';

export {
  requestIdleCallback,
  cancelIdleCallback,
  scheduleIdleTask,
  RAFScheduler,
  BatchExecutor,
  throttle,
  debounce,
  IntersectionObserverUtil,
  waitForVisible,
  lazyLoad,
  rafScheduler,
} from './utils/optimization.js';
export type { IdleCallbackOptions, IdleDeadline } from './utils/optimization.js';

export { EditorProfiler, editorProfiler, Profile } from './utils/profiler.js';
export type {
  ProfileEntry,
  TransactionProfile,
  PluginProfile,
  RenderProfile,
  MemoryProfile,
  ProfilerConfig,
  ProfilerStats,
} from './utils/profiler.js';

// Lazy imports
export {
  loadCollaborationExtensions,
  loadTableExtensions,
  loadCodeExtensions,
  loadMarkdownExtensions,
  loadSearchExtension,
  loadMediaExtensions,
  loadPerformanceExtensions,
  extensionLoaders,
  preloadExtensions,
  preloadMultiple,
  preloadAll,
  createExtensionLoader,
  BUNDLE_BOUNDARIES,
  BUNDLE_SIZE_BUDGET,
} from './lazy-imports.js';
export type { ExtensionGroup } from './lazy-imports.js';

// Theme system
export {
  ThemeManager,
  getThemeManager,
  resetThemeManager,
  defaultTheme,
  minimalTheme,
  githubTheme,
  darkTheme,
  highContrastTheme,
  allThemes,
  themeRegistry,
  getThemeByName,
  getThemeNames,
  ThemePicker,
  themePickerStyles,
} from './theming/index.js';
export type {
  Theme,
  ThemeMetadata,
  ThemeColorPalette,
  ThemeTypography,
  ThemeSpacing,
  ThemeBorderRadius,
  ThemeShadows,
  ThemeZIndex,
  ThemeAnimation,
  ThemeBreakpoints,
  ThemeConfig,
  ThemeChangeEvent,
  ThemeValidationResult,
  ContrastCheckResult,
  ThemePreview,
  CSSCustomProperties,
  ThemePickerProps,
} from './theming/index.js';

// Accessibility
export {
  AriaLive,
  createAriaLiveAnnouncer,
  KeyboardNavigationExtension,
  FocusManager,
  createFocusManager,
} from './accessibility/index.js';
export type {
  AriaLiveProps,
  AriaLivePoliteness,
  AriaLiveMessage,
  AriaLiveOptions,
  KeyboardNavigationOptions,
  FocusManagerOptions,
  FocusableElement,
} from './accessibility/index.js';

// Mobile Support
export {
  TouchHandlerExtension,
  MobileToolbar,
  getDefaultMobileToolbarItems,
  mobileToolbarStyles,
  VirtualKeyboardExtension,
} from './mobile/index.js';
export type {
  TouchHandlerOptions,
  MobileToolbarProps,
  MobileToolbarGroup,
  VirtualKeyboardOptions,
} from './mobile/index.js';

// Styles
export { responsiveCss, accessibilityCss } from './styles/index.js';
