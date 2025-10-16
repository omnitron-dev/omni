/**
 * MarkdownEditor.example.ts
 *
 * A markdown-focused editor with live preview demonstrating markdown input rules and rendering.
 * This example showcases the editor's markdown capabilities with a split-pane interface.
 *
 * Features demonstrated:
 * - Markdown input rules (typing shortcuts)
 * - Live markdown preview
 * - Split-pane layout (editor + preview)
 * - Markdown paste handling
 * - Export to markdown
 * - GitHub Flavored Markdown (GFM) support
 * - Task lists
 * - Tables in markdown
 * - Markdown-specific toolbar
 * - Sync scrolling between editor and preview
 * - Toggle preview visibility
 *
 * Usage:
 * ```typescript
 * import { createMarkdownEditor } from './MarkdownEditor.example';
 * const editor = createMarkdownEditor(document.getElementById('editor'), {
 *   content: '# Hello\n\nThis is **markdown**!',
 *   showPreview: true,
 *   syncScroll: true
 * });
 * ```
 */

import { EditorBridge } from '../../src/components/editor/core/EditorBridge.js';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';
import type { WritableSignal } from '../../src/core/reactivity/types.js';

// Import all necessary extensions for markdown editing
import { ParagraphExtension } from '../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { HeadingExtension } from '../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { BlockquoteExtension } from '../../src/components/editor/extensions/nodes/BlockquoteExtension.js';
import { HorizontalRuleExtension } from '../../src/components/editor/extensions/nodes/HorizontalRuleExtension.js';

// Import mark extensions
import {
  BoldExtension,
  ItalicExtension,
  StrikeExtension,
  CodeExtension,
} from '../../src/components/editor/extensions/marks/index.js';

// Import list extensions
import {
  BulletListExtension,
  OrderedListExtension,
  ListItemExtension,
  TaskListExtension,
  TaskItemExtension,
} from '../../src/components/editor/extensions/lists/index.js';

// Import media extensions
import { LinkExtension, ImageExtension } from '../../src/components/editor/extensions/media/index.js';

// Import table extensions
import {
  TableExtension,
  TableRowExtension,
  TableCellExtension,
  TableHeaderExtension,
} from '../../src/components/editor/extensions/table/index.js';

// Import code extension
import { CodeBlockExtension } from '../../src/components/editor/extensions/code/index.js';

// Import behavior extensions
import {
  HistoryExtension,
  PlaceholderExtension,
} from '../../src/components/editor/extensions/behavior/index.js';

// Import markdown extension
import {
  MarkdownExtension,
  parseMarkdown,
  serializeToMarkdown,
} from '../../src/components/editor/extensions/markdown/index.js';

// Import markdown preview component
import { MarkdownPreview } from '../../src/components/editor/components/MarkdownPreview.js';

import type { EditorInstance } from '../../src/components/editor/core/types.js';

/**
 * Configuration options for the markdown editor
 */
export interface MarkdownEditorOptions {
  /**
   * Initial markdown content
   */
  content?: string;

  /**
   * Whether the editor should be editable
   * @default true
   */
  editable?: boolean;

  /**
   * Whether to autofocus the editor
   * @default false
   */
  autofocus?: boolean;

  /**
   * Placeholder text when editor is empty
   * @default 'Start writing in markdown...'
   */
  placeholder?: string;

  /**
   * Whether to show the preview pane
   * @default true
   */
  showPreview?: boolean;

  /**
   * Whether to sync scrolling between editor and preview
   * @default true
   */
  syncScroll?: boolean;

  /**
   * Preview pane position
   * @default 'right'
   */
  previewPosition?: 'right' | 'bottom';

  /**
   * Whether to show the toolbar
   * @default true
   */
  showToolbar?: boolean;

  /**
   * Whether to enable GitHub Flavored Markdown
   * @default true
   */
  enableGFM?: boolean;

  /**
   * Custom CSS class for the container
   */
  containerClass?: string;

  /**
   * Custom CSS class for the editor
   */
  editorClass?: string;

  /**
   * Callback when content changes
   */
  onUpdate?: (editor: EditorInstance, markdown: string) => void;
}

/**
 * Return type for createMarkdownEditor
 */
