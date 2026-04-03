import type { ToolbarItem, ToolbarConfig, ToolbarPreset, ResolvedToolbar } from './types.js';

// ---------------------------------------------------------------------------
// Preset definitions — which toolbar items each preset includes
// ---------------------------------------------------------------------------

const PRESET_ITEMS: Record<ToolbarPreset, ToolbarItem[]> = {
  /**
   * Full — CMS pages, blog articles, documentation.
   * Everything enabled including headings, alignment, code blocks, images.
   */
  full: [
    'heading',
    'bold',
    'italic',
    'underline',
    'strike',
    'code',
    'bulletList',
    'orderedList',
    'taskList',
    'alignLeft',
    'alignCenter',
    'alignRight',
    'alignJustify',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'link',
    'image',
    'hardBreak',
    'clearFormat',
    'undo',
    'redo',
    'fullscreen',
  ],

  /**
   * Standard — blog posts, forum discussions, product descriptions.
   * Most formatting without advanced alignment and task lists.
   */
  standard: [
    'heading',
    'bold',
    'italic',
    'underline',
    'strike',
    'bulletList',
    'orderedList',
    'blockquote',
    'codeBlock',
    'link',
    'image',
    'hardBreak',
    'clearFormat',
    'undo',
    'redo',
    'fullscreen',
  ],

  /**
   * Compact — comments, forum replies.
   * Basic formatting, links, code, no images/headings.
   */
  compact: [
    'bold',
    'italic',
    'underline',
    'strike',
    'code',
    'bulletList',
    'orderedList',
    'blockquote',
    'link',
    'clearFormat',
  ],

  /**
   * Minimal — quick feedback, short messages.
   * Only essential inline formatting.
   */
  minimal: ['bold', 'italic', 'code', 'link'],

  /**
   * Chat — messaging system.
   * Lightweight formatting, optimized for speed.
   */
  chat: ['bold', 'italic', 'strike', 'code', 'link', 'bulletList', 'orderedList', 'codeBlock'],

  /**
   * Inline — single-line fields (titles, captions).
   * No toolbar, no block-level elements.
   */
  inline: [],
};

/**
 * Whether each preset shows a bubble menu by default.
 */
const PRESET_BUBBLE_MENU: Record<ToolbarPreset, boolean> = {
  full: true,
  standard: true,
  compact: true,
  minimal: false,
  chat: false,
  inline: false,
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolveToolbar(config: ToolbarConfig | undefined): ResolvedToolbar {
  if (!config) {
    return resolveToolbar('standard');
  }

  if (typeof config === 'string') {
    return {
      items: new Set(PRESET_ITEMS[config]),
      bubbleMenu: PRESET_BUBBLE_MENU[config],
    };
  }

  return {
    items: new Set(config.items),
    bubbleMenu: config.bubbleMenu ?? false,
  };
}
