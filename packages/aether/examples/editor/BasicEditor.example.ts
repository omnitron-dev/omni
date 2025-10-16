/**
 * BasicEditor.example.ts
 *
 * A minimal editor setup demonstrating the simplest possible usage of the Advanced Editor.
 * This example focuses on basic text editing with paragraph and text nodes only.
 *
 * Features demonstrated:
 * - Minimal extension setup (Document, Paragraph, Text, History)
 * - Basic text input and editing
 * - Undo/Redo functionality
 * - Simple content retrieval (HTML, JSON, Text)
 * - Basic styling and container setup
 * - Programmatic content updates
 * - Focus management
 *
 * Usage:
 * ```typescript
 * import { createBasicEditor } from './BasicEditor.example';
 * const editor = createBasicEditor(document.getElementById('editor'));
 *
 * // Get content
 * const html = editor.getHTML();
 * const text = editor.getText();
 *
 * // Set content
 * editor.setContent('Hello, World!', 'text');
 *
 * // Cleanup when done
 * editor.destroy();
 * ```
 */

import { EditorBridge } from '../../src/components/editor/core/EditorBridge.js';
import { HistoryExtension } from '../../src/components/editor/extensions/behavior/HistoryExtension.js';
import { ParagraphExtension } from '../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import type { EditorInstance } from '../../src/components/editor/core/types.js';

/**
 * Configuration options for the basic editor
 */
export interface BasicEditorOptions {
  /**
   * Initial content to display in the editor
   * Can be HTML, plain text, or JSON
   */
  content?: string;

  /**
   * Type of the initial content
   * @default 'text'
   */
  contentType?: 'html' | 'json' | 'text';

  /**
   * Whether the editor should be editable
   * @default true
   */
  editable?: boolean;

  /**
   * Where to focus the editor on mount
   * - true: focus at cursor position
   * - 'start': focus at beginning
   * - 'end': focus at end
   * - false: don't autofocus
   * @default false
   */
  autofocus?: boolean | 'start' | 'end';

  /**
   * Placeholder text when editor is empty
   * @default 'Start typing...'
   */
  placeholder?: string;

  /**
   * Custom CSS class for the editor container
   */
  containerClass?: string;

  /**
   * Custom CSS class for the editor element
   */
  editorClass?: string;

  /**
   * Callback when content changes
   */
  onUpdate?: (editor: EditorInstance) => void;

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
 * Return type for the createBasicEditor function
 */
export interface BasicEditorInstance {
  /**
   * The underlying editor instance
   */
  editor: EditorInstance;

  /**
   * Get the current content as HTML
   */
  getHTML(): string;

  /**
   * Get the current content as plain text
   */
  getText(): string;

  /**
   * Get the current content as JSON
   */
  getJSON(): any;

  /**
   * Set new content in the editor
   */
  setContent(content: string, type?: 'html' | 'text' | 'json'): void;

  /**
   * Clear all content from the editor
   */
  clearContent(): void;

  /**
   * Focus the editor at a specific position
   */
  focus(position?: 'start' | 'end'): void;

  /**
   * Remove focus from the editor
   */
  blur(): void;

  /**
   * Check if editor is empty
   */
  isEmpty(): boolean;

  /**
   * Check if editor is focused
   */
  isFocused(): boolean;

  /**
   * Undo the last change
   */
  undo(): void;

  /**
   * Redo the last undone change
   */
  redo(): void;

  /**
   * Check if undo is available
   */
  canUndo(): boolean;

  /**
   * Check if redo is available
   */
  canRedo(): boolean;

  /**
   * Destroy the editor and cleanup resources
   */
  destroy(): void;