export interface MarkdownEditorInstance {
  /**
   * The underlying editor instance
   */
  editor: EditorInstance;

  /**
   * Get content as markdown
   */
  getMarkdown(): string;

  /**
   * Get content as HTML
   */
  getHTML(): string;

  /**
   * Set markdown content
   */
  setMarkdown(markdown: string): void;

  /**
   * Clear all content
   */
  clearContent(): void;

  /**
   * Toggle preview visibility
   */
  togglePreview(): void;

  /**
   * Get preview visibility state
   */
  isPreviewVisible(): boolean;

  /**
   * Export as markdown file
   */
  exportAsMarkdown(filename?: string): void;

  /**
   * Focus the editor
   */
  focus(): void;

  /**
   * Destroy the editor
   */
  destroy(): void;

  /**
   * Get the container element
   */
  getElement(): HTMLElement;
}

/**
 * Creates a markdown editor with live preview
 *
 * This editor is specifically designed for:
 * - Writing markdown documentation
 * - Technical writing
 * - Blog posts in markdown
 * - README files
 * - GitHub-style markdown content
 *
 * @param container - The DOM element to mount the editor in
 * @param options - Configuration options
 * @returns An object with the editor instance and helper methods
 *
 * @example
 * ```typescript
 * // Create a markdown editor with preview
 * const editor = createMarkdownEditor(document.getElementById('editor'), {
 *   content: '# My Document\n\nWrite **markdown** here!',
 *   showPreview: true,
 *   enableGFM: true
 * });
 *
 * // Get markdown content
 * const markdown = editor.getMarkdown();
 *
 * // Export to file
 * editor.exportAsMarkdown('document.md');
 *
 * // Toggle preview
 * editor.togglePreview();
 * ```
 */
