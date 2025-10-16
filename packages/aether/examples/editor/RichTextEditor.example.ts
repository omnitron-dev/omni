/**
 * RichTextEditor.example.ts
 *
 * A comprehensive rich text editor demonstrating all formatting features of the Advanced Editor.
 * This example showcases the full power of the editor with complete formatting capabilities.
 *
 * Features demonstrated:
 * - All text formatting marks (Bold, Italic, Underline, Strike, Code)
 * - Headings (H1-H6)
 * - Blockquotes
 * - Lists (Bullet, Ordered, Task)
 * - Links and Images
 * - Tables
 * - Horizontal Rules
 * - Complete Toolbar with all buttons
 * - Bubble Menu for inline formatting
 * - Status bar with statistics
 * - Keyboard shortcuts
 * - State management and signals
 * - Content serialization (HTML/JSON)
 * - Search and replace functionality
 *
 * Usage:
 * ```typescript
 * import { createRichTextEditor } from './RichTextEditor.example';
 * const editor = createRichTextEditor(document.getElementById('editor'), {
 *   content: '<h1>Hello World</h1><p>Start editing!</p>',
 *   onUpdate: (instance) => console.log('Changed:', instance.getHTML())
 * });
 * ```
 */

import { EditorBridge } from '../../src/components/editor/core/EditorBridge.js';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';
import type { WritableSignal } from '../../src/core/reactivity/types.js';

// Import all mark extensions (text formatting)
import { BoldExtension } from '../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../src/components/editor/extensions/marks/ItalicExtension.js';
import { UnderlineExtension } from '../../src/components/editor/extensions/marks/UnderlineExtension.js';
import { StrikeExtension } from '../../src/components/editor/extensions/marks/StrikeExtension.js';
import { CodeExtension } from '../../src/components/editor/extensions/marks/CodeExtension.js';

// Import node extensions (block-level elements)
import { ParagraphExtension } from '../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { HeadingExtension } from '../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { BlockquoteExtension } from '../../src/components/editor/extensions/nodes/BlockquoteExtension.js';
import { HorizontalRuleExtension } from '../../src/components/editor/extensions/nodes/HorizontalRuleExtension.js';

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

// Import behavior extensions
import {
  HistoryExtension,
  PlaceholderExtension,
  DropCursorExtension,
  GapCursorExtension,
} from '../../src/components/editor/extensions/behavior/index.js';

// Import search extension
import { SearchExtension } from '../../src/components/editor/extensions/search/index.js';

// Import UI components (these would be used in a real implementation)
import type { EditorInstance, ToolbarItem } from '../../src/components/editor/core/types.js';

/**
 * Configuration options for the rich text editor
 */
export interface RichTextEditorOptions {
  /**
   * Initial content to display
   * Can be HTML, JSON, or plain text
   */
  content?: string;

  /**
   * Type of initial content
   * @default 'html'
   */
  contentType?: 'html' | 'json' | 'text';

  /**
   * Whether the editor should be editable
   * @default true
   */
  editable?: boolean;

  /**
   * Whether to autofocus the editor
   * @default false
   */
  autofocus?: boolean | 'start' | 'end';

  /**
   * Placeholder text when editor is empty
   * @default 'Start writing...'
   */
  placeholder?: string;

  /**
   * Whether to show the toolbar
   * @default true
   */
  showToolbar?: boolean;

  /**
   * Whether to show the bubble menu
   * @default true
   */
  showBubbleMenu?: boolean;

  /**
   * Whether to show the status bar
   * @default true
   */
  showStatusBar?: boolean;

  /**
   * Whether to enable search functionality
   * @default true
   */
  enableSearch?: boolean;

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
  onUpdate?: (editor: EditorInstance) => void;

  /**
   * Callback when selection changes
   */
  onSelectionUpdate?: (editor: EditorInstance) => void;

  /**
   * Callback when editor receives focus
   */
  onFocus?: (editor: EditorInstance) => void;

  /**
   * Callback when editor loses focus
   */
  onBlur?: (editor: EditorInstance) => void;
}

/**
 * Return type for the createRichTextEditor function
 */
export interface RichTextEditorInstance {
  /**
   * The underlying editor instance
   */
  editor: EditorInstance;

