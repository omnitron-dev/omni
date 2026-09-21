import type { BoxProps } from '@mui/material/Box';
import type { Theme, SxProps } from '@mui/material/styles';
import type { Editor, UseEditorOptions } from '@tiptap/react';
import type { ButtonBaseProps } from '@mui/material/ButtonBase';

// ---------------------------------------------------------------------------
// Toolbar presets — define which toolbar items are visible per use case
// ---------------------------------------------------------------------------

export type ToolbarPreset = 'full' | 'standard' | 'compact' | 'minimal' | 'chat' | 'inline';

/**
 * Individual toolbar items that can be toggled on/off.
 */
export type ToolbarItem =
  // Text formatting
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  // Headings
  | 'heading'
  // Lists
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  // Alignment
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  // Block elements
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'
  // Media & links
  | 'link'
  | 'image'
  // Utilities
  | 'hardBreak'
  | 'clearFormat'
  | 'undo'
  | 'redo'
  | 'fullscreen';

/**
 * Toolbar configuration — either use a preset name or provide explicit items.
 */
export type ToolbarConfig = ToolbarPreset | { items: ToolbarItem[]; bubbleMenu?: boolean };

/**
 * Resolved toolbar shape used internally.
 */
export interface ResolvedToolbar {
  items: Set<ToolbarItem>;
  bubbleMenu: boolean;
}

// ---------------------------------------------------------------------------
// Editor component props
// ---------------------------------------------------------------------------

export type EditorOutputFormat = 'html' | 'json';

export type EditorProps = Omit<UseEditorOptions, 'extensions' | 'content'> & {
  /** HTML string or TipTap JSON document */
  value?: string;
  /** Controlled onChange — receives HTML string or JSON string depending on `format` */
  onChange?: (value: string) => void;
  /** Output format: 'html' returns HTML string, 'json' returns stringified TipTap JSON. @default 'json' */
  format?: EditorOutputFormat;
  /** Error state */
  error?: boolean;
  /** Helper text displayed below the editor */
  helperText?: React.ReactNode;
  /** Placeholder text */
  placeholder?: string;
  /** Toolbar preset or explicit config. @default 'standard' */
  toolbar?: ToolbarConfig;
  /** Enable bubble menu (floating toolbar on selection). @default true for standard+ */
  bubbleMenu?: boolean;
  /** Min height of editor content area in px. @default 160 */
  minHeight?: number;
  /** Max height of editor content area in px (enables scroll). @default undefined */
  maxHeight?: number;
  /** Whether content is editable. @default true */
  editable?: boolean;
  /** Reset content when value becomes empty. @default false */
  resetValue?: boolean;
  /** Additional TipTap extensions to merge with preset */
  extraExtensions?: UseEditorOptions['extensions'];
  /** CSS class name */
  className?: string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Slot props for wrapper */
  slotProps?: {
    wrapper?: BoxProps;
  };
  /** Ref to the content container */
  ref?: React.RefObject<HTMLDivElement | null> | React.RefCallback<HTMLDivElement | null>;
  /** Accessible names for the toolbar controls. Partial — anything omitted
   *  keeps its English default. See {@link EditorLabels}. */
  labels?: Partial<EditorLabels>;
};

// ---------------------------------------------------------------------------
// Toolbar labels
// ---------------------------------------------------------------------------

/**
 * Accessible names for every toolbar control, so a consumer can localise them.
 *
 * They were hardcoded English, which is fine for a design system's default and
 * not fine on a Russian-first product: the editor is on every content form —
 * a post, a community description, an organisation profile, a shop — and every
 * tooltip in it read "Bold", "Insert link", "Fullscreen" next to Russian field
 * labels. The names are also the ONLY text a screen reader gets for these
 * buttons, so an English default is a localisation gap in the accessibility
 * tree, not just in the tooltip.
 *
 * Defaults keep the previous strings verbatim, so a consumer that passes
 * nothing is unchanged.
 */
export type EditorLabels = {
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  inlineCode: string;
  clearFormat: string;
  headingMenu: string;
  bulletList: string;
  orderedList: string;
  taskList: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  blockquote: string;
  codeBlock: string;
  horizontalRule: string;
  insertLink: string;
  removeLink: string;
  insertImage: string;
  hardBreak: string;
  undo: string;
  redo: string;
  fullscreen: string;
  exitFullscreen: string;
  /** The two popovers carry visible text of their own, not just icons. */
  linkUrlField: string;
  linkApply: string;
  imagePopoverTitle: string;
  imageUrlField: string;
  imageAltField: string;
  imageApply: string;
  /** The code block's language picker, whose first option is a word. */
  codeLanguageAuto: string;
};

/** The strings the toolbar used before `labels` existed. */
export const DEFAULT_EDITOR_LABELS: EditorLabels = {
  bold: 'Bold (⌘B)',
  italic: 'Italic (⌘I)',
  underline: 'Underline (⌘U)',
  strike: 'Strikethrough',
  inlineCode: 'Inline code (⌘E)',
  clearFormat: 'Clear format (⌘⇧X)',
  headingMenu: 'Heading menu',
  bulletList: 'Bullet list',
  orderedList: 'Ordered list',
  taskList: 'Task list',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  alignJustify: 'Align justify',
  blockquote: 'Blockquote',
  codeBlock: 'Code block',
  horizontalRule: 'Horizontal rule',
  insertLink: 'Insert link',
  removeLink: 'Remove link',
  insertImage: 'Insert image',
  hardBreak: 'Hard break',
  undo: 'Undo (⌘Z)',
  redo: 'Redo (⌘⇧Z)',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  linkUrlField: 'Link URL',
  linkApply: 'Apply',
  imagePopoverTitle: 'Add image',
  imageUrlField: 'Image URL',
  imageAltField: 'Alt text',
  imageApply: 'Apply',
  codeLanguageAuto: 'auto',
};

// ---------------------------------------------------------------------------
// Toolbar sub-component props
// ---------------------------------------------------------------------------

export type EditorToolbarProps = {
  editor: Editor;
  toolbar: ResolvedToolbar;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  labels: EditorLabels;
};

export type EditorToolbarItemProps = ButtonBaseProps & {
  label?: string;
  active?: boolean;
  icon?: React.ReactNode;
};
