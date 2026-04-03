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
};

// ---------------------------------------------------------------------------
// Toolbar sub-component props
// ---------------------------------------------------------------------------

export type EditorToolbarProps = {
  editor: Editor;
  toolbar: ResolvedToolbar;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
};

export type EditorToolbarItemProps = ButtonBaseProps & {
  label?: string;
  active?: boolean;
  icon?: React.ReactNode;
};