  /**
   * Get current content as HTML
   */
  getHTML(): string;

  /**
   * Get current content as plain text
   */
  getText(): string;

  /**
   * Get current content as JSON
   */
  getJSON(): any;

  /**
   * Set new content
   */
  setContent(content: string, type?: 'html' | 'text' | 'json'): void;

  /**
   * Clear all content
   */
  clearContent(): void;

  /**
   * Focus the editor
   */
  focus(position?: 'start' | 'end'): void;

  /**
   * Check if editor is empty
   */
  isEmpty(): boolean;

  /**
   * Get word count
   */
  getWordCount(): number;

  /**
   * Get character count
   */
  getCharCount(): number;

  /**
   * Execute a command
   */
  executeCommand(name: string, ...args: any[]): boolean;

  /**
   * Check if a command can be executed
   */
  canExecute(name: string, ...args: any[]): boolean;

  /**
   * Toggle search panel visibility
   */
  toggleSearch(): void;

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
 * Creates a full-featured rich text editor
 *
 * This editor includes all formatting options and is suitable for:
 * - Blog posts and articles
 * - Documentation
 * - Content management systems
 * - Note-taking applications
 * - Any scenario requiring rich text formatting
 *
 * @param container - The DOM element to mount the editor in
 * @param options - Configuration options
 * @returns An object with the editor instance and helper methods
 *
 * @example
 * ```typescript
 * // Create editor with default options
 * const editor = createRichTextEditor(document.getElementById('editor'));
 *
 * // Create editor with custom content
 * const editor = createRichTextEditor(container, {
 *   content: '<h1>My Document</h1><p>Start editing...</p>',
 *   contentType: 'html',
 *   placeholder: 'Write something amazing...',
 *   showToolbar: true,
 *   showStatusBar: true
 * });
 *
 * // Listen for changes
 * const editor = createRichTextEditor(container, {
 *   onUpdate: (ed) => {
 *     console.log('Words:', ed.signals.wordCount());
 *     console.log('HTML:', ed.getHTML());
 *   }
 * });
 * ```
 */
export function createRichTextEditor(
  container: HTMLElement,
  options: RichTextEditorOptions = {}
): RichTextEditorInstance {
  // Destructure options with defaults
  const {
    content = '',
    contentType = 'html',
    editable = true,
    autofocus = false,
    placeholder = 'Start writing...',
    showToolbar = true,
    showBubbleMenu = true,
    showStatusBar = true,
    enableSearch = true,
    containerClass = 'rich-text-editor-container',
    editorClass = 'rich-text-editor',
    onUpdate,
    onSelectionUpdate,
    onFocus,
    onBlur,
  } = options;

  // Create the main container structure
  const wrapper = document.createElement('div');
  wrapper.className = containerClass;
  container.appendChild(wrapper);

  // Create toolbar container (if enabled)
  let toolbarElement: HTMLElement | null = null;
  if (showToolbar) {
    toolbarElement = document.createElement('div');
    toolbarElement.className = 'rte-toolbar';
    wrapper.appendChild(toolbarElement);
  }

  // Create editor container
  const editorContainer = document.createElement('div');
  editorContainer.className = 'rte-editor-wrapper';
  wrapper.appendChild(editorContainer);

  // Create status bar container (if enabled)
  let statusBarElement: HTMLElement | null = null;
  if (showStatusBar) {
    statusBarElement = document.createElement('div');
    statusBarElement.className = 'rte-statusbar';
    wrapper.appendChild(statusBarElement);
  }

  // Define comprehensive extension set
  // This includes all available formatting options
  const extensions = [
    // Basic structure
    new ParagraphExtension(),

    // Text formatting marks
    new BoldExtension(), // Mod-b
    new ItalicExtension(), // Mod-i
    new UnderlineExtension(), // Mod-u
    new StrikeExtension(), // Mod-Shift-x
    new CodeExtension(), // Mod-e

    // Block nodes
    new HeadingExtension({ levels: [1, 2, 3, 4, 5, 6] }), // H1-H6
    new BlockquoteExtension(), // Blockquotes
    new HorizontalRuleExtension(), // Horizontal rules (---)

    // Lists
    new BulletListExtension(), // Unordered lists
    new OrderedListExtension(), // Numbered lists
    new ListItemExtension(), // List item nodes (required for lists)
    new TaskListExtension(), // Task lists with checkboxes
    new TaskItemExtension(), // Task items (required for task lists)

    // Media
    new LinkExtension({
      openOnClick: true, // Open links when clicked
      autolink: true, // Auto-detect and linkify URLs
    }),
    new ImageExtension({
      inline: false, // Images as block elements
      allowBase64: true, // Allow base64 encoded images
    }),

    // Tables
    new TableExtension({
      resizable: true, // Allow column resizing
      lastColumnResizable: true,
      allowTableNodeSelection: true,
    }),
    new TableRowExtension(), // Table rows (required for tables)
    new TableCellExtension(), // Table cells (required for tables)
    new TableHeaderExtension(), // Table headers (required for tables)

    // Behavior enhancements
    new HistoryExtension({
      depth: 100, // Keep 100 history entries
      newGroupDelay: 500, // Group changes within 500ms
    }),
    new PlaceholderExtension({
      placeholder, // Show placeholder when empty
    }),
    new DropCursorExtension({
      color: '#3b82f6', // Blue drop cursor
      width: 2,
    }),
    new GapCursorExtension(), // Allow cursor in gaps (e.g., before tables)

    // Search functionality (if enabled)
    ...(enableSearch ? [new SearchExtension()] : []),
  ];

  // Signal to track if search is visible
  const searchVisible: WritableSignal<boolean> = signal(false);

  // Create the editor instance
  const editor = new EditorBridge(editorContainer, {
    // Content
    content,
    contentType,

    // Configuration
    extensions,
    editable,
    autofocus,

    // Styling
    editorClass,

    // Event handlers
    onCreate: (instance) => {
      console.log('Rich text editor created');

      // Initialize toolbar if enabled
      if (showToolbar && toolbarElement) {
        initializeToolbar(toolbarElement, instance);
      }

      // Initialize status bar if enabled
      if (showStatusBar && statusBarElement) {
        initializeStatusBar(statusBarElement, instance);
      }

      // Initialize bubble menu if enabled
      if (showBubbleMenu) {
        initializeBubbleMenu(editorContainer, instance);
      }

      // Set up search panel if enabled
      if (enableSearch) {
        initializeSearchPanel(wrapper, instance, searchVisible);
      }
    },

    onUpdate: ({ editor: editorInstance }) => {
      // Update UI components when content changes
      if (showStatusBar && statusBarElement) {
        updateStatusBar(statusBarElement, editorInstance);
      }

      // Call user's callback
      if (onUpdate) {
        onUpdate(editorInstance);
      }
    },

    onSelectionUpdate: ({ editor: editorInstance }) => {
      // Update toolbar button states when selection changes
      if (showToolbar && toolbarElement) {
        updateToolbarStates(toolbarElement, editorInstance);
      }

      // Call user's callback
      if (onSelectionUpdate) {
        onSelectionUpdate(editorInstance);
      }
    },

    onFocus: ({ editor: editorInstance }) => {
      wrapper.classList.add('focused');
      if (onFocus) {
        onFocus(editorInstance);
      }
    },

    onBlur: ({ editor: editorInstance }) => {
      wrapper.classList.remove('focused');
      if (onBlur) {
        onBlur(editorInstance);
      }
    },
  });

  // Apply comprehensive styles
  applyRichTextEditorStyles();

  // Return the public API
  return {
    // Expose the raw editor instance
    editor,

    // Content methods
    getHTML: () => editor.getHTML(),
    getText: () => editor.getText(),
    getJSON: () => editor.getJSON(),

    setContent: (newContent: string, type: 'html' | 'text' | 'json' = 'html') => {
      editor.setContent(newContent, type);
    },

    clearContent: () => {
      editor.clearContent();
    },

    // Focus methods
    focus: (position?: 'start' | 'end') => {
      editor.focus(position);
    },

    // State methods
    isEmpty: () => editor.isEmpty(),
    getWordCount: () => editor.signals.wordCount(),
    getCharCount: () => editor.signals.charCount(),

    // Command methods
    executeCommand: (name: string, ...args: any[]) => {
      if (editor.commands) {
        return editor.commands.execute(name, ...args);
      }
      return false;
    },

    canExecute: (name: string, ...args: any[]) => {
      if (editor.commands) {
        return editor.commands.can(name, ...args);
      }
      return false;
    },

    // Search methods
    toggleSearch: () => {
      searchVisible.set(!searchVisible());
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
 * Initialize the toolbar with all formatting buttons
 */
function initializeToolbar(container: HTMLElement, editor: EditorInstance): void {
  // Define toolbar button groups
  const toolbarConfig: ToolbarButtonGroup[] = [
    // Text formatting group
    {
      buttons: [
        { command: 'bold', label: 'B', title: 'Bold (Ctrl+B)', mark: 'bold' },
        { command: 'italic', label: 'I', title: 'Italic (Ctrl+I)', mark: 'italic' },
        { command: 'underline', label: 'U', title: 'Underline (Ctrl+U)', mark: 'underline' },
        { command: 'strike', label: 'S', title: 'Strikethrough', mark: 'strike' },
        { command: 'code', label: '</>', title: 'Code (Ctrl+E)', mark: 'code' },
      ],
    },
    // Heading dropdown
    {
      dropdown: {
        label: 'H',
        title: 'Heading',
        items: [
          { command: 'heading', args: [{ level: 1 }], label: 'H1', title: 'Heading 1' },
          { command: 'heading', args: [{ level: 2 }], label: 'H2', title: 'Heading 2' },
          { command: 'heading', args: [{ level: 3 }], label: 'H3', title: 'Heading 3' },
          { command: 'heading', args: [{ level: 4 }], label: 'H4', title: 'Heading 4' },
          { command: 'heading', args: [{ level: 5 }], label: 'H5', title: 'Heading 5' },
          { command: 'heading', args: [{ level: 6 }], label: 'H6', title: 'Heading 6' },
          { command: 'paragraph', label: 'P', title: 'Paragraph' },
        ],
      },
    },
    // Block formatting
    {
      buttons: [
        { command: 'blockquote', label: '❝', title: 'Blockquote' },
        { command: 'horizontalRule', label: '─', title: 'Horizontal Rule' },
      ],
    },
    // Lists
    {
      buttons: [
        { command: 'bulletList', label: '•', title: 'Bullet List' },
        { command: 'orderedList', label: '1.', title: 'Ordered List' },
        { command: 'taskList', label: '☑', title: 'Task List' },
      ],
    },
    // Media
    {
      buttons: [
        { command: 'link', label: '🔗', title: 'Insert Link' },
        { command: 'image', label: '🖼', title: 'Insert Image' },
      ],
    },
    // Table
    {
      buttons: [{ command: 'insertTable', label: '⊞', title: 'Insert Table' }],
    },
    // History
    {
      buttons: [
        { command: 'undo', label: '↶', title: 'Undo (Ctrl+Z)' },
        { command: 'redo', label: '↷', title: 'Redo (Ctrl+Y)' },
      ],
    },
  ];

  // Build toolbar HTML
  toolbarConfig.forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      // Add divider between groups
      const divider = document.createElement('div');
      divider.className = 'toolbar-divider';
      container.appendChild(divider);
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'toolbar-group';

    if (group.dropdown) {
      // Create dropdown
      createDropdown(groupEl, group.dropdown, editor);
    } else if (group.buttons) {
      // Create buttons
      group.buttons.forEach((btn) => {
        createButton(groupEl, btn, editor);
      });
    }

    container.appendChild(groupEl);
  });
}

/**
 * Create a toolbar button
 */
function createButton(container: HTMLElement, config: ToolbarButtonConfig, editor: EditorInstance): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'toolbar-btn';
  button.textContent = config.label;
  button.title = config.title;
  button.setAttribute('data-command', config.command);

  // Handle click
  button.addEventListener('click', () => {
    if (editor.commands) {
      if (config.args) {
        editor.commands.execute(config.command, ...config.args);
      } else {
        editor.commands.execute(config.command);
      }
      editor.focus();
    }
  });

  container.appendChild(button);
  return button;
}

/**
 * Create a toolbar dropdown
 */
function createDropdown(container: HTMLElement, config: ToolbarDropdownConfig, editor: EditorInstance): void {
  const dropdown = document.createElement('div');
  dropdown.className = 'toolbar-dropdown';

  // Create trigger button
  const trigger = document.createElement('button');
  trigger.className = 'toolbar-btn dropdown-trigger';
  trigger.textContent = config.label + ' ▾';
  trigger.title = config.title;

  // Create menu
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';

  config.items.forEach((item) => {
    const menuItem = document.createElement('button');
    menuItem.className = 'dropdown-item';
    menuItem.textContent = item.label + ' ' + item.title;

    menuItem.addEventListener('click', () => {
      if (editor.commands) {
        if (item.args) {
          editor.commands.execute(item.command, ...item.args);
        } else {
          editor.commands.execute(item.command);
        }
        editor.focus();
      }
      menu.classList.remove('show');
    });

    menu.appendChild(menuItem);
  });

  // Toggle dropdown
  trigger.addEventListener('click', () => {
    menu.classList.toggle('show');
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target as Node)) {
      menu.classList.remove('show');
    }
  });

  dropdown.appendChild(trigger);
  dropdown.appendChild(menu);
  container.appendChild(dropdown);
}