export function createMarkdownEditor(
  container: HTMLElement,
  options: MarkdownEditorOptions = {}
): MarkdownEditorInstance {
  // Destructure options with defaults
  const {
    content = '',
    editable = true,
    autofocus = false,
    placeholder = 'Start writing in markdown...',
    showPreview: initialShowPreview = true,
    syncScroll = true,
    previewPosition = 'right',
    showToolbar = true,
    enableGFM = true,
    containerClass = 'markdown-editor-container',
    editorClass = 'markdown-editor',
    onUpdate,
  } = options;

  // Create reactive signals
  const showPreview: WritableSignal<boolean> = signal(initialShowPreview);
  const markdownContent: WritableSignal<string> = signal(content);

  // Create the main container
  const wrapper = document.createElement('div');
  wrapper.className = containerClass;
  wrapper.setAttribute('data-preview-position', previewPosition);
  container.appendChild(wrapper);

  // Create toolbar (if enabled)
  let toolbarElement: HTMLElement | null = null;
  if (showToolbar) {
    toolbarElement = document.createElement('div');
    toolbarElement.className = 'md-toolbar';
    wrapper.appendChild(toolbarElement);
  }

  // Create split pane container
  const splitPane = document.createElement('div');
  splitPane.className = 'md-split-pane';
  wrapper.appendChild(splitPane);

  // Create editor pane
  const editorPane = document.createElement('div');
  editorPane.className = 'md-editor-pane';
  splitPane.appendChild(editorPane);

  // Create preview pane (if enabled)
  let previewPane: HTMLElement | null = null;
  let previewContent: HTMLElement | null = null;
  if (initialShowPreview) {
    previewPane = document.createElement('div');
    previewPane.className = 'md-preview-pane';

    const previewHeader = document.createElement('div');
    previewHeader.className = 'md-preview-header';
    previewHeader.textContent = 'Preview';
    previewPane.appendChild(previewHeader);

    previewContent = document.createElement('div');
    previewContent.className = 'md-preview-content';
    previewPane.appendChild(previewContent);

    splitPane.appendChild(previewPane);
  }

  // Define comprehensive extension set for markdown
  const extensions = [
    // Basic structure
    new ParagraphExtension(),

    // Markdown extension (provides input rules and paste handling)
    new MarkdownExtension({
      // Enable GitHub Flavored Markdown
      gfm: enableGFM,
      // Enable all markdown features
      breaks: true, // Convert line breaks to <br>
      linkify: true, // Auto-detect and linkify URLs
      typographer: true, // Smart quotes and other typography
    }),

    // Headings (supports # syntax)
    new HeadingExtension({ levels: [1, 2, 3, 4, 5, 6] }),

    // Text formatting marks (supports **bold**, *italic*, etc.)
    new BoldExtension(), // **bold** or __bold__
    new ItalicExtension(), // *italic* or _italic_
    new StrikeExtension(), // ~~strikethrough~~
    new CodeExtension(), // `inline code`

    // Block elements
    new BlockquoteExtension(), // > blockquote
    new HorizontalRuleExtension(), // --- or ***

    // Lists (supports - or * for bullets, 1. for ordered)
    new BulletListExtension(), // - item or * item
    new OrderedListExtension(), // 1. item
    new ListItemExtension(),

    // Task lists (GFM feature)
    new TaskListExtension(), // - [ ] unchecked
    new TaskItemExtension(), // - [x] checked

    // Code blocks (supports ```language syntax)
    new CodeBlockExtension({
      defaultLanguage: 'plaintext',
      languageClassPrefix: 'language-',
    }),

    // Links and images
    new LinkExtension({
      openOnClick: false, // Don't open links in editor
      autolink: true,
    }), // [text](url)
    new ImageExtension({
      inline: false,
      allowBase64: true,
    }), // ![alt](url)

    // Tables (GFM feature)
    new TableExtension({
      resizable: false, // Keep columns fixed for markdown
    }),
    new TableRowExtension(),
    new TableCellExtension(),
    new TableHeaderExtension(),

    // Behavior
    new HistoryExtension({
      depth: 100,
      newGroupDelay: 500,
    }),
    new PlaceholderExtension({
      placeholder,
    }),
  ];

  // Create the editor instance
  const editor = new EditorBridge(editorPane, {
    // Parse markdown content into editor
    content,
    contentType: 'markdown',

    // Configuration
    extensions,
    editable,
    autofocus,

    // Styling
    editorClass,

    // Event handlers
    onCreate: (instance) => {
      console.log('Markdown editor created');

      // Initialize toolbar if enabled
      if (showToolbar && toolbarElement) {
        initializeMarkdownToolbar(toolbarElement, instance, showPreview);
      }

      // Initialize preview if enabled
      if (previewContent) {
        updatePreview(previewContent, content);
      }

      // Set up sync scrolling if enabled
      if (syncScroll && previewContent) {
        setupSyncScroll(editorPane, previewContent);
      }
    },

    onUpdate: ({ editor: editorInstance }) => {
      // Serialize to markdown
      const markdown = serializeToMarkdown(editorInstance.state.doc);
      markdownContent.set(markdown);

      // Update preview
      if (previewContent) {
        updatePreview(previewContent, markdown);
      }

      // Call user's callback
      if (onUpdate) {
        onUpdate(editorInstance, markdown);
      }
    },
  });

  // Watch for preview visibility changes
  effect(() => {
    if (showPreview() && !previewPane) {
      // Show preview
      previewPane = document.createElement('div');
      previewPane.className = 'md-preview-pane';

      const previewHeader = document.createElement('div');
      previewHeader.className = 'md-preview-header';
      previewHeader.textContent = 'Preview';
      previewPane.appendChild(previewHeader);

      previewContent = document.createElement('div');
      previewContent.className = 'md-preview-content';
      previewPane.appendChild(previewContent);

      splitPane.appendChild(previewPane);

      // Update with current content
      updatePreview(previewContent, markdownContent());
    } else if (!showPreview() && previewPane) {
      // Hide preview
      previewPane.remove();
      previewPane = null;
      previewContent = null;
    }
  });

  // Apply styles
  applyMarkdownEditorStyles();

  // Return the public API
  return {
    // Expose the raw editor instance
    editor,

    // Content methods
    getMarkdown: () => {
      return serializeToMarkdown(editor.state.doc);
    },

    getHTML: () => {
      return editor.getHTML();
    },

    setMarkdown: (markdown: string) => {
      editor.setContent(markdown, 'markdown');
      markdownContent.set(markdown);
    },

    clearContent: () => {
      editor.clearContent();
      markdownContent.set('');
    },

    // Preview methods
    togglePreview: () => {
      showPreview.set(!showPreview());
    },

    isPreviewVisible: () => {
      return showPreview();
    },

    // Export methods
    exportAsMarkdown: (filename: string = 'document.md') => {
      const markdown = serializeToMarkdown(editor.state.doc);
      downloadAsFile(markdown, filename, 'text/markdown');
    },

    // Focus methods
    focus: () => {
      editor.focus();
    },

    // Lifecycle
    destroy: () => {
      editor.destroy();
      wrapper.remove();
    },

    // DOM access
    getElement: () => wrapper,
  };
}