  /**
   * Get the DOM element containing the editor
   */
  getElement(): HTMLElement;
}

/**
 * Creates a basic editor with minimal features
 *
 * This is the simplest possible editor configuration, suitable for:
 * - Simple text input fields
 * - Comment boxes
 * - Basic note-taking
 * - Any scenario where you need editable text without formatting
 *
 * @param container - The DOM element to mount the editor in
 * @param options - Configuration options
 * @returns An object with the editor instance and helper methods
 *
 * @example
 * ```typescript
 * // Create editor with default options
 * const editor = createBasicEditor(document.getElementById('editor'));
 *
 * // Create editor with custom content
 * const editor = createBasicEditor(container, {
 *   content: 'Hello, World!',
 *   contentType: 'text',
 *   autofocus: 'end',
 *   placeholder: 'Enter your notes...'
 * });
 *
 * // Listen for changes
 * const editor = createBasicEditor(container, {
 *   onUpdate: (ed) => {
 *     console.log('Content:', ed.getText());
 *   }
 * });
 * ```
 */
export function createBasicEditor(container: HTMLElement, options: BasicEditorOptions = {}): BasicEditorInstance {
  // Destructure options with defaults
  const {
    content = '',
    contentType = 'text',
    editable = true,
    autofocus = false,
    placeholder = 'Start typing...',
    containerClass = 'basic-editor-container',
    editorClass = 'basic-editor',
    onUpdate,
    onFocus,
    onBlur,
  } = options;

  // Create a wrapper div for the editor
  const editorContainer = document.createElement('div');
  editorContainer.className = containerClass;
  container.appendChild(editorContainer);

  // Define the minimal set of extensions needed for a basic editor
  // 1. ParagraphExtension: Provides the paragraph node (required for text blocks)
  // 2. HistoryExtension: Provides undo/redo functionality
  const extensions = [
    new ParagraphExtension(),
    new HistoryExtension({
      depth: 100, // Keep up to 100 history entries
      newGroupDelay: 500, // Group changes within 500ms
    }),
  ];

  // Create the editor instance using EditorBridge
  // EditorBridge handles the ProseMirror setup and Aether signal integration
  const editor = new EditorBridge(editorContainer, {
    // Content configuration
    content,
    contentType,

    // Editor configuration
    extensions,
    editable,
    autofocus,

    // Styling
    editorClass,

    // Event handlers
    onCreate: (instance) => {
      // Editor is ready
      console.log('Basic editor created');
    },

    onUpdate: ({ editor: editorInstance }) => {
      // Content has changed
      if (onUpdate) {
        onUpdate(editorInstance);
      }
    },

    onFocus: ({ editor: editorInstance }) => {
      // Editor received focus
      if (onFocus) {
        onFocus(editorInstance);
      }
    },

    onBlur: ({ editor: editorInstance }) => {
      // Editor lost focus
      if (onBlur) {
        onBlur(editorInstance);
      }
    },
  });

  // Apply basic styles to make the editor usable
  applyBasicStyles(editorContainer, editorClass, placeholder);

  // Return a clean API for interacting with the editor
  return {
    // Expose the raw editor instance for advanced use cases
    editor,

    // Content methods
    getHTML: () => editor.getHTML(),
    getText: () => editor.getText(),
    getJSON: () => editor.getJSON(),

    setContent: (newContent: string, type: 'html' | 'text' | 'json' = 'text') => {
      editor.setContent(newContent, type);
    },

    clearContent: () => {
      editor.clearContent();
    },

    // Focus methods
    focus: (position?: 'start' | 'end') => {
      editor.focus(position);
    },

    blur: () => {
      editor.blur();
    },

    // State methods
    isEmpty: () => editor.isEmpty(),
    isFocused: () => editor.isFocused(),

    // History methods
    undo: () => {
      // Execute the undo command through ProseMirror
      if (editor.commands) {
        editor.commands.execute('undo');
      }
    },

    redo: () => {
      // Execute the redo command through ProseMirror
      if (editor.commands) {
        editor.commands.execute('redo');
      }
    },

    canUndo: () => {
      // Check if undo is available through the signals
      return editor.signals.canUndo();
    },

    canRedo: () => {
      // Check if redo is available through the signals
      return editor.signals.canRedo();
    },

    // Lifecycle
    destroy: () => {
      // Clean up the editor and remove the container
      editor.destroy();
      editorContainer.remove();
    },

    // DOM access
    getElement: () => editorContainer,
  };
}

/**
 * Apply basic CSS styles to make the editor functional and presentable
 *
 * These styles provide:
 * - A clean, minimal appearance
 * - Proper spacing and padding
 * - Border and focus states
 * - Placeholder text styling
 *
 * @param container - The editor container element
 * @param editorClass - The CSS class for the editor element
 * @param placeholder - The placeholder text
 */
function applyBasicStyles(container: HTMLElement, editorClass: string, placeholder: string): void {
  // Create a <style> element to inject CSS
  const styleId = 'basic-editor-styles';

  // Check if styles already exist
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Container styles */
      .basic-editor-container {
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        transition: border-color 0.2s;
      }

      /* Focus state */
      .basic-editor-container:focus-within {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      /* Editor element */
      .${editorClass} {
        padding: 12px;
        min-height: 100px;
        outline: none;
      }

      /* ProseMirror base styles */
      .${editorClass} .ProseMirror {
        outline: none;
        min-height: 76px; /* min-height minus padding */
      }

      /* Paragraph spacing */
      .${editorClass} p {
        margin: 0 0 8px 0;
      }

      .${editorClass} p:last-child {
        margin-bottom: 0;
      }

      /* Placeholder styling */
      .${editorClass} .ProseMirror p.is-empty:first-child::before {
        content: "${placeholder}";
        color: #9ca3af;
        pointer-events: none;
        position: absolute;
      }

      /* Selection styling */
      .${editorClass} .ProseMirror ::selection {
        background-color: #bfdbfe;
      }

      /* Prevent empty paragraphs from collapsing */
      .${editorClass} p.is-empty {
        min-height: 1.5em;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Create a basic editor with controls (undo/redo buttons)
 *
 * This helper creates a basic editor with a simple control bar showing
 * undo and redo buttons. Useful for demonstrating history functionality.
 *
 * @param container - The DOM element to mount the editor in
 * @param options - Configuration options
 * @returns The editor instance with controls
 *
 * @example
 * ```typescript
 * const editor = createBasicEditorWithControls(container, {
 *   content: 'Try typing and using undo/redo!',
 *   contentType: 'text'
 * });
 * ```
 */
export function createBasicEditorWithControls(
  container: HTMLElement,
  options: BasicEditorOptions = {}
): BasicEditorInstance {
  // Create a wrapper for the controls and editor
  const wrapper = document.createElement('div');
  wrapper.className = 'basic-editor-wrapper';
  container.appendChild(wrapper);

  // Create the controls bar
  const controls = document.createElement('div');
  controls.className = 'basic-editor-controls';
  wrapper.appendChild(controls);

  // Create undo button
  const undoBtn = document.createElement('button');
  undoBtn.className = 'basic-editor-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.title = 'Undo (Ctrl+Z / Cmd+Z)';
  controls.appendChild(undoBtn);

  // Create redo button
  const redoBtn = document.createElement('button');
  redoBtn.className = 'basic-editor-btn';
  redoBtn.textContent = 'Redo';
  redoBtn.title = 'Redo (Ctrl+Y / Cmd+Shift+Z)';
  controls.appendChild(redoBtn);

  // Create editor container
  const editorContainer = document.createElement('div');
  wrapper.appendChild(editorContainer);

  // Create the editor
  const editor = createBasicEditor(editorContainer, {
    ...options,
    onUpdate: (ed) => {
      // Update button states based on history
      undoBtn.disabled = !ed.signals.canUndo();
      redoBtn.disabled = !ed.signals.canRedo();

      // Call user's onUpdate if provided
      if (options.onUpdate) {
        options.onUpdate(ed);
      }
    },
  });

  // Wire up button click handlers
  undoBtn.addEventListener('click', () => editor.undo());
  redoBtn.addEventListener('click', () => editor.redo());

  // Set initial button states
  undoBtn.disabled = !editor.canUndo();
  redoBtn.disabled = !editor.canRedo();

  // Apply control bar styles
  applyControlStyles();

  // Override destroy to clean up wrapper
  const originalDestroy = editor.destroy;
  editor.destroy = () => {
    originalDestroy();
    wrapper.remove();
  };

  return editor;
}

/**
 * Apply styles for the control bar
 */
function applyControlStyles(): void {
  const styleId = 'basic-editor-control-styles';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .basic-editor-wrapper {
        border: 1px solid #d1d5db;
        border-radius: 4px;
        overflow: hidden;
        background: white;
      }

      .basic-editor-controls {
        display: flex;
        gap: 4px;
        padding: 8px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
      }

      .basic-editor-btn {
        padding: 4px 12px;
        border: 1px solid #d1d5db;
        border-radius: 3px;
        background: white;
        color: #374151;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .basic-editor-btn:hover:not(:disabled) {
        background: #f3f4f6;
        border-color: #9ca3af;
      }

      .basic-editor-btn:active:not(:disabled) {
        background: #e5e7eb;
      }

      .basic-editor-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .basic-editor-wrapper .basic-editor-container {
        border: none;
        border-radius: 0;
      }

      .basic-editor-wrapper .basic-editor-container:focus-within {
        box-shadow: none;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * HTML fixture for testing the basic editor in a browser
 *
 * This provides a complete HTML page that can be used to test the basic editor.
 * Copy this to an HTML file and open in a browser to see the editor in action.
 */
export const basicEditorHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Basic Editor Example</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #f3f4f6;
    }

    h1 {
      color: #111827;
      margin-bottom: 8px;
    }

    .subtitle {
      color: #6b7280;
      margin-bottom: 24px;
    }

    .example-section {
      background: white;
      padding: 24px;
      border-radius: 8px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .example-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #374151;
    }

    .example-desc {
      color: #6b7280;
      margin-bottom: 16px;
      font-size: 14px;
    }

    .info-panel {
      margin-top: 16px;
      padding: 12px;
      background: #f9fafb;
      border-radius: 4px;
      font-size: 13px;
      color: #4b5563;
    }

    .info-panel code {
      background: #e5e7eb;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Monaco', 'Courier New', monospace;
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .btn {
      padding: 6px 16px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: white;
      color: #374151;
      font-size: 13px;
      cursor: pointer;
    }

    .btn:hover {
      background: #f9fafb;
    }
  </style>
</head>
<body>
  <h1>Basic Editor Example</h1>
  <p class="subtitle">Minimal setup demonstrating the simplest possible editor usage</p>

  <!-- Example 1: Simple editor -->
  <div class="example-section">
    <div class="example-title">1. Simple Editor</div>
    <p class="example-desc">The most basic editor with just text input and history.</p>
    <div id="editor1"></div>
    <div class="info-panel">
      <strong>Try:</strong> Type some text and press <code>Ctrl+Z</code> / <code>Cmd+Z</code> to undo
    </div>
  </div>

  <!-- Example 2: Editor with controls -->
  <div class="example-section">
    <div class="example-title">2. Editor with Controls</div>
    <p class="example-desc">Basic editor with undo/redo buttons.</p>
    <div id="editor2"></div>
  </div>

  <!-- Example 3: Programmatic control -->
  <div class="example-section">
    <div class="example-title">3. Programmatic Control</div>
    <p class="example-desc">Demonstrates setting content programmatically.</p>
    <div id="editor3"></div>
    <div class="actions">
      <button class="btn" onclick="setContentExample()">Set Content</button>
      <button class="btn" onclick="clearContentExample()">Clear</button>
      <button class="btn" onclick="getContentExample()">Get Content</button>
    </div>
    <div class="info-panel" id="output3"></div>
  </div>

  <script type="module">
    import { createBasicEditor, createBasicEditorWithControls } from './BasicEditor.example.js';

    // Example 1: Simple editor
    window.editor1 = createBasicEditor(document.getElementById('editor1'), {
      content: 'This is a basic editor. Try typing!',
      contentType: 'text',
      autofocus: false,
      placeholder: 'Start typing...'
    });

    // Example 2: Editor with controls
    window.editor2 = createBasicEditorWithControls(document.getElementById('editor2'), {
      content: 'Try typing and using the undo/redo buttons above.',
      contentType: 'text'
    });

    // Example 3: Programmatic control
    window.editor3 = createBasicEditor(document.getElementById('editor3'), {
      placeholder: 'Use the buttons below to control this editor...'
    });

    // Helper functions for example 3
    window.setContentExample = () => {
      window.editor3.setContent('This content was set programmatically!', 'text');
    };

    window.clearContentExample = () => {
      window.editor3.clearContent();
    };

    window.getContentExample = () => {
      const text = window.editor3.getText();
      const html = window.editor3.getHTML();
      document.getElementById('output3').innerHTML =
        '<strong>Text:</strong> ' + text + '<br>' +
        '<strong>HTML:</strong> <code>' + html.replace(/</g, '&lt;') + '</code>';
    };
  </script>
</body>
</html>
`;
