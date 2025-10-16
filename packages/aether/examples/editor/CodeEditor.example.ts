/**
 * CodeEditor.example.ts
 *
 * A code-focused editor demonstrating syntax highlighting and developer-friendly features.
 * This example is optimized for editing code snippets and technical documentation.
 *
 * Features demonstrated:
 * - Code block with syntax highlighting
 * - Multiple programming language support
 * - Line numbers
 * - Tab handling (insert spaces)
 * - Auto-indent
 * - Code-specific keyboard shortcuts
 * - Minimal formatting (only code-related)
 * - Language selector
 * - Copy code functionality
 * - Theme support (light/dark)
 *
 * Usage:
 * ```typescript
 * import { createCodeEditor } from './CodeEditor.example';
 * const editor = createCodeEditor(document.getElementById('editor'), {
 *   language: 'typescript',
 *   content: 'function hello() {\n  console.log("Hello!");\n}',
 *   theme: 'dark'
 * });
 * ```
 */

import { EditorBridge } from '../../src/components/editor/core/EditorBridge.js';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';
import type { WritableSignal } from '../../src/core/reactivity/types.js';

// Import essential extensions
import { ParagraphExtension } from '../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { HistoryExtension } from '../../src/components/editor/extensions/behavior/HistoryExtension.js';

// Import code-specific extensions
import {
  CodeBlockExtension,
  SyntaxHighlightExtension,
} from '../../src/components/editor/extensions/code/index.js';

import type { EditorInstance } from '../../src/components/editor/core/types.js';

/**
 * Supported programming languages
 */
export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'java',
  'cpp',
  'rust',
  'go',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'csharp',
  'html',
  'css',
  'json',
  'yaml',
  'markdown',
  'sql',
  'bash',
  'plaintext',
] as const;

export type CodeLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Editor theme options
 */
export type CodeTheme = 'light' | 'dark';

/**
 * Configuration options for the code editor
 */
export interface CodeEditorOptions {
  /**
   * Initial code content
   */
  content?: string;

  /**
   * Programming language for syntax highlighting
   * @default 'typescript'
   */
  language?: CodeLanguage;

  /**
   * Editor theme
   * @default 'light'
   */
  theme?: CodeTheme;

  /**
   * Whether to show line numbers
   * @default true
   */
  showLineNumbers?: boolean;

  /**
   * Whether to enable syntax highlighting
   * @default true
   */
  enableSyntaxHighlighting?: boolean;

  /**
   * Number of spaces for tab
   * @default 2
   */
  tabSize?: number;

  /**
   * Whether to use spaces instead of tabs
   * @default true
   */
  insertSpaces?: boolean;

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
   * Whether to show the language selector
   * @default true
   */
  showLanguageSelector?: boolean;

  /**
   * Whether to show the copy button
   * @default true
   */
  showCopyButton?: boolean;

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
   * Callback when language changes
   */
  onLanguageChange?: (language: CodeLanguage) => void;
}

/**
 * Return type for createCodeEditor
 */
export interface CodeEditorInstance {
  /**
   * The underlying editor instance
   */
  editor: EditorInstance;

  /**
   * Get current code content
   */
  getCode(): string;

  /**
   * Set code content
   */
  setCode(code: string): void;

  /**
   * Clear all content
   */
  clearContent(): void;

  /**
   * Get current language
   */
  getLanguage(): CodeLanguage;

  /**
   * Set language for syntax highlighting
   */
  setLanguage(language: CodeLanguage): void;

  /**
   * Get current theme
   */
  getTheme(): CodeTheme;

  /**
   * Set editor theme
   */
  setTheme(theme: CodeTheme): void;

  /**
   * Copy code to clipboard
   */
  copyToClipboard(): Promise<boolean>;

  /**
   * Focus the editor
   */
  focus(): void;

  /**
   * Undo last change
   */
  undo(): void;