/**
 * Initialize markdown-specific toolbar
 */
function initializeMarkdownToolbar(
  container: HTMLElement,
  editor: EditorInstance,
  previewVisible: WritableSignal<boolean>
): void {
  // Define markdown toolbar buttons
  const toolbarButtons = [
    { label: 'B', title: 'Bold (**text**)', command: 'bold' },
    { label: 'I', title: 'Italic (*text*)', command: 'italic' },
    { label: 'S', title: 'Strikethrough (~~text~~)', command: 'strike' },
    { label: '</>', title: 'Inline Code (`code`)', command: 'code' },
    { type: 'divider' as const },
    { label: 'H1', title: 'Heading 1 (# text)', command: 'heading', args: [{ level: 1 }] },
    { label: 'H2', title: 'Heading 2 (## text)', command: 'heading', args: [{ level: 2 }] },
    { label: 'H3', title: 'Heading 3 (### text)', command: 'heading', args: [{ level: 3 }] },
    { type: 'divider' as const },
    { label: '•', title: 'Bullet List (- item)', command: 'bulletList' },
    { label: '1.', title: 'Ordered List (1. item)', command: 'orderedList' },
    { label: '☑', title: 'Task List (- [ ] task)', command: 'taskList' },
    { type: 'divider' as const },
    { label: '❝', title: 'Blockquote (> text)', command: 'blockquote' },
    { label: '🔗', title: 'Link ([text](url))', command: 'link' },
    { label: '🖼', title: 'Image (![alt](url))', command: 'image' },
    { label: '⊞', title: 'Table', command: 'insertTable' },
    { type: 'divider' as const },
    { label: '👁', title: 'Toggle Preview', action: () => previewVisible.set(!previewVisible()) },
  ];

  // Build toolbar
  toolbarButtons.forEach((btn) => {
    if (btn.type === 'divider') {
      const divider = document.createElement('div');
      divider.className = 'md-toolbar-divider';
      container.appendChild(divider);
    } else {
      const button = document.createElement('button');
      button.className = 'md-toolbar-btn';
      button.textContent = btn.label;
      button.title = btn.title;

      button.addEventListener('click', () => {
        if (btn.action) {
          btn.action();
        } else if (editor.commands && btn.command) {
          if (btn.args) {
            editor.commands.execute(btn.command, ...btn.args);
          } else {
            editor.commands.execute(btn.command);
          }
          editor.focus();
        }
      });

      container.appendChild(button);
    }
  });

  // Add markdown syntax guide button
  const guideBtn = document.createElement('button');
  guideBtn.className = 'md-toolbar-btn md-guide-btn';
  guideBtn.textContent = '?';
  guideBtn.title = 'Markdown Syntax Guide';
  guideBtn.addEventListener('click', () => showMarkdownGuide());
  container.appendChild(guideBtn);
}

/**
 * Update preview with rendered markdown
 */
function updatePreview(container: HTMLElement, markdown: string): void {
  // In a real implementation, this would use a markdown parser
  // like marked, markdown-it, or remark
  // For this example, we'll do basic HTML escaping and formatting
  const html = renderMarkdownToHTML(markdown);
  container.innerHTML = html;
}

/**
 * Basic markdown to HTML renderer (simplified)
 * In production, use a proper markdown library
 */