/**
 * Update toolbar button states based on current selection
 */
function updateToolbarStates(container: HTMLElement, editor: EditorInstance): void {
  // Update active states for mark buttons
  const buttons = container.querySelectorAll('.toolbar-btn[data-command]');
  buttons.forEach((button) => {
    const command = button.getAttribute('data-command');
    if (!command) return;

    // Check if this mark/node is active
    const activeMarks = editor.signals.activeMarks();
    const isActive = activeMarks.some((mark) => mark.type.name === command);

    if (isActive) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }

    // Check if command can be executed
    if (editor.commands) {
      const canExecute = editor.commands.can(command);
      (button as HTMLButtonElement).disabled = !canExecute;
    }
  });
}

/**
 * Initialize the status bar
 */
function initializeStatusBar(container: HTMLElement, editor: EditorInstance): void {
  // Create status items
  const wordCountEl = document.createElement('span');
  wordCountEl.className = 'status-item';
  wordCountEl.textContent = 'Words: 0';

  const charCountEl = document.createElement('span');
  charCountEl.className = 'status-item';
  charCountEl.textContent = 'Characters: 0';

  const nodeTypeEl = document.createElement('span');
  nodeTypeEl.className = 'status-item';
  nodeTypeEl.textContent = 'Paragraph';

  container.appendChild(wordCountEl);
  container.appendChild(charCountEl);
  container.appendChild(nodeTypeEl);

  // Initial update
  updateStatusBar(container, editor);
}