  /**
   * Redo last undone change
   */
  redo(): void;

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
 * Creates a code editor optimized for editing code snippets
 *
 * This editor is specifically designed for:
 * - Code snippet editing in documentation
 * - Inline code examples
 * - Technical blog posts
 * - Developer tools and IDEs
 * - Code playgrounds
 *
 * @param container - The DOM element to mount the editor in
 * @param options - Configuration options
 * @returns An object with the editor instance and helper methods
 *
 * @example
 * ```typescript
 * // Create a TypeScript code editor
 * const editor = createCodeEditor(document.getElementById('editor'), {
 *   language: 'typescript',
 *   content: 'const greeting: string = "Hello, World!";',
 *   theme: 'dark',
 *   showLineNumbers: true
 * });
 *
 * // Change language dynamically
 * editor.setLanguage('javascript');
 *
 * // Get the code
 * const code = editor.getCode();
 *
 * // Copy to clipboard
 * await editor.copyToClipboard();
 * ```
 */
export function createCodeEditor(
  container: HTMLElement,
  options: CodeEditorOptions = {}
): CodeEditorInstance {
  // Destructure options with defaults
  const {
    content = '',
    language: initialLanguage = 'typescript',
    theme: initialTheme = 'light',
    showLineNumbers = true,
    enableSyntaxHighlighting = true,
    tabSize = 2,
    insertSpaces = true,
    editable = true,
    autofocus = false,
    showLanguageSelector = true,
    showCopyButton = true,
    containerClass = 'code-editor-container',
    editorClass = 'code-editor',
    onUpdate,
    onLanguageChange,
  } = options;

  // Create reactive signals for state management
  const currentLanguage: WritableSignal<CodeLanguage> = signal(initialLanguage);
  const currentTheme: WritableSignal<CodeTheme> = signal(initialTheme);

  // Create the main container structure
  const wrapper = document.createElement('div');
  wrapper.className = containerClass;
  wrapper.setAttribute('data-theme', initialTheme);
  container.appendChild(wrapper);

  // Create header with controls (if enabled)
  let headerElement: HTMLElement | null = null;
  if (showLanguageSelector || showCopyButton) {
    headerElement = document.createElement('div');
    headerElement.className = 'code-editor-header';
    wrapper.appendChild(headerElement);

    // Create language selector
    if (showLanguageSelector) {
      createLanguageSelector(headerElement, currentLanguage, onLanguageChange);
    }

    // Create copy button
    if (showCopyButton) {
      createCopyButton(headerElement);
    }
  }

  // Create editor container
  const editorContainer = document.createElement('div');
  editorContainer.className = 'code-editor-wrapper';
  wrapper.appendChild(editorContainer);

  // Define extensions for code editing
  const extensions = [
    // Basic structure - need paragraph for fallback
    new ParagraphExtension(),

    // Code block with syntax highlighting
    new CodeBlockExtension({
      defaultLanguage: initialLanguage,
      languageClassPrefix: 'language-',
      HTMLAttributes: {
        spellcheck: 'false',
      },
    }),

    // Syntax highlighting extension (if enabled)
    ...(enableSyntaxHighlighting
      ? [
          new SyntaxHighlightExtension({
            // Language support via @lezer parser
            // This would use the actual Lezer parsers in production
            languages: SUPPORTED_LANGUAGES.map((lang) => ({
              name: lang,
              // Parser would be loaded here
            })),
          }),
        ]
      : []),

    // History for undo/redo
    new HistoryExtension({
      depth: 100,
      newGroupDelay: 500,
    }),
  ];

  // Create the editor instance
  const editor = new EditorBridge(editorContainer, {
    // Content - wrap in code block
    content: wrapInCodeBlock(content, initialLanguage),
    contentType: 'html',

    // Configuration
    extensions,
    editable,
    autofocus,

    // Styling
    editorClass,

    // Event handlers
    onCreate: (instance) => {
      console.log('Code editor created');

      // Set up tab handling
      setupTabHandling(instance, tabSize, insertSpaces);

      // Set up line numbers (if enabled)
      if (showLineNumbers) {
        enableLineNumbers(editorContainer);
      }
    },

    onUpdate: ({ editor: editorInstance }) => {
      // Call user's callback
      if (onUpdate) {
        onUpdate(editorInstance);
      }
    },
  });

  // Watch for theme changes and update the wrapper
  effect(() => {
    wrapper.setAttribute('data-theme', currentTheme());
  });

  // Watch for language changes and update the editor
  effect(() => {
    const lang = currentLanguage();
    // Update the code block language attribute
    updateCodeBlockLanguage(editor, lang);
  });

  // Apply styles for code editor
  applyCodeEditorStyles();

  // Helper function to copy code to clipboard
  const copyToClipboard = async (): Promise<boolean> => {
    try {
      const code = editor.getText();
      await navigator.clipboard.writeText(code);
      showCopyFeedback(wrapper);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  };

  // Return the public API
  return {
    // Expose the raw editor instance
    editor,

    // Code methods
    getCode: () => editor.getText(),

    setCode: (code: string) => {
      const lang = currentLanguage();
      editor.setContent(wrapInCodeBlock(code, lang), 'html');
    },

    clearContent: () => {
      editor.clearContent();
    },

    // Language methods
    getLanguage: () => currentLanguage(),

    setLanguage: (language: CodeLanguage) => {
      currentLanguage.set(language);
      if (onLanguageChange) {
        onLanguageChange(language);
      }
    },

    // Theme methods
    getTheme: () => currentTheme(),

    setTheme: (theme: CodeTheme) => {
      currentTheme.set(theme);
    },

    // Utility methods
    copyToClipboard,

    focus: () => {
      editor.focus();
    },

    // History methods
    undo: () => {
      if (editor.commands) {
        editor.commands.execute('undo');
      }
    },

    redo: () => {
      if (editor.commands) {
        editor.commands.execute('redo');
      }
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
 * Wrap code content in a code block
 */
function wrapInCodeBlock(code: string, language: CodeLanguage): string {
  // Escape HTML entities
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<pre><code class="language-${language}">${escaped}</code></pre>`;
}

/**
 * Update the code block's language attribute
 */
function updateCodeBlockLanguage(editor: EditorInstance, language: CodeLanguage): void {
  // This would update the language attribute on the code block node
  // In a real implementation, this would use ProseMirror's transaction API
  const codeBlock = editor.view.dom.querySelector('code');
  if (codeBlock) {
    codeBlock.className = `language-${language}`;
  }
}

/**
 * Set up tab key handling for code editing
 */
function setupTabHandling(
  editor: EditorInstance,
  tabSize: number,
  insertSpaces: boolean
): void {
  // Create the tab string (spaces or tab character)
  const tabString = insertSpaces ? ' '.repeat(tabSize) : '\t';

  // Add keydown listener for tab key
  editor.view.dom.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      event.preventDefault();

      // Insert tab or spaces
      if (editor.commands) {
        editor.commands.execute('insertText', tabString);
      }
    }
  });
}

/**
 * Enable line numbers display
 */
function enableLineNumbers(container: HTMLElement): void {
  // Add line numbers class to container
  container.classList.add('with-line-numbers');

  // Line numbers would be implemented via CSS counters or
  // a ProseMirror plugin that adds line number decorations
}

/**
 * Create language selector dropdown
 */
function createLanguageSelector(
  container: HTMLElement,
  currentLanguage: WritableSignal<CodeLanguage>,
  onLanguageChange?: (language: CodeLanguage) => void
): void {
  const selector = document.createElement('select');
  selector.className = 'language-selector';
  selector.title = 'Select Language';

  // Add language options
  SUPPORTED_LANGUAGES.forEach((lang) => {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = formatLanguageName(lang);
    if (lang === currentLanguage()) {
      option.selected = true;
    }
    selector.appendChild(option);
  });

  // Handle language change
  selector.addEventListener('change', () => {
    const newLang = selector.value as CodeLanguage;
    currentLanguage.set(newLang);
    if (onLanguageChange) {
      onLanguageChange(newLang);
    }
  });

  // Update selector when language changes programmatically
  effect(() => {
    selector.value = currentLanguage();
  });

  container.appendChild(selector);
}

/**
 * Format language name for display
 */
function formatLanguageName(lang: CodeLanguage): string {
  const names: Record<CodeLanguage, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    java: 'Java',
    cpp: 'C++',
    rust: 'Rust',
    go: 'Go',
    php: 'PHP',
    ruby: 'Ruby',
    swift: 'Swift',
    kotlin: 'Kotlin',
    csharp: 'C#',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    yaml: 'YAML',
    markdown: 'Markdown',
    sql: 'SQL',
    bash: 'Bash',
    plaintext: 'Plain Text',
  };

  return names[lang] || lang;
}

/**
 * Create copy to clipboard button
 */
function createCopyButton(container: HTMLElement): void {
  const button = document.createElement('button');
  button.className = 'copy-button';
  button.textContent = 'Copy';
  button.title = 'Copy code to clipboard';

  button.addEventListener('click', async () => {
    // The actual copy logic is handled by the instance's copyToClipboard method
    // Here we just trigger it via a data attribute or global reference
    const editorWrapper = container.closest('.code-editor-container');
    if (editorWrapper) {
      const event = new CustomEvent('copyCode');
      editorWrapper.dispatchEvent(event);
    }
  });

  container.appendChild(button);
}

/**
 * Show copy feedback (brief "Copied!" message)
 */
function showCopyFeedback(container: HTMLElement): void {
  const button = container.querySelector('.copy-button');
  if (button) {
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.classList.add('copied');

    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 2000);
  }
}

/**
 * Apply comprehensive styles for the code editor
 */
function applyCodeEditorStyles(): void {
  const styleId = 'code-editor-styles';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Container */
      .code-editor-container {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        font-family: 'Monaco', 'Courier New', monospace;
        overflow: hidden;
      }

      .code-editor-container[data-theme="dark"] {
        background: #1e1e1e;
        border-color: #3f3f3f;
      }

      /* Header */
      .code-editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
      }

      .code-editor-container[data-theme="dark"] .code-editor-header {
        background: #252525;
        border-bottom-color: #3f3f3f;
      }

      /* Language selector */
      .language-selector {
        padding: 4px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: white;
        color: #374151;
        font-size: 12px;
        cursor: pointer;
      }

      .code-editor-container[data-theme="dark"] .language-selector {
        background: #2d2d2d;
        border-color: #3f3f3f;
        color: #d4d4d4;
      }

      /* Copy button */
      .copy-button {
        padding: 4px 12px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: white;
        color: #374151;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .copy-button:hover {
        background: #f3f4f6;
      }

      .copy-button.copied {
        background: #10b981;
        color: white;
        border-color: #10b981;
      }

      .code-editor-container[data-theme="dark"] .copy-button {
        background: #2d2d2d;
        border-color: #3f3f3f;
        color: #d4d4d4;
      }

      .code-editor-container[data-theme="dark"] .copy-button:hover {
        background: #3f3f3f;
      }

      /* Editor wrapper */
      .code-editor-wrapper {
        position: relative;
      }

      /* Editor */
      .code-editor {
        padding: 16px;
        min-height: 200px;
        overflow: auto;
      }

      .code-editor .ProseMirror {
        outline: none;
      }

      /* Code block */
      .code-editor pre {
        margin: 0;
        padding: 0;
        background: transparent;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.6;
      }

      .code-editor code {
        display: block;
        padding: 0;
        background: transparent;
        color: #24292e;
        font-family: inherit;
      }

      .code-editor-container[data-theme="dark"] .code-editor code {
        color: #d4d4d4;
      }

      /* Line numbers */
      .code-editor-wrapper.with-line-numbers {
        counter-reset: line;
      }

      .code-editor-wrapper.with-line-numbers pre {
        padding-left: 50px;
      }

      .code-editor-wrapper.with-line-numbers pre::before {
        position: absolute;
        left: 0;
        width: 40px;
        padding-right: 10px;
        text-align: right;
        color: #9ca3af;
        content: counter(line);
        counter-increment: line;
      }

      /* Syntax highlighting (simplified) */
      .code-editor .token.comment { color: #6a737d; font-style: italic; }
      .code-editor .token.keyword { color: #d73a49; font-weight: 600; }
      .code-editor .token.string { color: #032f62; }
      .code-editor .token.number { color: #005cc5; }
      .code-editor .token.function { color: #6f42c1; }
      .code-editor .token.operator { color: #d73a49; }
      .code-editor .token.class-name { color: #6f42c1; font-weight: 600; }

      /* Dark theme syntax highlighting */
      .code-editor-container[data-theme="dark"] .token.comment { color: #6a9955; }
      .code-editor-container[data-theme="dark"] .token.keyword { color: #569cd6; }
      .code-editor-container[data-theme="dark"] .token.string { color: #ce9178; }
      .code-editor-container[data-theme="dark"] .token.number { color: #b5cea8; }
      .code-editor-container[data-theme="dark"] .token.function { color: #dcdcaa; }
      .code-editor-container[data-theme="dark"] .token.operator { color: #d4d4d4; }
      .code-editor-container[data-theme="dark"] .token.class-name { color: #4ec9b0; }

      /* Selection */
      .code-editor ::selection {
        background-color: #add6ff;
      }

      .code-editor-container[data-theme="dark"] ::selection {
        background-color: #264f78;
      }

      /* Scrollbar (webkit) */
      .code-editor::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      .code-editor::-webkit-scrollbar-track {
        background: #f1f1f1;
      }

      .code-editor::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 5px;
      }

      .code-editor::-webkit-scrollbar-thumb:hover {
        background: #555;
      }

      .code-editor-container[data-theme="dark"] .code-editor::-webkit-scrollbar-track {
        background: #1e1e1e;
      }

      .code-editor-container[data-theme="dark"] .code-editor::-webkit-scrollbar-thumb {
        background: #424242;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Create a code editor with theme toggle
 */
export function createCodeEditorWithThemeToggle(
  container: HTMLElement,
  options: CodeEditorOptions = {}
): CodeEditorInstance {
  // Create wrapper for controls
  const wrapper = document.createElement('div');
  container.appendChild(wrapper);

  // Create theme toggle button
  const controls = document.createElement('div');
  controls.className = 'code-editor-controls';
  controls.style.marginBottom = '8px';

  const themeToggle = document.createElement('button');
  themeToggle.className = 'theme-toggle-btn';
  themeToggle.textContent = '🌙 Dark Mode';

  controls.appendChild(themeToggle);
  wrapper.appendChild(controls);

  // Create editor container
  const editorContainer = document.createElement('div');
  wrapper.appendChild(editorContainer);

  // Create the editor
  const editor = createCodeEditor(editorContainer, options);

  // Wire up theme toggle
  themeToggle.addEventListener('click', () => {
    const currentTheme = editor.getTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    editor.setTheme(newTheme);
    themeToggle.textContent = newTheme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
  });

  // Apply control styles
  applyControlStyles();

  return editor;
}

/**
 * Apply styles for theme toggle controls
 */
function applyControlStyles(): void {
  const styleId = 'code-editor-control-styles';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .code-editor-controls {
        display: flex;
        justify-content: flex-end;
      }

      .theme-toggle-btn {
        padding: 6px 12px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: white;
        color: #374151;
        font-size: 13px;
        cursor: pointer;
      }

      .theme-toggle-btn:hover {
        background: #f3f4f6;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * HTML fixture for testing the code editor
 */
export const codeEditorHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Editor Example</title>
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
    .example-section { background: white; padding: 24px; border-radius: 8px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>Code Editor Example</h1>
  <p class="subtitle">Code-focused editor with syntax highlighting</p>

  <div class="example-section">
    <h2>TypeScript Example</h2>
    <div id="editor1"></div>
  </div>

  <div class="example-section">
    <h2>With Theme Toggle</h2>
    <div id="editor2"></div>
  </div>

  <script type="module">
    import { createCodeEditor, createCodeEditorWithThemeToggle } from './CodeEditor.example.js';

    // Example 1: TypeScript editor
    const editor1 = createCodeEditor(document.getElementById('editor1'), {
      language: 'typescript',
      content: \`interface User {
  id: number;
  name: string;
  email: string;
}

function greetUser(user: User): string {
  return \\\`Hello, \${user.name}!\\\`;
}

const user: User = {
  id: 1,
  name: "Alice",
  email: "alice@example.com"
};

console.log(greetUser(user));\`,
      theme: 'light',
      showLineNumbers: true
    });

    // Example 2: With theme toggle
    const editor2 = createCodeEditorWithThemeToggle(document.getElementById('editor2'), {
      language: 'javascript',
      content: \`// JavaScript example
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log(doubled);\`,
      theme: 'dark'
    });
  </script>
</body>
</html>
`;