function renderMarkdownToHTML(markdown: string): string {
  // This is a very simplified renderer for demonstration
  // In production, use marked, markdown-it, or similar library
  let html = markdown;

  // Headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // Inline code
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

/**
 * Set up synchronized scrolling between editor and preview
 */
function setupSyncScroll(editorPane: HTMLElement, previewPane: HTMLElement): void {
  let isScrolling = false;

  editorPane.addEventListener('scroll', () => {
    if (isScrolling) return;
    isScrolling = true;

    // Calculate scroll percentage
    const scrollPercentage =
      editorPane.scrollTop / (editorPane.scrollHeight - editorPane.clientHeight);

    // Apply to preview
    previewPane.scrollTop = scrollPercentage * (previewPane.scrollHeight - previewPane.clientHeight);

    setTimeout(() => {
      isScrolling = false;
    }, 100);
  });

  previewPane.addEventListener('scroll', () => {
    if (isScrolling) return;
    isScrolling = true;

    // Calculate scroll percentage
    const scrollPercentage =
      previewPane.scrollTop / (previewPane.scrollHeight - previewPane.clientHeight);

    // Apply to editor
    editorPane.scrollTop = scrollPercentage * (editorPane.scrollHeight - editorPane.clientHeight);

    setTimeout(() => {
      isScrolling = false;
    }, 100);
  });
}

/**
 * Download content as file
 */
function downloadAsFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Show markdown syntax guide
 */
function showMarkdownGuide(): void {
  const guide = `
# Markdown Syntax Guide

## Headings
# H1
## H2
### H3

## Text Formatting
**Bold** or __Bold__
*Italic* or _Italic_
~~Strikethrough~~
\`Inline code\`

## Lists
- Bullet list item
  - Nested item

1. Ordered list item
2. Another item

- [ ] Task item
- [x] Completed task

## Links & Images
[Link text](https://example.com)
![Image alt](https://example.com/image.jpg)

## Blockquote
> This is a blockquote

## Code Block
\`\`\`javascript
const code = true;
\`\`\`

## Table
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |

## Horizontal Rule
---
  `;

  alert(guide);
}

/**
 * Apply comprehensive styles for the markdown editor
 */
function applyMarkdownEditorStyles(): void {
  const styleId = 'markdown-editor-styles';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Container */
      .markdown-editor-container {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
      }

      /* Toolbar */
      .md-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        flex-wrap: wrap;
      }

      .md-toolbar-btn {
        padding: 6px 10px;
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        color: #374151;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }

      .md-toolbar-btn:hover {
        background: #e5e7eb;
      }

      .md-toolbar-divider {
        width: 1px;
        height: 24px;
        background: #d1d5db;
        margin: 0 4px;
      }

      .md-guide-btn {
        margin-left: auto;
        background: #3b82f6;
        color: white;
      }

      .md-guide-btn:hover {
        background: #2563eb;
      }

      /* Split pane */
      .md-split-pane {
        display: flex;
        height: 500px;
      }

      .markdown-editor-container[data-preview-position="bottom"] .md-split-pane {
        flex-direction: column;
      }

      /* Editor pane */
      .md-editor-pane {
        flex: 1;
        overflow: auto;
        padding: 16px;
      }

      .markdown-editor {
        outline: none;
      }

      .markdown-editor .ProseMirror {
        outline: none;
        min-height: 100%;
      }

      /* Preview pane */
      .md-preview-pane {
        flex: 1;
        border-left: 1px solid #e5e7eb;
        display: flex;
        flex-direction: column;
        background: #fafafa;
      }

      .markdown-editor-container[data-preview-position="bottom"] .md-preview-pane {
        border-left: none;
        border-top: 1px solid #e5e7eb;
      }

      .md-preview-header {
        padding: 8px 16px;
        background: #f3f4f6;
        border-bottom: 1px solid #e5e7eb;
        font-weight: 600;
        font-size: 13px;
        color: #6b7280;
      }

      .md-preview-content {
        flex: 1;
        overflow: auto;
        padding: 16px;
      }

      /* Preview typography */
      .md-preview-content h1 { font-size: 2em; font-weight: 700; margin: 0.67em 0; }
      .md-preview-content h2 { font-size: 1.5em; font-weight: 600; margin: 0.75em 0; }
      .md-preview-content h3 { font-size: 1.25em; font-weight: 600; margin: 0.83em 0; }

      .md-preview-content p { margin: 0.75em 0; }

      .md-preview-content strong { font-weight: 700; }
      .md-preview-content em { font-style: italic; }
      .md-preview-content del { text-decoration: line-through; }

      .md-preview-content code {
        background: #f3f4f6;
        padding: 2px 6px;
        border-radius: 3px;
        font-family: 'Monaco', 'Courier New', monospace;
        font-size: 0.9em;
      }

      .md-preview-content a {
        color: #2563eb;
        text-decoration: underline;
      }

      .md-preview-content ul,
      .md-preview-content ol {
        padding-left: 1.5em;
        margin: 0.75em 0;
      }

      /* Editor markdown styles */
      .markdown-editor h1 { font-size: 2em; font-weight: 700; margin: 0.67em 0; }
      .markdown-editor h2 { font-size: 1.5em; font-weight: 600; margin: 0.75em 0; }
      .markdown-editor h3 { font-size: 1.25em; font-weight: 600; margin: 0.83em 0; }
      .markdown-editor h4 { font-size: 1.1em; font-weight: 600; margin: 1em 0; }
      .markdown-editor h5 { font-size: 1em; font-weight: 600; margin: 1.17em 0; }
      .markdown-editor h6 { font-size: 0.875em; font-weight: 600; margin: 1.33em 0; }

      .markdown-editor p {
        margin: 0.75em 0;
      }

      .markdown-editor blockquote {
        border-left: 3px solid #d1d5db;
        padding-left: 16px;
        margin: 1em 0;
        color: #6b7280;
      }

      .markdown-editor code {
        background: #f3f4f6;
        padding: 2px 6px;
        border-radius: 3px;
        font-family: 'Monaco', 'Courier New', monospace;
        font-size: 0.9em;
      }

      .markdown-editor pre {
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 16px;
        border-radius: 4px;
        overflow: auto;
        margin: 1em 0;
      }

      .markdown-editor pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }

      .markdown-editor ul,
      .markdown-editor ol {
        padding-left: 1.5em;
        margin: 0.75em 0;
      }

      .markdown-editor li {
        margin: 0.25em 0;
      }

      .markdown-editor hr {
        border: none;
        border-top: 2px solid #e5e7eb;
        margin: 2em 0;
      }

      .markdown-editor a {
        color: #2563eb;
        text-decoration: underline;
      }

      .markdown-editor img {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
      }

      .markdown-editor table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
      }

      .markdown-editor th,
      .markdown-editor td {
        border: 1px solid #d1d5db;
        padding: 8px 12px;
        text-align: left;
      }

      .markdown-editor th {
        background: #f9fafb;
        font-weight: 600;
      }

      /* Scrollbar styling */
      .md-editor-pane::-webkit-scrollbar,
      .md-preview-content::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      .md-editor-pane::-webkit-scrollbar-track,
      .md-preview-content::-webkit-scrollbar-track {
        background: #f1f1f1;
      }

      .md-editor-pane::-webkit-scrollbar-thumb,
      .md-preview-content::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * HTML fixture for testing the markdown editor
 */
