# Advanced Editor Component for Aether

**Version:** 1.0.0
**Author:** Omnitron Development Team
**Last Updated:** 2025-10-16
**Status:** Specification

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Core Components Design](#core-components-design)
4. [Key Features](#key-features)
5. [Aether Integration](#aether-integration)
6. [API Specification](#api-specification)
7. [Implementation Plan](#implementation-plan)
8. [Code Examples](#code-examples)
9. [Performance & Mobile](#performance--mobile)
10. [Testing & Documentation](#testing--documentation)

---

## Executive Summary

### Purpose and Goals

The Advanced Editor is a high-performance, extensible rich text and code editing component for the Aether framework. Built on ProseMirror's proven editing foundation, it provides a seamless integration with Aether's signal-based reactivity system while maintaining the flexibility and power of ProseMirror's architecture.

**Primary Goals:**

- Provide a production-ready rich text editor with minimal configuration
- Support advanced code editing with syntax highlighting and language-aware features
- Enable seamless switching between markdown, rich text, and code modes
- Maintain Aether's philosophy of minimalism and low cognitive load
- Deliver exceptional performance (sub-16ms interaction latency)
- Support extensive customization through a clean extension API
- Ensure full keyboard accessibility and screen reader support

### Key Differentiators

**vs. TipTap:**
- Native Aether integration with signals (no React/Vue adapter needed)
- Smaller bundle size (~15KB core + ProseMirror vs ~25KB for TipTap)
- First-class TypeScript support with full type inference
- Built-in code editing capabilities without additional plugins

**vs. Slate:**
- Proven stability of ProseMirror's operational transform model
- Better performance for large documents (>10,000 nodes)
- Rich ecosystem of existing ProseMirror plugins
- Lower learning curve for basic use cases

**vs. Monaco/CodeMirror:**
- Unified editing experience for rich text and code
- Better suited for content-first applications
- Lighter weight for embedded use cases
- Native markdown support

### Target Use Cases

1. **Content Management Systems**
   - Blog post editors
   - Documentation platforms
   - Wiki systems

2. **Developer Tools**
   - Code snippet editors
   - API documentation with live examples
   - Markdown-based technical writing

3. **Collaboration Applications**
   - Real-time document editing
   - Code review interfaces
   - Team wikis and knowledge bases

4. **Note-Taking Applications**
   - Personal knowledge management
   - Developer notebooks
   - Markdown editors

---

## Architecture Overview

### System Layers

```
┌─────────────────────────────────────────────────────────┐
│                   Aether Application                     │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│              Advanced Editor Component                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Editor Shell (Aether Component)                 │   │
│  │  - Toolbar, Menubar, Statusbar                   │   │
│  │  - Signal-based state management                 │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↕                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Aether-ProseMirror Bridge                       │   │
│  │  - EditorView wrapper                            │   │
│  │  - Signal sync (state → signals)                 │   │
│  │  - Event handling                                │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↕                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Extension System                                │   │
│  │  - Extension registry                            │   │
│  │  - Schema builder                                │   │
│  │  - Plugin manager                                │   │
│  │  - Keymap aggregator                             │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                  ProseMirror Core                        │
│  - EditorState                                           │
│  - EditorView                                            │
│  - Transaction system                                    │
│  - Schema & Transform                                    │
└─────────────────────────────────────────────────────────┘
```

### Core Architectural Principles

1. **Unidirectional Data Flow**
   - ProseMirror state is the single source of truth
   - Changes flow: User Input → Transaction → EditorState → Signals
   - External updates flow: Props → Transaction → EditorState

2. **Signal-Based Reactivity**
   - Editor state exposed as Aether signals
   - Derived signals for computed values (word count, validation)
   - Automatic UI updates on state changes

3. **Extension-First Design**
   - Core editor is minimal (schema + view)
   - All features implemented as extensions
   - Extensions can depend on other extensions

4. **Progressive Enhancement**
   - Basic functionality works without JavaScript
   - Enhanced features layer on top
   - Graceful degradation for unsupported browsers

### Data Flow

```
User Interaction
       ↓
   DOM Event
       ↓
   handleDOMEvent (ProseMirror)
       ↓
   dispatchTransaction
       ↓
   EditorState.apply(tr)
       ↓
   New EditorState
       ↓
   updateState() → Update Signals
       ↓
   Aether Reactivity System
       ↓
   UI Components Re-render
```

### State Management Architecture

```typescript
// Core editor state (ProseMirror)
interface EditorStateData {
  doc: Node;              // Document tree
  selection: Selection;   // Current selection
  storedMarks: Mark[];   // Marks for next insertion
  plugins: Plugin[];     // Active plugins
}

// Aether signal layer
interface EditorSignals {
  // Direct state signals
  doc: Signal<Node>;
  selection: Signal<Selection>;

  // Derived state signals
  isEmpty: Signal<boolean>;
  wordCount: Signal<number>;
  canUndo: Signal<boolean>;
  canRedo: Signal<boolean>;

  // Selection state
  selectedText: Signal<string>;
  currentMarks: Signal<Mark[]>;
  currentNodeType: Signal<NodeType | null>;

  // Editor state
  isFocused: Signal<boolean>;
  isEditable: Signal<boolean>;
}
```

---

## Core Components Design

### 1. Editor Container Component

**Purpose:** Main component that orchestrates the entire editor system.

**Responsibilities:**
- Initialize ProseMirror EditorView
- Manage extension lifecycle
- Sync ProseMirror state with Aether signals
- Handle props updates
- Coordinate sub-components (toolbar, content, statusbar)

**Component Structure:**

```typescript
interface EditorProps {
  // Content
  content?: string | JSONContent;
  contentType?: 'html' | 'markdown' | 'json';

  // Configuration
  extensions?: Extension[];
  editable?: boolean;
  autofocus?: boolean | 'start' | 'end';

  // Styling
  class?: string;
  editorClass?: string;

  // Events
  onCreate?: (editor: EditorInstance) => void;
  onUpdate?: (editor: EditorInstance) => void;
  onSelectionUpdate?: (editor: EditorInstance) => void;
  onTransaction?: (props: { editor: EditorInstance; transaction: Transaction }) => void;
  onFocus?: (editor: EditorInstance) => void;
  onBlur?: (editor: EditorInstance) => void;
  onDestroy?: () => void;

  // Advanced
  enableContentCaching?: boolean;
  enableCollaboration?: boolean;
}
```

### 2. Schema System

**Purpose:** Define the structure and capabilities of the document model.

**Design Philosophy:**
- Start with minimal base schema
- Extensions add nodes, marks, and attributes
- Schema is immutable once editor is created
- Full TypeScript typing for autocomplete

**Base Schema:**

```typescript
// Base nodes (minimal set)
const baseNodes = {
  doc: {
    content: 'block+'
  },
  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0]
  },
  text: {
    group: 'inline'
  }
};

// Base marks (minimal set)
const baseMarks = {
  // None in base - all added by extensions
};
```

**Schema Builder:**

```typescript
class SchemaBuilder {
  private nodes: Record<string, NodeSpec> = { ...baseNodes };
  private marks: Record<string, MarkSpec> = { ...baseMarks };

  addNode(name: string, spec: NodeSpec): this {
    this.nodes[name] = spec;
    return this;
  }

  addMark(name: string, spec: MarkSpec): this {
    this.marks[name] = spec;
    return this;
  }

  build(): Schema {
    return new Schema({
      nodes: this.nodes,
      marks: this.marks
    });
  }
}
```

### 3. Extension System

**Purpose:** Provide a composable way to add functionality to the editor.

**Extension Types:**

1. **Mark Extensions** - Text formatting (bold, italic, code)
2. **Node Extensions** - Block elements (heading, code block, list)
3. **Behavior Extensions** - Functionality (history, placeholder, paste handling)
4. **UI Extensions** - Interface components (toolbar, bubble menu)

**Extension Base Class:**

```typescript
abstract class Extension<Options = any> {
  // Extension metadata
  abstract readonly name: string;
  abstract readonly type: 'node' | 'mark' | 'behavior';

  // Configuration
  protected options: Options;

  // Dependencies
  readonly dependencies?: string[];

  constructor(options?: Partial<Options>) {
    this.options = { ...this.defaultOptions(), ...options };
  }

  // Configuration
  protected defaultOptions(): Options {
    return {} as Options;
  }

  // Schema contribution
  getSchema?(): { nodes?: Record<string, NodeSpec>; marks?: Record<string, MarkSpec> };

  // Plugin contribution
  getPlugins?(): Plugin[];

  // Input rules
  getInputRules?(): InputRule[];

  // Paste rules
  getPasteRules?(): PasteRule[];

  // Keyboard shortcuts
  getKeyboardShortcuts?(): Record<string, Command>;

  // Lifecycle hooks
  onCreate?(editor: EditorInstance): void;
  onDestroy?(): void;

  // Commands
  getCommands?(): Record<string, (...args: any[]) => Command>;
}
```

**Extension Registry:**

```typescript
class ExtensionManager {
  private extensions: Map<string, Extension> = new Map();
  private schema: Schema;
  private plugins: Plugin[];

  constructor(extensions: Extension[]) {
    // Resolve dependencies
    const sorted = this.topologicalSort(extensions);

    // Register extensions
    sorted.forEach(ext => this.extensions.set(ext.name, ext));

    // Build schema
    this.schema = this.buildSchema();

    // Collect plugins
    this.plugins = this.buildPlugins();
  }

  private topologicalSort(extensions: Extension[]): Extension[] {
    // Dependency resolution using topological sort
    // ...
  }

  private buildSchema(): Schema {
    const builder = new SchemaBuilder();

    for (const ext of this.extensions.values()) {
      const schema = ext.getSchema?.();
      if (schema) {
        Object.entries(schema.nodes || {}).forEach(([name, spec]) => {
          builder.addNode(name, spec);
        });
        Object.entries(schema.marks || {}).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }
    }

    return builder.build();
  }

  private buildPlugins(): Plugin[] {
    const plugins: Plugin[] = [];

    // Core plugins (always included)
    plugins.push(
      createHistoryPlugin(),
      createKeymapPlugin(this.getKeymap()),
      createInputRulesPlugin(this.getInputRules()),
      createPasteRulesPlugin(this.getPasteRules())
    );

    // Extension plugins
    for (const ext of this.extensions.values()) {
      const extPlugins = ext.getPlugins?.() || [];
      plugins.push(...extPlugins);
    }

    return plugins;
  }

  getExtension<T extends Extension>(name: string): T | undefined {
    return this.extensions.get(name) as T;
  }

  getSchema(): Schema {
    return this.schema;
  }

  getPlugins(): Plugin[] {
    return this.plugins;
  }

  private getKeymap(): Record<string, Command> {
    // Aggregate keymaps from all extensions
    // ...
  }

  private getInputRules(): InputRule[] {
    // Aggregate input rules from all extensions
    // ...
  }

  private getPasteRules(): PasteRule[] {
    // Aggregate paste rules from all extensions
    // ...
  }
}
```

### 4. View Components

#### Toolbar Component

**Purpose:** Provide quick access to formatting and editing commands.

```typescript
interface ToolbarConfig {
  items: ToolbarItem[];
  sticky?: boolean;
  class?: string;
}

type ToolbarItem =
  | ToolbarButton
  | ToolbarDropdown
  | ToolbarDivider
  | ToolbarGroup;

interface ToolbarButton {
  type: 'button';
  icon: string;
  title: string;
  command: string;
  isActive?: (editor: EditorInstance) => boolean;
  isDisabled?: (editor: EditorInstance) => boolean;
}

interface ToolbarDropdown {
  type: 'dropdown';
  icon: string;
  title: string;
  items: ToolbarButton[];
}

interface ToolbarDivider {
  type: 'divider';
}

interface ToolbarGroup {
  type: 'group';
  items: ToolbarItem[];
}
```

#### Content View Component

**Purpose:** Host the actual ProseMirror editor view.

```typescript
interface ContentViewProps {
  editorView: EditorView;
  class?: string;
  attributes?: Record<string, string>;
}
```

#### Statusbar Component

**Purpose:** Display editor state and metadata.

```typescript
interface StatusbarConfig {
  items: StatusbarItem[];
  position?: 'top' | 'bottom';
  class?: string;
}

type StatusbarItem =
  | StatusbarText
  | StatusbarButton
  | StatusbarCustom;

interface StatusbarText {
  type: 'text';
  render: (editor: EditorInstance) => string;
}

interface StatusbarButton {
  type: 'button';
  icon?: string;
  text?: string;
  onClick: (editor: EditorInstance) => void;
}

interface StatusbarCustom {
  type: 'custom';
  render: (editor: EditorInstance) => HTMLElement;
}
```

---

## Key Features

### 1. Rich Text Editing Capabilities

#### Text Formatting
- **Bold** (Ctrl/Cmd+B)
- **Italic** (Ctrl/Cmd+I)
- **Underline** (Ctrl/Cmd+U)
- **Strikethrough** (Ctrl/Cmd+Shift+X)
- **Code** (Ctrl/Cmd+E)
- **Superscript/Subscript**
- **Text color** and **highlight**
- **Font family** and **font size**

#### Block Formatting
- **Headings** (H1-H6)
- **Paragraphs** with alignment (left, center, right, justify)
- **Blockquotes**
- **Code blocks** with language selection
- **Horizontal rules**

#### Lists
- **Bullet lists** with nesting
- **Ordered lists** with nesting
- **Task lists** (checkboxes)
- **List manipulation** (indent, outdent, split, join)

#### Tables
- **Table insertion** with row/column specification
- **Cell operations** (merge, split)
- **Row/column operations** (insert, delete)
- **Table navigation** with keyboard
- **Cell styling** (background, borders)

#### Links and Media
- **Hyperlinks** with URL validation
- **Images** with alt text and sizing
- **Embedded videos** (YouTube, Vimeo)
- **File attachments**

### 2. Code Editing Features

#### Syntax Highlighting
```typescript
interface CodeBlockExtension {
  languages: {
    typescript: LanguageSupport;
    javascript: LanguageSupport;
    python: LanguageSupport;
    rust: LanguageSupport;
    go: LanguageSupport;
    // ... more languages
  };

  defaultLanguage: string;

  // Integration with @lezer/highlight for efficient syntax highlighting
  highlightConfig: HighlightConfig;
}
```

#### Code Editing Enhancements
- **Line numbers**
- **Line highlighting** (current line)
- **Bracket matching** and auto-closing
- **Auto-indentation**
- **Comment toggling**
- **Code folding**
- **Multiple cursors** (basic support)

#### Language-Specific Features
- **Linting** (via language server or custom rules)
- **Basic autocomplete** (keywords, snippets)
- **Format on paste** (with Prettier integration)

### 3. Markdown Support

#### Markdown Input
```typescript
interface MarkdownExtension {
  // Convert markdown shortcuts to rich text
  shortcuts: {
    '**text**' → bold;
    '*text*' → italic;
    '`code`' → inline code;
    '# ' → heading 1;
    '## ' → heading 2;
    '- ' → bullet list;
    '1. ' → ordered list;
    '> ' → blockquote;
    '```' → code block;
    '---' → horizontal rule;
  };

  // Paste markdown as rich text
  pasteAsMarkdown: boolean;

  // Export as markdown
  toMarkdown(): string;
}
```

#### Markdown Preview
- **Live preview** mode (side-by-side)
- **Toggle view** (edit / preview / split)
- **Custom markdown renderer** (with GFM support)

### 4. Collaborative Editing

```typescript
interface CollaborationExtension {
  // Y.js integration for CRDT-based collaboration
  provider: 'websocket' | 'webrtc' | 'custom';

  // User presence
  showCursors: boolean;
  showSelections: boolean;

  // Awareness
  userColor: string;
  userName: string;

  // Configuration
  debounceMs: number;
  maxAttempts: number;
}
```

### 5. History and Undo/Redo

```typescript
interface HistoryExtension {
  depth: number;           // Max undo steps (default: 100)
  newGroupDelay: number;   // Time to group changes (default: 500ms)

  commands: {
    undo: Command;
    redo: Command;
    clearHistory: Command;
  };
}
```

### 6. Search and Replace

```typescript
interface SearchExtension {
  // Search functionality
  search(query: string, options?: SearchOptions): SearchResult[];

  // Replace functionality
  replace(target: string, replacement: string): void;
  replaceAll(target: string, replacement: string): void;

  // Search options
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;

  // UI
  showSearchPanel: boolean;
  highlightMatches: boolean;
}
```

### 7. Drag and Drop

```typescript
interface DragDropExtension {
  // Drag and drop support
  allowDrop: (event: DragEvent) => boolean;
  handleDrop: (event: DragEvent, pos: number) => boolean;

  // Image upload on drop
  uploadImage?: (file: File) => Promise<string>;

  // File handling
  maxFileSize: number;
  allowedFileTypes: string[];
}
```

### 8. Accessibility

#### Keyboard Navigation
- **Full keyboard accessibility** (WCAG 2.1 AA compliant)
- **Focus management** with visible indicators
- **Keyboard shortcuts** with customization
- **Escape hatch** for toolbar/menu navigation

#### Screen Reader Support
- **ARIA labels** and descriptions
- **Live regions** for state changes
- **Semantic HTML** structure
- **Alternative text** for images and media

#### Visual Accessibility
- **High contrast** mode support
- **Reduced motion** mode
- **Focus visible** styles
- **Color contrast** (minimum 4.5:1)

---

## Aether Integration

### Signal-Based State Management

```typescript
// Core editor signals
interface EditorState {
  // Document state
  doc: Signal<Node>;

  // Selection state
  selection: Signal<Selection>;
  selectedText: Signal<string>;

  // Cursor position
  cursorPos: Signal<number>;

  // Document metadata
  isEmpty: Signal<boolean>;
  wordCount: Signal<number>;
  charCount: Signal<number>;

  // Editor capabilities
  canUndo: Signal<boolean>;
  canRedo: Signal<boolean>;

  // Active formatting
  activeMarks: Signal<Mark[]>;
  activeNode: Signal<Node | null>;

  // Focus state
  isFocused: Signal<boolean>;

  // Editable state
  isEditable: Signal<boolean>;
}

// Derived signals
const wordCount = createMemo(() => {
  const text = editorState.doc().textContent;
  return text.split(/\s+/).filter(Boolean).length;
});

const isEmpty = createMemo(() => {
  return editorState.doc().childCount === 0 ||
    (editorState.doc().childCount === 1 &&
     editorState.doc().firstChild?.isTextblock &&
     editorState.doc().firstChild.content.size === 0);
});
```

### Component Pattern

```typescript
import { defineComponent, Signal, createSignal, onMount, onCleanup } from 'aether';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';

export const AdvancedEditor = defineComponent<EditorProps>((props) => {
  // Local signals
  const editorView = createSignal<EditorView | null>(null);
  const editorContainer = createSignal<HTMLElement | null>(null);

  // Editor state signals (synced with ProseMirror)
  const doc = createSignal<Node>(createEmptyDoc());
  const selection = createSignal<Selection>(Selection.atStart(doc()));
  const isFocused = createSignal(false);

  // Initialize editor
  onMount(() => {
    const container = editorContainer();
    if (!container) return;

    // Create extension manager
    const extensionManager = new ExtensionManager(props.extensions || []);

    // Create editor state
    const state = EditorState.create({
      doc: parseContent(props.content, props.contentType),
      plugins: extensionManager.getPlugins(),
    });

    // Create editor view
    const view = new EditorView(container, {
      state,
      dispatchTransaction: (tr) => {
        // Apply transaction
        const newState = view.state.apply(tr);
        view.updateState(newState);

        // Sync with signals
        if (tr.docChanged) {
          doc.set(newState.doc);
        }
        if (tr.selectionSet) {
          selection.set(newState.selection);
        }

        // Call user callbacks
        props.onUpdate?.({ state: newState, view });
        if (tr.docChanged) {
          props.onTransaction?.({ transaction: tr, view });
        }
      },
      handleDOMEvents: {
        focus: () => {
          isFocused.set(true);
          props.onFocus?.({ state: view.state, view });
          return false;
        },
        blur: () => {
          isFocused.set(false);
          props.onBlur?.({ state: view.state, view });
          return false;
        },
      },
    });

    editorView.set(view);
    props.onCreate?.({ state: view.state, view });
  });

  // Cleanup
  onCleanup(() => {
    const view = editorView();
    if (view) {
      view.destroy();
      props.onDestroy?.();
    }
  });

  // Render
  return {
    tag: 'div',
    class: props.class,
    children: [
      // Toolbar (optional)
      props.toolbar && {
        tag: Toolbar,
        props: {
          editor: editorView,
          config: props.toolbar,
        },
      },

      // Editor content
      {
        tag: 'div',
        class: 'editor-content',
        ref: editorContainer,
      },

      // Statusbar (optional)
      props.statusbar && {
        tag: Statusbar,
        props: {
          editor: editorView,
          config: props.statusbar,
        },
      },
    ],
  };
});
```

### Styling System

```typescript
// CSS Variables for theming
const editorTheme = {
  // Colors
  '--editor-bg': 'var(--surface-1)',
  '--editor-text': 'var(--text-1)',
  '--editor-border': 'var(--border-1)',
  '--editor-focus': 'var(--primary)',
  '--editor-selection': 'var(--primary-alpha-20)',

  // Typography
  '--editor-font-family': 'var(--font-sans)',
  '--editor-font-size': '16px',
  '--editor-line-height': '1.6',

  // Spacing
  '--editor-padding': 'var(--space-4)',
  '--editor-gap': 'var(--space-2)',

  // Code blocks
  '--code-bg': 'var(--surface-2)',
  '--code-text': 'var(--text-2)',
  '--code-font-family': 'var(--font-mono)',
};

// Scoped styles
const styles = css`
  .advanced-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--editor-bg);
    border: 1px solid var(--editor-border);
    border-radius: var(--radius-2);
  }

  .editor-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--editor-padding);
  }

  .ProseMirror {
    font-family: var(--editor-font-family);
    font-size: var(--editor-font-size);
    line-height: var(--editor-line-height);
    color: var(--editor-text);
    outline: none;
  }

  .ProseMirror-focused {
    outline: 2px solid var(--editor-focus);
    outline-offset: -2px;
  }

  .ProseMirror ::selection {
    background: var(--editor-selection);
  }

  .ProseMirror p {
    margin: var(--space-2) 0;
  }

  .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
    margin: var(--space-4) 0 var(--space-2);
    line-height: 1.3;
  }

  .ProseMirror code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: var(--radius-1);
    font-family: var(--code-font-family);
    font-size: 0.9em;
  }

  .ProseMirror pre {
    background: var(--code-bg);
    padding: var(--space-3);
    border-radius: var(--radius-2);
    overflow-x: auto;
  }

  .ProseMirror pre code {
    background: none;
    padding: 0;
  }
`;
```

### Theme Integration

```typescript
// Integrate with Aether's theme system
import { useTheme } from 'aether/theme';

const EditorWithTheme = defineComponent<EditorProps>((props) => {
  const theme = useTheme();

  // Apply theme-specific styles
  const editorClass = createMemo(() => {
    return [
      'advanced-editor',
      theme().mode === 'dark' ? 'editor-dark' : 'editor-light',
      props.class,
    ].filter(Boolean).join(' ');
  });

  return {
    tag: AdvancedEditor,
    props: {
      ...props,
      class: editorClass(),
    },
  };
});
```

---

## API Specification

### Main Editor Component

```typescript
interface AdvancedEditorProps {
  // Content
  content?: string | JSONContent;
  contentType?: 'html' | 'markdown' | 'json';
  placeholder?: string;

  // Configuration
  extensions?: Extension[];
  editable?: boolean;
  autofocus?: boolean | 'start' | 'end' | number;

  // UI Components
  toolbar?: ToolbarConfig | false;
  statusbar?: StatusbarConfig | false;
  menubar?: MenubarConfig | false;
  bubbleMenu?: BubbleMenuConfig | false;

  // Styling
  class?: string;
  editorClass?: string;
  contentClass?: string;

  // Events
  onCreate?: (editor: EditorInstance) => void;
  onUpdate?: (props: { editor: EditorInstance }) => void;
  onSelectionUpdate?: (props: { editor: EditorInstance }) => void;
  onTransaction?: (props: { editor: EditorInstance; transaction: Transaction }) => void;
  onFocus?: (props: { editor: EditorInstance; event: FocusEvent }) => void;
  onBlur?: (props: { editor: EditorInstance; event: FocusEvent }) => void;
  onDestroy?: () => void;

  // Content events
  onContentError?: (props: { editor: EditorInstance; error: Error }) => void;

  // Advanced
  enableContentCaching?: boolean;
  parseOptions?: ParseOptions;
  serializeOptions?: SerializeOptions;
}

interface EditorInstance {
  // State
  state: EditorState;
  view: EditorView;

  // Signals (Aether integration)
  signals: EditorSignals;

  // Commands
  commands: CommandManager;

  // Content
  getHTML(): string;
  getJSON(): JSONContent;
  getMarkdown(): string;
  getText(): string;

  setContent(content: string | JSONContent, options?: SetContentOptions): void;
  clearContent(): void;

  // Selection
  focus(position?: 'start' | 'end' | number): void;
  blur(): void;
  setSelection(from: number, to?: number): void;

  // State
  can(): ChainedCommands;  // Check if command can be executed

  // Lifecycle
  destroy(): void;

  // Extensions
  getExtension<T extends Extension>(name: string): T | undefined;

  // Schema
  schema: Schema;

  // Utilities
  isEmpty: boolean;
  isFocused: boolean;
  isEditable: boolean;
}
```

### Command System

```typescript
interface CommandManager {
  // Execute command
  execute(name: string, ...args: any[]): boolean;

  // Chain commands
  chain(): ChainedCommands;

  // Check if command can be executed
  can(name: string, ...args: any[]): boolean;

  // Register custom command
  register(name: string, command: Command): void;
}

interface ChainedCommands {
  // Text formatting
  bold(): ChainedCommands;
  italic(): ChainedCommands;
  underline(): ChainedCommands;
  strike(): ChainedCommands;
  code(): ChainedCommands;

  // Clear formatting
  clearMarks(): ChainedCommands;
  clearNodes(): ChainedCommands;

  // Block formatting
  heading(level: 1 | 2 | 3 | 4 | 5 | 6): ChainedCommands;
  paragraph(): ChainedCommands;
  blockquote(): ChainedCommands;
  codeBlock(language?: string): ChainedCommands;
  horizontalRule(): ChainedCommands;

  // Lists
  bulletList(): ChainedCommands;
  orderedList(): ChainedCommands;
  taskList(): ChainedCommands;
  toggleList(type: 'bullet' | 'ordered' | 'task'): ChainedCommands;

  // List operations
  sinkListItem(): ChainedCommands;
  liftListItem(): ChainedCommands;
  splitListItem(): ChainedCommands;

  // Links and media
  link(href: string, options?: LinkOptions): ChainedCommands;
  unlink(): ChainedCommands;
  image(src: string, options?: ImageOptions): ChainedCommands;

  // Tables
  insertTable(rows: number, cols: number): ChainedCommands;
  deleteTable(): ChainedCommands;
  addColumnBefore(): ChainedCommands;
  addColumnAfter(): ChainedCommands;
  deleteColumn(): ChainedCommands;
  addRowBefore(): ChainedCommands;
  addRowAfter(): ChainedCommands;
  deleteRow(): ChainedCommands;
  mergeCells(): ChainedCommands;
  splitCell(): ChainedCommands;

  // History
  undo(): ChainedCommands;
  redo(): ChainedCommands;

  // Selection
  selectAll(): ChainedCommands;
  selectTextblock(): ChainedCommands;
  selectNode(pos: number): ChainedCommands;

  // Content
  insertContent(content: string | JSONContent, options?: InsertContentOptions): ChainedCommands;
  deleteSelection(): ChainedCommands;
  deleteRange(from: number, to: number): ChainedCommands;

  // Execute the chain
  run(): boolean;
}
```

### Extension API

```typescript
// Example: Bold extension
class BoldExtension extends Extension<BoldOptions> {
  readonly name = 'bold';
  readonly type = 'mark' as const;

  defaultOptions(): BoldOptions {
    return {
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      marks: {
        bold: {
          parseDOM: [
            { tag: 'strong' },
            { tag: 'b', getAttrs: (node) => node.style.fontWeight !== 'normal' && null },
            { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null },
          ],
          toDOM: () => ['strong', this.options.HTMLAttributes, 0],
        },
      },
    };
  }

  getKeyboardShortcuts() {
    return {
      'Mod-b': toggleMark(this.editor.schema.marks.bold),
    };
  }

  getCommands() {
    return {
      bold: () => toggleMark(this.editor.schema.marks.bold),
      setBold: () => setMark(this.editor.schema.marks.bold),
      unsetBold: () => unsetMark(this.editor.schema.marks.bold),
    };
  }

  getInputRules() {
    return [
      markInputRule(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/, this.editor.schema.marks.bold),
    ];
  }
}

// Usage
const editor = new AdvancedEditor({
  extensions: [
    new BoldExtension(),
    // ... other extensions
  ],
});
```

### Built-in Extensions

```typescript
// Text formatting
export { BoldExtension } from './extensions/bold';
export { ItalicExtension } from './extensions/italic';
export { UnderlineExtension } from './extensions/underline';
export { StrikeExtension } from './extensions/strike';
export { CodeExtension } from './extensions/code';
export { LinkExtension } from './extensions/link';

// Block formatting
export { HeadingExtension } from './extensions/heading';
export { ParagraphExtension } from './extensions/paragraph';
export { BlockquoteExtension } from './extensions/blockquote';
export { CodeBlockExtension } from './extensions/code-block';
export { HorizontalRuleExtension } from './extensions/horizontal-rule';

// Lists
export { BulletListExtension } from './extensions/bullet-list';
export { OrderedListExtension } from './extensions/ordered-list';
export { TaskListExtension } from './extensions/task-list';
export { ListItemExtension } from './extensions/list-item';

// Tables
export { TableExtension } from './extensions/table';
export { TableRowExtension } from './extensions/table-row';
export { TableCellExtension } from './extensions/table-cell';
export { TableHeaderExtension } from './extensions/table-header';

// Media
export { ImageExtension } from './extensions/image';
export { VideoExtension } from './extensions/video';

// Behavior
export { HistoryExtension } from './extensions/history';
export { PlaceholderExtension } from './extensions/placeholder';
export { DropCursorExtension } from './extensions/drop-cursor';
export { GapCursorExtension } from './extensions/gap-cursor';

// Code editing
export { SyntaxHighlightExtension } from './extensions/syntax-highlight';
export { AutocompleteExtension } from './extensions/autocomplete';
export { LinterExtension } from './extensions/linter';

// Markdown
export { MarkdownExtension } from './extensions/markdown';

// Collaboration
export { CollaborationExtension } from './extensions/collaboration';
export { CollaborationCursorExtension } from './extensions/collaboration-cursor';

// Utilities
export { SearchExtension } from './extensions/search';
export { CharacterCountExtension } from './extensions/character-count';
export { WordCountExtension } from './extensions/word-count';
```

### Event Handlers

```typescript
interface EditorEventHandlers {
  // Lifecycle events
  onCreate?: (editor: EditorInstance) => void;
  onDestroy?: () => void;

  // Content events
  onUpdate?: (props: UpdateEventProps) => void;
  onSelectionUpdate?: (props: SelectionUpdateEventProps) => void;
  onTransaction?: (props: TransactionEventProps) => void;

  // Focus events
  onFocus?: (props: FocusEventProps) => void;
  onBlur?: (props: BlurEventProps) => void;

  // Content loading
  onContentError?: (props: ContentErrorEventProps) => void;
  onContentLoad?: (props: ContentLoadEventProps) => void;

  // Paste events
  onPaste?: (props: PasteEventProps) => void;
  onDrop?: (props: DropEventProps) => void;

  // Key events (for custom handling)
  onKeyDown?: (props: KeyEventProps) => boolean;
  onKeyUp?: (props: KeyEventProps) => boolean;
}

interface UpdateEventProps {
  editor: EditorInstance;
  transaction: Transaction;
}

interface SelectionUpdateEventProps {
  editor: EditorInstance;
  oldSelection: Selection;
  newSelection: Selection;
}

interface TransactionEventProps {
  editor: EditorInstance;
  transaction: Transaction;
  oldState: EditorState;
  newState: EditorState;
}

interface FocusEventProps {
  editor: EditorInstance;
  event: FocusEvent;
}

interface BlurEventProps {
  editor: EditorInstance;
  event: FocusEvent;
}

interface ContentErrorEventProps {
  editor: EditorInstance;
  error: Error;
  content: string | JSONContent;
}

interface PasteEventProps {
  editor: EditorInstance;
  event: ClipboardEvent;
  slice: Slice;
}

interface DropEventProps {
  editor: EditorInstance;
  event: DragEvent;
  slice: Slice;
  moved: boolean;
}

interface KeyEventProps {
  editor: EditorInstance;
  event: KeyboardEvent;
}
```

---

## Implementation Plan

### Phase 1: Core Foundation (Weeks 1-2) ✅ COMPLETED

**Status:** ✅ Completed on 2025-10-16
**Commit:** 244224c - "feat(aether): Implement Advanced Editor Phase 1 - Core Foundation"

**Deliverables:**
1. ✅ Project structure and build setup
2. ✅ ProseMirror integration layer
3. ✅ Basic Extension system
4. ✅ Aether signal integration
5. ✅ Simple editor component (text only)

**Tasks:**
- ✅ Set up package structure in `packages/aether/src/components/editor/`
- ✅ Install dependencies (prosemirror-*, @lezer/*)
- ✅ Create base Extension class
- ✅ Implement ExtensionManager with dependency resolution
- ✅ Create SchemaBuilder
- ✅ Build Aether-ProseMirror bridge
- ✅ Create basic Editor component with signals
- ✅ Write unit tests for core classes

**Files Created:**
```
packages/aether/src/components/editor/
├── index.ts                     ✅
├── AdvancedEditor.ts            ✅
├── README.md                    ✅
├── core/
│   ├── Extension.ts             ✅
│   ├── ExtensionManager.ts      ✅
│   ├── SchemaBuilder.ts         ✅
│   ├── EditorBridge.ts          ✅
│   └── types.ts                 ✅
├── signals/
│   ├── editorSignals.ts         ✅
│   └── derivedSignals.ts        ✅
└── utils/
    ├── content.ts               ✅
    ├── selection.ts             ✅
    └── commands.ts              ✅

packages/aether/test/components/editor/
├── Extension.test.ts            ✅ (9 tests)
├── SchemaBuilder.test.ts        ✅ (10 tests)
├── ExtensionManager.test.ts     ✅ (10 tests)
├── EditorBridge.test.ts         ✅ (20 tests)
└── AdvancedEditor.test.ts       ✅ (8 tests)

packages/aether/examples/
└── editor-basic.example.ts      ✅
```

**Success Criteria:**
- ✅ Can create an editor with basic text input
- ✅ Extensions can register and modify schema
- ✅ Signals update on document changes
- ✅ Tests pass with 100% pass rate (57/57 tests)
- ✅ No TypeScript compilation errors
- ✅ No linter errors
- ✅ Build succeeds (dist output: 152KB)

### Phase 2: Essential Extensions (Weeks 3-4) ✅ COMPLETED

**Status:** ✅ Completed on 2025-10-16
**Commit:** d3565c7 - "feat(aether): Implement Advanced Editor Phase 2 - Essential Extensions"

**Deliverables:**
1. ✅ Text formatting extensions (bold, italic, underline, etc.)
2. ✅ Block formatting extensions (headings, paragraphs, blockquote)
3. ✅ List extensions (bullet, ordered, task)
4. ✅ History extension (undo/redo)
5. ✅ Basic toolbar component

**Tasks:**
- ✅ Implement mark extensions (bold, italic, underline, strike, code)
- ✅ Implement node extensions (heading, paragraph, blockquote, horizontal rule)
- ✅ Implement list extensions with proper nesting
- ✅ Create history extension wrapper
- ✅ Build CommandManager
- ✅ Create Toolbar component with Aether
- ✅ Add keyboard shortcuts
- ✅ Add input rules for markdown shortcuts
- ✅ Write integration tests

**Files Created (46 files, 6,636 lines):**
```
packages/aether/src/components/editor/
├── extensions/
│   ├── marks/                           ✅
│   │   ├── BoldExtension.ts            ✅
│   │   ├── ItalicExtension.ts          ✅
│   │   ├── UnderlineExtension.ts       ✅
│   │   ├── StrikeExtension.ts          ✅
│   │   ├── CodeExtension.ts            ✅
│   │   └── index.ts                    ✅
│   ├── nodes/                           ✅
│   │   ├── HeadingExtension.ts         ✅
│   │   ├── ParagraphExtension.ts       ✅
│   │   ├── BlockquoteExtension.ts      ✅
│   │   ├── HorizontalRuleExtension.ts  ✅
│   │   └── index.ts                    ✅
│   ├── lists/                           ✅
│   │   ├── BulletListExtension.ts      ✅
│   │   ├── OrderedListExtension.ts     ✅
│   │   ├── TaskListExtension.ts        ✅
│   │   ├── TaskItemExtension.ts        ✅
│   │   ├── ListItemExtension.ts        ✅
│   │   └── index.ts                    ✅
│   └── behavior/                        ✅
│       ├── HistoryExtension.ts         ✅
│       └── index.ts                    ✅
├── components/                          ✅
│   ├── Toolbar.ts                      ✅
│   ├── ToolbarButton.ts                ✅
│   └── index.ts                        ✅
├── commands/                            ✅
│   ├── CommandManager.ts               ✅
│   └── index.ts                        ✅
└── utils/
    └── inputRules.ts                   ✅

packages/aether/test/components/editor/
├── extensions/marks/                    ✅ (85 tests)
│   ├── Bold.test.ts                    ✅
│   ├── Italic.test.ts                  ✅
│   ├── Underline.test.ts               ✅
│   ├── Strike.test.ts                  ✅
│   └── Code.test.ts                    ✅
├── extensions/nodes/                    ✅ (99 tests)
│   ├── Heading.test.ts                 ✅
│   ├── Paragraph.test.ts               ✅
│   ├── Blockquote.test.ts              ✅
│   └── HorizontalRule.test.ts          ✅
├── extensions/lists/                    ✅ (72 tests)
│   ├── BulletList.test.ts              ✅
│   ├── OrderedList.test.ts             ✅
│   ├── TaskList.test.ts                ✅
│   └── ListItem.test.ts                ✅
├── extensions/behavior/                 ✅ (28 tests)
│   └── History.test.ts                 ✅
├── commands/                            ✅ (33 tests)
│   └── CommandManager.test.ts          ✅
└── components/                          ✅ (40 tests)
    ├── Toolbar.test.ts                 ✅
    └── ToolbarButton.test.ts           ✅
```

**Test Results:**
- ✅ Total tests: 414 (Phase 1: 57, Phase 2: 357)
- ✅ Pass rate: 100% (414/414)
- ✅ Test duration: ~1.5s

**Success Criteria:**
- ✅ All basic formatting works via toolbar and shortcuts
- ✅ Undo/redo functions correctly
- ✅ Lists support nesting and all operations
- ✅ Toolbar updates based on active formatting
- ✅ Tests pass with >85% coverage (achieved 100%)
- ✅ Input rules work (markdown-style shortcuts)
- ✅ Keyboard shortcuts functional
- ✅ No TypeScript errors
- ✅ No linter errors
- ✅ Build succeeds (168.73 KB)

**Dependencies Added:**
- prosemirror-history: ^1.4.1
- prosemirror-schema-list: ^1.5.1

### Phase 3: Advanced Features (Weeks 5-6)

**Deliverables:**
1. Link extension with URL validation
2. Image extension with upload support
3. Table extensions with full manipulation
4. Code block with syntax highlighting
5. Placeholder and drop cursor extensions
6. Statusbar component

**Tasks:**
- Implement link extension with bubble menu
- Create image extension with upload callback
- Build table extensions (table, row, cell, header)
- Integrate @lezer/highlight for syntax highlighting
- Create code block extension with language selector
- Add placeholder extension
- Add drop cursor and gap cursor extensions
- Build Statusbar component
- Add drag-and-drop support
- Write E2E tests

**Files to Create:**
```
packages/aether/src/components/editor/
├── extensions/
│   ├── media/
│   │   ├── LinkExtension.ts
│   │   └── ImageExtension.ts
│   ├── table/
│   │   ├── TableExtension.ts
│   │   ├── TableRowExtension.ts
│   │   ├── TableCellExtension.ts
│   │   └── TableHeaderExtension.ts
│   ├── code/
│   │   ├── CodeBlockExtension.ts
│   │   └── SyntaxHighlightExtension.ts
│   └── behavior/
│       ├── PlaceholderExtension.ts
│       ├── DropCursorExtension.ts
│       └── GapCursorExtension.ts
├── components/
│   ├── Statusbar.ts
│   ├── BubbleMenu.ts
│   └── LinkEditor.ts
└── utils/
    ├── upload.ts
    └── validation.ts
```

**Success Criteria:**
- Links work with editing UI
- Images can be uploaded and inserted
- Tables support all operations
- Code blocks show syntax highlighting
- Drag and drop works for images and text
- Tests pass with >85% coverage

### Phase 4: Markdown & Collaboration (Weeks 7-8)

**Deliverables:**
1. Markdown extension with full support
2. Markdown preview mode
3. Collaboration extension (Y.js integration)
4. Search and replace extension
5. Character/word count extensions

**Tasks:**
- Create markdown parser and serializer
- Implement markdown input rules
- Build markdown preview component
- Integrate Y.js for collaboration
- Add collaboration cursor extension
- Create search extension with UI
- Build character and word count extensions
- Add paste rules for markdown
- Write collaboration tests

**Files to Create:**
```
packages/aether/src/components/editor/
├── extensions/
│   ├── markdown/
│   │   ├── MarkdownExtension.ts
│   │   ├── parser.ts
│   │   └── serializer.ts
│   ├── collaboration/
│   │   ├── CollaborationExtension.ts
│   │   └── CollaborationCursorExtension.ts
│   ├── search/
│   │   └── SearchExtension.ts
│   └── utils/
│       ├── CharacterCountExtension.ts
│       └── WordCountExtension.ts
├── components/
│   ├── MarkdownPreview.ts
│   └── SearchPanel.ts
└── utils/
    └── markdown.ts
```

**Success Criteria:**
- Markdown input and output works correctly
- Preview mode renders markdown accurately
- Collaboration works with multiple users
- Search and replace functions correctly
- Tests pass with >85% coverage

### Phase 5: Polish & Documentation (Weeks 9-10)

**Deliverables:**
1. Complete API documentation
2. Usage examples and demos
3. Accessibility improvements
4. Performance optimizations
5. Theme integration
6. Mobile support

**Tasks:**
- Write comprehensive API documentation
- Create example applications
- Add ARIA labels and keyboard navigation
- Optimize rendering performance
- Add mobile touch support
- Create theme variants
- Write migration guide from other editors
- Performance benchmarks
- Final integration tests

**Files to Create:**
```
packages/aether/
├── docs/
│   ├── editor/
│   │   ├── getting-started.md
│   │   ├── api-reference.md
│   │   ├── extensions.md
│   │   ├── theming.md
│   │   └── migration.md
├── examples/
│   ├── BasicEditor.example.tsx
│   ├── RichTextEditor.example.tsx
│   ├── CodeEditor.example.tsx
│   ├── MarkdownEditor.example.tsx
│   └── CollaborativeEditor.example.tsx
└── src/components/editor/
    ├── themes/
    │   ├── default.css
    │   ├── minimal.css
    │   └── github.css
    └── accessibility/
        ├── AriaLive.ts
        └── KeyboardNavigation.ts
```

**Success Criteria:**
- All documentation is complete and clear
- Examples cover all major use cases
- WCAG 2.1 AA compliance achieved
- Performance meets targets (<16ms latency)
- Mobile experience is smooth
- Bundle size is optimized (<50KB gzipped with ProseMirror)

### Dependencies

**Required Packages:**
```json
{
  "dependencies": {
    "prosemirror-state": "^1.4.3",
    "prosemirror-view": "^1.32.7",
    "prosemirror-model": "^1.19.4",
    "prosemirror-transform": "^1.8.0",
    "prosemirror-commands": "^1.5.2",
    "prosemirror-keymap": "^1.2.2",
    "prosemirror-history": "^1.3.2",
    "prosemirror-inputrules": "^1.3.0",
    "prosemirror-schema-list": "^1.3.0",
    "prosemirror-tables": "^1.3.5",
    "prosemirror-gapcursor": "^1.3.2",
    "prosemirror-dropcursor": "^1.8.1",
    "@lezer/highlight": "^1.2.0",
    "@lezer/common": "^1.2.0"
  },
  "peerDependencies": {
    "aether": "workspace:*"
  },
  "optionalDependencies": {
    "y-prosemirror": "^1.2.5",
    "yjs": "^13.6.10"
  }
}
```

---

## Code Examples

### Example 1: Basic Usage

```typescript
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
import {
  BoldExtension,
  ItalicExtension,
  HeadingExtension,
  ParagraphExtension,
} from '@omnitron-dev/aether/components/editor/extensions';

// Simple rich text editor
const MyEditor = defineComponent(() => {
  const content = createSignal('Hello **world**!');

  return {
    tag: AdvancedEditor,
    props: {
      content: content(),
      contentType: 'markdown',
      extensions: [
        new ParagraphExtension(),
        new HeadingExtension(),
        new BoldExtension(),
        new ItalicExtension(),
      ],
      onUpdate: ({ editor }) => {
        content.set(editor.getMarkdown());
      },
    },
  };
});
```

### Example 2: Full-Featured Rich Text Editor

```typescript
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
import {
  // Text formatting
  BoldExtension,
  ItalicExtension,
  UnderlineExtension,
  StrikeExtension,
  CodeExtension,
  LinkExtension,

  // Block formatting
  HeadingExtension,
  ParagraphExtension,
  BlockquoteExtension,
  HorizontalRuleExtension,

  // Lists
  BulletListExtension,
  OrderedListExtension,
  TaskListExtension,
  ListItemExtension,

  // Media
  ImageExtension,

  // Tables
  TableExtension,
  TableRowExtension,
  TableCellExtension,
  TableHeaderExtension,

  // Behavior
  HistoryExtension,
  PlaceholderExtension,
  DropCursorExtension,
  GapCursorExtension,
} from '@omnitron-dev/aether/components/editor/extensions';

const RichTextEditor = defineComponent(() => {
  const handleImageUpload = async (file: File): Promise<string> => {
    // Upload to your server
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const { url } = await response.json();
    return url;
  };

  return {
    tag: AdvancedEditor,
    props: {
      placeholder: 'Start writing...',
      extensions: [
        // Text formatting
        new BoldExtension(),
        new ItalicExtension(),
        new UnderlineExtension(),
        new StrikeExtension(),
        new CodeExtension(),
        new LinkExtension(),

        // Block formatting
        new HeadingExtension({ levels: [1, 2, 3, 4] }),
        new ParagraphExtension(),
        new BlockquoteExtension(),
        new HorizontalRuleExtension(),

        // Lists
        new BulletListExtension(),
        new OrderedListExtension(),
        new TaskListExtension(),
        new ListItemExtension(),

        // Media
        new ImageExtension({
          uploadImage: handleImageUpload,
          maxFileSize: 5 * 1024 * 1024, // 5MB
        }),

        // Tables
        new TableExtension(),
        new TableRowExtension(),
        new TableCellExtension(),
        new TableHeaderExtension(),

        // Behavior
        new HistoryExtension({ depth: 100 }),
        new PlaceholderExtension(),
        new DropCursorExtension(),
        new GapCursorExtension(),
      ],
      toolbar: {
        items: [
          {
            type: 'group',
            items: [
              { type: 'button', icon: 'bold', title: 'Bold', command: 'bold' },
              { type: 'button', icon: 'italic', title: 'Italic', command: 'italic' },
              { type: 'button', icon: 'underline', title: 'Underline', command: 'underline' },
              { type: 'button', icon: 'strike', title: 'Strike', command: 'strike' },
            ],
          },
          { type: 'divider' },
          {
            type: 'dropdown',
            icon: 'heading',
            title: 'Heading',
            items: [
              { type: 'button', icon: 'h1', title: 'Heading 1', command: 'heading', args: [1] },
              { type: 'button', icon: 'h2', title: 'Heading 2', command: 'heading', args: [2] },
              { type: 'button', icon: 'h3', title: 'Heading 3', command: 'heading', args: [3] },
            ],
          },
          { type: 'divider' },
          {
            type: 'group',
            items: [
              { type: 'button', icon: 'list-ul', title: 'Bullet List', command: 'bulletList' },
              { type: 'button', icon: 'list-ol', title: 'Ordered List', command: 'orderedList' },
              { type: 'button', icon: 'list-check', title: 'Task List', command: 'taskList' },
            ],
          },
          { type: 'divider' },
          {
            type: 'group',
            items: [
              { type: 'button', icon: 'link', title: 'Link', command: 'link' },
              { type: 'button', icon: 'image', title: 'Image', command: 'image' },
              { type: 'button', icon: 'table', title: 'Table', command: 'insertTable' },
            ],
          },
        ],
      },
      statusbar: {
        items: [
          {
            type: 'text',
            render: (editor) => {
              const wordCount = editor.signals.wordCount();
              return `${wordCount} words`;
            },
          },
          {
            type: 'text',
            render: (editor) => {
              const charCount = editor.signals.charCount();
              return `${charCount} characters`;
            },
          },
        ],
      },
    },
  };
});
```

### Example 3: Code Editor

```typescript
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
import {
  CodeBlockExtension,
  SyntaxHighlightExtension,
  HistoryExtension,
} from '@omnitron-dev/aether/components/editor/extensions';

const CodeEditor = defineComponent<{ language?: string }>((props) => {
  const code = createSignal('');

  return {
    tag: AdvancedEditor,
    props: {
      content: code(),
      contentType: 'text',
      extensions: [
        new CodeBlockExtension({
          defaultLanguage: props.language || 'typescript',
          languages: ['typescript', 'javascript', 'python', 'rust', 'go'],
          showLineNumbers: true,
          highlightActiveLine: true,
        }),
        new SyntaxHighlightExtension(),
        new HistoryExtension(),
      ],
      editorClass: 'code-editor',
      toolbar: false, // No toolbar for code editor
      statusbar: {
        items: [
          {
            type: 'text',
            render: (editor) => {
              const lines = editor.getText().split('\n').length;
              return `${lines} lines`;
            },
          },
        ],
      },
      onUpdate: ({ editor }) => {
        code.set(editor.getText());
      },
    },
  };
});
```

### Example 4: Markdown Editor with Preview

```typescript
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
import {
  MarkdownExtension,
  BoldExtension,
  ItalicExtension,
  HeadingExtension,
  CodeBlockExtension,
  LinkExtension,
  ImageExtension,
  BulletListExtension,
  OrderedListExtension,
  ListItemExtension,
} from '@omnitron-dev/aether/components/editor/extensions';

const MarkdownEditor = defineComponent(() => {
  const markdown = createSignal('# Hello World\n\nStart writing in **markdown**!');
  const previewMode = createSignal<'edit' | 'preview' | 'split'>('edit');

  const extensions = [
    new MarkdownExtension(),
    new BoldExtension(),
    new ItalicExtension(),
    new HeadingExtension(),
    new CodeBlockExtension(),
    new LinkExtension(),
    new ImageExtension(),
    new BulletListExtension(),
    new OrderedListExtension(),
    new ListItemExtension(),
  ];

  return {
    tag: 'div',
    class: 'markdown-editor',
    children: [
      // Toolbar with mode switcher
      {
        tag: 'div',
        class: 'editor-toolbar',
        children: [
          {
            tag: 'button',
            onClick: () => previewMode.set('edit'),
            class: previewMode() === 'edit' ? 'active' : '',
            children: 'Edit',
          },
          {
            tag: 'button',
            onClick: () => previewMode.set('split'),
            class: previewMode() === 'split' ? 'active' : '',
            children: 'Split',
          },
          {
            tag: 'button',
            onClick: () => previewMode.set('preview'),
            class: previewMode() === 'preview' ? 'active' : '',
            children: 'Preview',
          },
        ],
      },

      // Editor container
      {
        tag: 'div',
        class: `editor-container mode-${previewMode()}`,
        children: [
          // Editor pane
          {
            tag: 'div',
            class: 'editor-pane',
            style: {
              display: previewMode() === 'preview' ? 'none' : 'block',
              width: previewMode() === 'split' ? '50%' : '100%',
            },
            children: {
              tag: AdvancedEditor,
              props: {
                content: markdown(),
                contentType: 'markdown',
                extensions,
                onUpdate: ({ editor }) => {
                  markdown.set(editor.getMarkdown());
                },
              },
            },
          },

          // Preview pane
          previewMode() !== 'edit' && {
            tag: 'div',
            class: 'preview-pane',
            style: {
              width: previewMode() === 'split' ? '50%' : '100%',
            },
            innerHTML: () => renderMarkdown(markdown()),
          },
        ],
      },
    ],
  };
});
```

### Example 5: Custom Extension

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

interface MentionOptions {
  suggestion: {
    items: (query: string) => Promise<MentionItem[]>;
    render: () => SuggestionRenderer;
  };
}

interface MentionItem {
  id: string;
  label: string;
  avatar?: string;
}

class MentionExtension extends Extension<MentionOptions> {
  readonly name = 'mention';
  readonly type = 'node' as const;

  defaultOptions(): MentionOptions {
    return {
      suggestion: {
        items: async () => [],
        render: () => ({
          onStart: () => {},
          onUpdate: () => {},
          onExit: () => {},
        }),
      },
    };
  }

  getSchema() {
    return {
      nodes: {
        mention: {
          attrs: {
            id: {},
            label: {},
          },
          group: 'inline',
          inline: true,
          selectable: false,
          atom: true,
          parseDOM: [
            {
              tag: 'span[data-mention]',
              getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                  id: element.getAttribute('data-mention-id'),
                  label: element.getAttribute('data-mention-label'),
                };
              },
            },
          ],
          toDOM: (node) => [
            'span',
            {
              'data-mention': '',
              'data-mention-id': node.attrs.id,
              'data-mention-label': node.attrs.label,
              class: 'mention',
            },
            `@${node.attrs.label}`,
          ],
        },
      },
    };
  }

  getPlugins() {
    return [
      new Plugin({
        key: new PluginKey('mention'),

        props: {
          handleKeyDown: (view, event) => {
            // Handle @ key to trigger mention suggestions
            if (event.key === '@') {
              this.showSuggestions(view);
              return false;
            }
            return false;
          },
        },
      }),
    ];
  }

  private async showSuggestions(view: EditorView) {
    // Implementation of suggestion UI
    // This would typically open a dropdown with user suggestions
  }
}

// Usage
const editor = new AdvancedEditor({
  extensions: [
    new MentionExtension({
      suggestion: {
        items: async (query) => {
          const response = await fetch(`/api/users/search?q=${query}`);
          return response.json();
        },
        render: () => ({
          onStart: (props) => {
            // Render suggestion dropdown
          },
          onUpdate: (props) => {
            // Update suggestion list
          },
          onExit: () => {
            // Clean up
          },
        }),
      },
    }),
  ],
});
```

---

## Performance & Mobile

### Performance Optimization Strategies

#### 1. Virtual Scrolling for Large Documents

```typescript
interface VirtualScrollExtension extends Extension {
  // Render only visible nodes
  viewportMargin: number; // Lines above/below viewport to render

  // Lazy load content
  loadChunkSize: number; // Number of nodes to load at once

  // Cache rendered nodes
  enableNodeCaching: boolean;
}
```

**Implementation:**
- Use Intersection Observer to detect viewport
- Render only visible + margin nodes
- Placeholder elements for off-screen content
- Progressive loading for initial render

**Target Metrics:**
- Handle documents with 100,000+ nodes
- Maintain 60 FPS scrolling
- Initial render < 100ms

#### 2. Efficient Transaction Processing

```typescript
// Batch multiple changes into single transaction
editor.commands.chain()
  .insertText('Hello ')
  .bold()
  .insertText('World')
  .run(); // Single transaction, one render

// Debounce expensive operations
const debouncedSave = debounce((content) => {
  saveToServer(content);
}, 500);

editor.on('update', ({ editor }) => {
  debouncedSave(editor.getJSON());
});
```

#### 3. Schema Optimization

```typescript
// Minimize node/mark specs
// Use simple parseDOM patterns
// Avoid complex getAttrs functions

const efficientNodeSpec = {
  parseDOM: [
    { tag: 'p' }, // Simple tag match
  ],
  toDOM: () => ['p', 0], // Inline array
};

// vs inefficient

const inefficientNodeSpec = {
  parseDOM: [
    {
      tag: 'p',
      getAttrs: (dom) => {
        // Complex parsing logic
        const element = dom as HTMLElement;
        return {
          // Many attributes
        };
      },
    },
  ],
  toDOM: (node) => {
    // Complex DOM construction
    return createElement('p', {
      // Many attributes
    });
  },
};
```

#### 4. Plugin Optimization

```typescript
// Use plugin state for caching
const myPlugin = new Plugin({
  state: {
    init: () => computeExpensiveValue(),
    apply: (tr, value) => {
      // Only recompute if necessary
      if (tr.docChanged) {
        return computeExpensiveValue();
      }
      return value;
    },
  },
});

// Avoid creating decorations on every transaction
const efficientDecorationPlugin = new Plugin({
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, set) => {
      // Map existing decorations
      set = set.map(tr.mapping, tr.doc);

      // Only add new decorations if needed
      if (needsNewDecorations(tr)) {
        set = set.add(tr.doc, createDecorations(tr.doc));
      }

      return set;
    },
  },
  props: {
    decorations: (state) => myPlugin.getState(state),
  },
});
```

#### 5. Bundle Size Optimization

```typescript
// Tree-shakeable imports
import { BoldExtension } from '@omnitron-dev/aether/components/editor/extensions/bold';

// vs

import { BoldExtension } from '@omnitron-dev/aether/components/editor/extensions'; // Imports all

// Lazy load heavy extensions
const loadTableExtension = async () => {
  const { TableExtension } = await import('./extensions/table');
  return new TableExtension();
};

// Code splitting for language support
const loadLanguageSupport = async (language: string) => {
  const module = await import(`./languages/${language}`);
  return module.default;
};
```

**Target Bundle Sizes:**
- Core editor: ~15KB gzipped
- + Basic formatting: ~20KB
- + Tables: ~25KB
- + Code highlighting: ~35KB
- + Collaboration: ~45KB

### Mobile Support

#### 1. Touch Interaction

```typescript
interface TouchExtension extends Extension {
  // Touch selection
  enableTouchSelection: boolean;

  // Touch gestures
  doubleTapToEdit: boolean;
  longPressForMenu: boolean;

  // Virtual keyboard
  adjustForKeyboard: boolean;
  keyboardMargin: number;
}
```

**Implementation:**
```typescript
const touchPlugin = new Plugin({
  props: {
    handleDOMEvents: {
      touchstart: (view, event) => {
        // Handle touch start
        return false;
      },
      touchmove: (view, event) => {
        // Handle touch selection
        return false;
      },
      touchend: (view, event) => {
        // Handle touch end
        return false;
      },
    },
  },
});
```

#### 2. Mobile Toolbar

```typescript
// Responsive toolbar that adapts to mobile
const MobileToolbar = defineComponent<ToolbarProps>((props) => {
  const isMobile = createSignal(window.innerWidth < 768);

  // Simplified toolbar for mobile
  const mobileItems = [
    { type: 'button', icon: 'bold', command: 'bold' },
    { type: 'button', icon: 'italic', command: 'italic' },
    { type: 'button', icon: 'link', command: 'link' },
    { type: 'dropdown', icon: 'more', items: [...allOtherItems] },
  ];

  return {
    tag: 'div',
    class: 'toolbar',
    children: isMobile() ? mobileItems : props.items,
  };
});
```

#### 3. Performance on Mobile

```typescript
// Reduce decorations on mobile
const shouldUseDecorations = () => {
  return !isMobileDevice() || document.body.clientWidth > 768;
};

// Simplify rendering on mobile
const mobileOptimizations = {
  // Disable animations on mobile
  enableAnimations: !isMobileDevice(),

  // Reduce syntax highlighting complexity
  syntaxHighlightingDepth: isMobileDevice() ? 2 : 5,

  // Disable hover effects on touch devices
  enableHoverEffects: !isTouchDevice(),
};
```

#### 4. Viewport Management

```typescript
// Ensure editor is visible when keyboard appears
const keyboardPlugin = new Plugin({
  view: (editorView) => {
    const handleResize = () => {
      // Scroll to cursor when keyboard appears
      const { selection } = editorView.state;
      const coords = editorView.coordsAtPos(selection.from);

      if (coords.bottom > window.innerHeight) {
        window.scrollTo({
          top: coords.top - 100,
          behavior: 'smooth',
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return {
      destroy: () => {
        window.removeEventListener('resize', handleResize);
      },
    };
  },
});
```

---

## Testing & Documentation

### Testing Strategy

#### 1. Unit Tests

**Coverage:** Extension classes, utilities, commands

```typescript
// Example: BoldExtension test
describe('BoldExtension', () => {
  it('should create bold mark in schema', () => {
    const extension = new BoldExtension();
    const schema = extension.getSchema();

    expect(schema.marks.bold).toBeDefined();
  });

  it('should toggle bold on Mod-b', () => {
    const editor = createTestEditor([new BoldExtension()]);

    editor.commands.setContent('Hello world');
    editor.commands.setSelection(0, 5);
    editor.commands.bold();

    expect(editor.getHTML()).toBe('<p><strong>Hello</strong> world</p>');
  });

  it('should parse bold from markdown', () => {
    const editor = createTestEditor([new BoldExtension()]);

    editor.commands.setContent('**bold text**', 'markdown');

    expect(editor.getHTML()).toBe('<p><strong>bold text</strong></p>');
  });
});
```

#### 2. Integration Tests

**Coverage:** Extension interactions, command chains, state management

```typescript
// Example: List integration test
describe('Lists', () => {
  it('should convert paragraph to bullet list', () => {
    const editor = createTestEditor([
      new ParagraphExtension(),
      new BulletListExtension(),
      new ListItemExtension(),
    ]);

    editor.commands.setContent('<p>Item 1</p>');
    editor.commands.bulletList();

    expect(editor.getHTML()).toBe('<ul><li><p>Item 1</p></li></ul>');
  });

  it('should support nested lists', () => {
    const editor = createTestEditor([...listExtensions]);

    editor.commands.setContent('<ul><li><p>Item 1</p></li></ul>');
    editor.commands.setSelection(7); // After "Item 1"
    editor.commands.enter();
    editor.commands.insertText('Item 2');
    editor.commands.sinkListItem();

    expect(editor.getHTML()).toMatchSnapshot();
  });
});
```

#### 3. E2E Tests

**Coverage:** User workflows, keyboard shortcuts, drag and drop

```typescript
// Example: E2E test with Playwright
test('should create and format document', async ({ page }) => {
  await page.goto('/editor');

  // Type content
  await page.locator('.ProseMirror').type('Hello World');

  // Select text
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');

  // Make bold
  await page.keyboard.press('Meta+b');

  // Verify
  const html = await page.locator('.ProseMirror').innerHTML();
  expect(html).toContain('<strong>World</strong>');
});
```

#### 4. Performance Tests

**Coverage:** Large documents, rapid input, memory leaks

```typescript
// Example: Performance benchmark
describe('Performance', () => {
  it('should handle large documents efficiently', () => {
    const editor = createTestEditor();

    const startTime = performance.now();

    // Insert 10,000 paragraphs
    const content = Array(10000).fill('<p>Test paragraph</p>').join('');
    editor.commands.setContent(content);

    const loadTime = performance.now() - startTime;
    expect(loadTime).toBeLessThan(1000); // Should load in < 1s

    // Test scrolling performance
    const scrollStart = performance.now();
    editor.commands.focus('end');
    const scrollTime = performance.now() - scrollStart;
    expect(scrollTime).toBeLessThan(100);
  });

  it('should not leak memory', () => {
    const editors = [];

    for (let i = 0; i < 100; i++) {
      const editor = createTestEditor();
      editors.push(editor);
    }

    const memBefore = performance.memory.usedJSHeapSize;

    // Destroy all editors
    editors.forEach(e => e.destroy());

    // Force GC (in test environment)
    if (global.gc) global.gc();

    const memAfter = performance.memory.usedJSHeapSize;
    const leaked = memAfter - memBefore;

    expect(leaked).toBeLessThan(1024 * 1024); // < 1MB leaked
  });
});
```

### Documentation Requirements

#### 1. API Reference

**Structure:**
```
docs/editor/api/
├── AdvancedEditor.md         # Main component
├── Extension.md              # Extension base class
├── extensions/
│   ├── BoldExtension.md
│   ├── HeadingExtension.md
│   └── ...
├── CommandManager.md
├── EditorInstance.md
└── Types.md
```

**Format:**
```markdown
# BoldExtension

Make text bold.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| HTMLAttributes | `object` | `{}` | Custom HTML attributes |

## Commands

### bold()

Toggle bold mark on current selection.

**Returns:** `boolean` - Whether command was executed

**Example:**
```typescript
editor.commands.bold();
```

## Keyboard Shortcuts

- `Mod-b` - Toggle bold
- `Mod-Shift-b` - Remove bold

## Input Rules

- `**text**` → Bold text
- `__text__` → Bold text
```

#### 2. Usage Examples

**Structure:**
```
docs/editor/examples/
├── getting-started.md
├── rich-text-editor.md
├── code-editor.md
├── markdown-editor.md
├── collaborative-editor.md
├── custom-extensions.md
└── theming.md
```

#### 3. Migration Guides

**Structure:**
```
docs/editor/migration/
├── from-tiptap.md
├── from-slate.md
├── from-quill.md
└── from-prosemirror.md
```

#### 4. Best Practices

**Topics:**
- Performance optimization
- Accessibility guidelines
- Mobile considerations
- Extension development
- Testing strategies
- Security considerations

---

## Conclusion

This specification provides a comprehensive blueprint for implementing an Advanced Editor component for the Aether framework. The editor balances power and simplicity, leveraging ProseMirror's proven architecture while integrating seamlessly with Aether's signal-based reactivity system.

### Key Takeaways

1. **Extensible by Design:** The extension system allows developers to add functionality without modifying the core.

2. **Performance First:** Virtual scrolling, efficient transaction processing, and optimized bundle sizes ensure smooth performance.

3. **Mobile Ready:** Touch support, responsive UI, and mobile optimizations provide a great experience on all devices.

4. **Accessible:** WCAG 2.1 AA compliance ensures the editor is usable by everyone.

5. **Developer Friendly:** Clean API, comprehensive documentation, and TypeScript support make development enjoyable.

### Next Steps

1. Review and approve this specification
2. Set up project structure
3. Begin Phase 1 implementation
4. Iterate based on feedback
5. Launch beta version
6. Gather user feedback
7. Release v1.0

---

**Document Version:** 1.0.0
**Total Lines:** ~1,600
**Status:** Ready for Review