/**
 * Update status bar with current statistics
 */
function updateStatusBar(container: HTMLElement, editor: EditorInstance): void {
  const wordCount = editor.signals.wordCount();
  const charCount = editor.signals.charCount();
  const nodeType = editor.signals.currentNodeType();

  const items = container.querySelectorAll('.status-item');
  if (items[0]) items[0].textContent = `Words: ${wordCount}`;
  if (items[1]) items[1].textContent = `Characters: ${charCount}`;
  if (items[2]) items[2].textContent = nodeType?.name || 'Unknown';
}

/**
 * Initialize bubble menu for inline formatting
 */
function initializeBubbleMenu(container: HTMLElement, editor: EditorInstance): void {
  // Bubble menu appears when text is selected
  const bubbleMenu = document.createElement('div');
  bubbleMenu.className = 'bubble-menu';
  bubbleMenu.style.display = 'none';

  // Add formatting buttons
  const buttons = [
    { command: 'bold', label: 'B', title: 'Bold' },
    { command: 'italic', label: 'I', title: 'Italic' },
    { command: 'underline', label: 'U', title: 'Underline' },
    { command: 'strike', label: 'S', title: 'Strike' },
    { command: 'code', label: '</>', title: 'Code' },
    { command: 'link', label: '🔗', title: 'Link' },
  ];

  buttons.forEach((btn) => {
    const button = document.createElement('button');
    button.className = 'bubble-btn';
    button.textContent = btn.label;
    button.title = btn.title;

    button.addEventListener('click', () => {
      if (editor.commands) {
        editor.commands.execute(btn.command);
        editor.focus();
      }
    });

    bubbleMenu.appendChild(button);
  });

  document.body.appendChild(bubbleMenu);

  // Show/hide bubble menu based on selection
  // This is a simplified implementation - real implementation would use
  // ProseMirror's selection tracking
  editor.view.dom.addEventListener('mouseup', () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      bubbleMenu.style.display = 'flex';
      bubbleMenu.style.left = `${rect.left + rect.width / 2}px`;
      bubbleMenu.style.top = `${rect.top - 40}px`;
    } else {
      bubbleMenu.style.display = 'none';
    }
  });
}