export const markdownEditorHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Editor Example</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 1200px;
      margin: 40px auto;
      padding: 20px;
      background: #f3f4f6;
    }
    h1 { color: #111827; margin-bottom: 8px; }
    .subtitle { color: #6b7280; margin-bottom: 24px; }
    .editor-wrapper { background: white; padding: 24px; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Markdown Editor Example</h1>
  <p class="subtitle">Write markdown with live preview</p>
  <div class="editor-wrapper">
    <div id="editor"></div>
  </div>

  <script type="module">
    import { createMarkdownEditor } from './MarkdownEditor.example.js';

    const editor = createMarkdownEditor(document.getElementById('editor'), {
      content: \`# Welcome to Markdown Editor

This is a **markdown-first** editor with *live preview*.

## Features

- **Bold** and *italic* text
- Lists (bullet and numbered)
- Task lists
- Links and images
- Tables
- Code blocks
- And more!

Try typing some markdown on the left and see it preview on the right!

### Task List Example

- [x] Create markdown editor
- [ ] Add syntax highlighting
- [ ] Add export functionality

### Code Example

\\\`\\\`\\\`javascript
const greeting = "Hello, Markdown!";
console.log(greeting);
\\\`\\\`\\\`
\`,
      showPreview: true,
      syncScroll: true,
      onUpdate: (ed, markdown) => {
        console.log('Markdown updated:', markdown.length, 'characters');
      }
    });
  </script>
</body>
</html>
`;
