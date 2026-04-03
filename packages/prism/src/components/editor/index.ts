/**
 * PrismEditor — Configurable rich text editor built on TipTap v3.
 *
 * @example
 * ```tsx
 * import { Editor } from '@omnitron-dev/prism/components/editor';
 *
 * // Full CMS editor
 * <Editor toolbar="full" value={html} onChange={setHtml} />
 *
 * // Blog post editor
 * <Editor toolbar="standard" placeholder="Write your article..." />
 *
 * // Comment editor
 * <Editor toolbar="compact" minHeight={80} />
 *
 * // Chat input
 * <Editor toolbar="chat" minHeight={40} maxHeight={200} />
 *
 * // Minimal inline
 * <Editor toolbar="minimal" minHeight={40} />
 *
 * // Custom toolbar
 * <Editor toolbar={{ items: ['bold', 'italic', 'link', 'image'], bubbleMenu: true }} />
 * ```
 *
 * @module @omnitron-dev/prism/components/editor
 */

export { Editor } from './editor.js';
export { editorClasses } from './classes.js';
export { resolveToolbar } from './presets.js';

// Types
export type {
  EditorProps,
  EditorOutputFormat,
  ToolbarPreset,
  ToolbarItem,
  ToolbarConfig,
  ResolvedToolbar,
  EditorToolbarProps,
  EditorToolbarItemProps,
} from './types.js';

// Extensions (re-export for advanced usage)
export { ClearFormat, TextTransform, type TextTransformValue } from './extensions/index.js';

// Icons (re-export for custom toolbars)
export {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikeIcon,
  InlineCodeIcon,
  CodeBlockIcon,
  H1Icon,
  H2Icon,
  H3Icon,
  H4Icon,
  H5Icon,
  H6Icon,
  ParagraphIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  AlignJustifyIcon,
  BulletListIcon,
  OrderedListIcon,
  CheckListIcon,
  QuoteIcon,
  HorizontalRuleIcon,
  TableIcon,
  LinkIcon,
  UnlinkIcon,
  ImageIcon,
  ClearMarksIcon,
  UndoIcon,
  RedoIcon,
  HardBreakIcon,
  FullscreenIcon,
  ExitFullscreenIcon,
} from './icons/index.js';

// Sub-components (for custom toolbar composition)
export { Toolbar } from './toolbar/toolbar.js';
export { BubbleToolbar } from './toolbar/bubble-toolbar.js';
export { ToolbarItem as EditorToolbarButton } from './toolbar/toolbar-item.js';
export { HeadingBlock } from './toolbar/heading-block.js';
export { LinkBlock } from './toolbar/link-block.js';
export { ImageBlock } from './toolbar/image-block.js';
export { CodeHighlightBlock } from './toolbar/code-highlight-block.js';
export { useToolbarState } from './toolbar/use-toolbar-state.js';