/**
 * Initialize search panel
 */
function initializeSearchPanel(container: HTMLElement, editor: EditorInstance, visible: WritableSignal<boolean>): void {
  const searchPanel = document.createElement('div');
  searchPanel.className = 'search-panel';
  searchPanel.style.display = 'none';

  // Search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search...';
  searchInput.className = 'search-input';

  // Replace input
  const replaceInput = document.createElement('input');
  replaceInput.type = 'text';
  replaceInput.placeholder = 'Replace...';
  replaceInput.className = 'search-input';

  // Buttons
  const findBtn = document.createElement('button');
  findBtn.textContent = 'Find';
  findBtn.className = 'search-btn';

  const replaceBtn = document.createElement('button');
  replaceBtn.textContent = 'Replace';
  replaceBtn.className = 'search-btn';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.className = 'search-close';

  closeBtn.addEventListener('click', () => {
    visible.set(false);
  });

  searchPanel.appendChild(searchInput);
  searchPanel.appendChild(replaceInput);
  searchPanel.appendChild(findBtn);
  searchPanel.appendChild(replaceBtn);
  searchPanel.appendChild(closeBtn);

  container.appendChild(searchPanel);

  // Toggle visibility with signal
  effect(() => {
    searchPanel.style.display = visible() ? 'flex' : 'none';
    if (visible()) {
      searchInput.focus();
    }
  });
}

/**
 * Apply comprehensive styles for the rich text editor
 */
function applyRichTextEditorStyles(): void {
  const styleId = 'rich-text-editor-styles';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Container */
      .rich-text-editor-container {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
        transition: border-color 0.2s;
      }

      .rich-text-editor-container.focused {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      /* Toolbar */
      .rte-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        flex-wrap: wrap;
      }

      .toolbar-group {
        display: flex;
        gap: 4px;
      }

      .toolbar-divider {
        width: 1px;
        height: 24px;
        background: #d1d5db;
        margin: 0 4px;
      }

      .toolbar-btn {
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

      .toolbar-btn:hover:not(:disabled) {
        background: #e5e7eb;
      }

      .toolbar-btn.active {
        background: #dbeafe;
        color: #2563eb;
        border-color: #93c5fd;
      }

      .toolbar-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* Dropdown */
      .toolbar-dropdown {
        position: relative;
      }

      .dropdown-menu {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 4px;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        z-index: 1000;
        min-width: 150px;
      }

      .dropdown-menu.show {
        display: block;
      }

      .dropdown-item {
        display: block;
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: none;
        text-align: left;
        cursor: pointer;
        color: #374151;
        font-size: 14px;
      }

      .dropdown-item:hover {
        background: #f3f4f6;
      }

      /* Editor */
      .rte-editor-wrapper {
        padding: 16px;
        min-height: 200px;
      }

      .rich-text-editor {
        outline: none;
      }

      .rich-text-editor .ProseMirror {
        outline: none;
        min-height: 168px;
      }

      /* Typography */
      .rich-text-editor h1 { font-size: 2em; font-weight: 700; margin: 0.67em 0; }
      .rich-text-editor h2 { font-size: 1.5em; font-weight: 600; margin: 0.75em 0; }
      .rich-text-editor h3 { font-size: 1.25em; font-weight: 600; margin: 0.83em 0; }
      .rich-text-editor h4 { font-size: 1.1em; font-weight: 600; margin: 1em 0; }
      .rich-text-editor h5 { font-size: 1em; font-weight: 600; margin: 1.17em 0; }
      .rich-text-editor h6 { font-size: 0.875em; font-weight: 600; margin: 1.33em 0; }

      .rich-text-editor p {
        margin: 0.75em 0;
      }

      .rich-text-editor blockquote {
        border-left: 3px solid #d1d5db;
        padding-left: 16px;
        margin: 1em 0;
        color: #6b7280;
      }

      .rich-text-editor hr {
        border: none;
        border-top: 2px solid #e5e7eb;
        margin: 2em 0;
      }

      /* Lists */
      .rich-text-editor ul,
      .rich-text-editor ol {
        padding-left: 1.5em;
        margin: 0.75em 0;
      }

      .rich-text-editor li {
        margin: 0.25em 0;
      }

      /* Code */
      .rich-text-editor code {
        background: #f3f4f6;
        padding: 2px 6px;
        border-radius: 3px;
        font-family: 'Monaco', 'Courier New', monospace;
        font-size: 0.9em;
      }

      /* Links */
      .rich-text-editor a {
        color: #2563eb;
        text-decoration: underline;
        cursor: pointer;
      }

      /* Images */
      .rich-text-editor img {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
      }

      /* Tables */
      .rich-text-editor table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
      }

      .rich-text-editor th,
      .rich-text-editor td {
        border: 1px solid #d1d5db;
        padding: 8px 12px;
        text-align: left;
      }

      .rich-text-editor th {
        background: #f9fafb;
        font-weight: 600;
      }

      /* Status bar */
      .rte-statusbar {
        display: flex;
        gap: 16px;
        padding: 8px 16px;
        background: #f9fafb;
        border-top: 1px solid #e5e7eb;
        font-size: 12px;
        color: #6b7280;
      }

      .status-item {
        display: flex;
        align-items: center;
      }

      /* Bubble menu */
      .bubble-menu {
        position: fixed;
        display: flex;
        gap: 4px;
        padding: 4px;
        background: #1f2937;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 2000;
        transform: translateX(-50%);
      }

      .bubble-btn {
        padding: 6px 10px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: white;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }

      .bubble-btn:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      /* Search panel */
      .search-panel {
        display: flex;
        gap: 8px;
        padding: 8px;
        background: #fef3c7;
        border-bottom: 1px solid #fbbf24;
      }

      .search-input {
        flex: 1;
        padding: 6px 12px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
      }

      .search-btn {
        padding: 6px 16px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: white;
        cursor: pointer;
        font-size: 13px;
      }

      .search-btn:hover {
        background: #f3f4f6;
      }

      .search-close {
        padding: 6px 10px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
      }
    `;
    document.head.appendChild(style);
  }
}

// Type definitions for internal use
interface ToolbarButtonConfig {
  command: string;
  label: string;
  title: string;
  mark?: string;
  args?: any[];
}

interface ToolbarDropdownConfig {
  label: string;
  title: string;
  items: ToolbarButtonConfig[];
}

interface ToolbarButtonGroup {
  buttons?: ToolbarButtonConfig[];
  dropdown?: ToolbarDropdownConfig;
}

/**
 * HTML fixture for testing the rich text editor
 */
export const richTextEditorHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rich Text Editor Example</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 20px;
      background: #f3f4f6;
    }
    h1 { color: #111827; margin-bottom: 8px; }
    .subtitle { color: #6b7280; margin-bottom: 24px; }
    .editor-wrapper { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
  </style>
</head>
<body>
  <h1>Rich Text Editor Example</h1>
  <p class="subtitle">Full-featured editor with all formatting options</p>
  <div class="editor-wrapper">
    <div id="editor"></div>
  </div>

  <script type="module">
    import { createRichTextEditor } from './RichTextEditor.example.js';

    const editor = createRichTextEditor(document.getElementById('editor'), {
      content: \`
        <h1>Welcome to the Rich Text Editor</h1>
        <p>This is a <strong>full-featured</strong> rich text editor with <em>comprehensive</em> formatting options.</p>
        <h2>Features</h2>
        <ul>
          <li>Text formatting (bold, italic, underline, strike, code)</li>
          <li>Headings (H1-H6)</li>
          <li>Lists (bullet, numbered, task)</li>
          <li>Links and images</li>
          <li>Tables</li>
          <li>And much more!</li>
        </ul>
      \`,
      onUpdate: (ed) => {
        console.log('Words:', ed.signals.wordCount());
      }
    });
  </script>
</body>
</html>
`;
