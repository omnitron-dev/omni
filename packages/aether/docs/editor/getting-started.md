# Getting Started with Advanced Editor

The Advanced Editor is a high-performance, extensible rich text and code editing component for the Aether framework. Built on ProseMirror's proven foundation, it provides seamless integration with Aether's signal-based reactivity system.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Basic Setup](#basic-setup)
- [Creating Your First Editor](#creating-your-first-editor)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)
- [Next Steps](#next-steps)

## Installation

The Advanced Editor is part of the `@omnitron-dev/aether` package. Install it along with its peer dependencies:

```bash
# Using pnpm
pnpm add @omnitron-dev/aether

# Using npm
npm install @omnitron-dev/aether

# Using yarn
yarn add @omnitron-dev/aether
```

The editor requires the following peer dependencies (automatically included with Aether):

- `prosemirror-model` - Document model
- `prosemirror-state` - Editor state management
- `prosemirror-view` - DOM rendering
- `prosemirror-transform` - Document transformations
- `prosemirror-history` - Undo/redo functionality
- `prosemirror-inputrules` - Markdown-style shortcuts
- `prosemirror-keymap` - Keyboard shortcuts

## Quick Start

Here's a minimal example to get you started:

```typescript
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
import { BoldExtension, ItalicExtension } from '@omnitron-dev/aether/components/editor';
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';

// Create a simple editor component
const MyEditor = () => {
  return jsx(AdvancedEditor, {
    content: 'Hello, world!',
    contentType: 'text',
    extensions: [
      new BoldExtension(),
      new ItalicExtension(),
    ],
    onUpdate: ({ editor }) => {
      console.log('Content:', editor.getText());
    },
  });
};
```

## Basic Setup

### Import Required Components

```typescript
// Core editor component
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';

// Extensions for text formatting
import {
  BoldExtension,
  ItalicExtension,
  UnderlineExtension,
  StrikeExtension,
  CodeExtension,
} from '@omnitron-dev/aether/components/editor';

// Node extensions
import {
  ParagraphExtension,
  HeadingExtension,
  BlockquoteExtension,
  HorizontalRuleExtension,
} from '@omnitron-dev/aether/components/editor';

// List extensions
import {
  BulletListExtension,
  OrderedListExtension,
  ListItemExtension,
  TaskListExtension,
  TaskItemExtension,
} from '@omnitron-dev/aether/components/editor';

// Behavior extensions
import {
  HistoryExtension,
  PlaceholderExtension,
  DropCursorExtension,
  GapCursorExtension,
} from '@omnitron-dev/aether/components/editor';

// UI components
import {
  Toolbar,
  Statusbar,
  getDefaultToolbarItems,
} from '@omnitron-dev/aether/components/editor';
```

### Initialize Extensions

The editor requires extensions to define its functionality. Here's a recommended starter set:

```typescript
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';

const editorInstance = signal(null);

const defaultExtensions = [
  // Basic formatting marks
  new BoldExtension(),
  new ItalicExtension(),
  new UnderlineExtension(),
  new StrikeExtension(),
  new CodeExtension(),

  // Block nodes
  new ParagraphExtension(),
  new HeadingExtension({ levels: [1, 2, 3, 4, 5, 6] }),
  new BlockquoteExtension(),
  new HorizontalRuleExtension(),

  // Lists
  new BulletListExtension(),
  new OrderedListExtension(),
  new ListItemExtension(),

  // Essential behavior
  new HistoryExtension({ depth: 100 }),
  new PlaceholderExtension({ placeholder: 'Start typing...' }),
  new DropCursorExtension(),
  new GapCursorExtension(),
];
```

## Creating Your First Editor

### Simple Text Editor

```typescript
import { defineComponent } from '@omnitron-dev/aether/core/component/define';
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { AdvancedEditor, Toolbar } from '@omnitron-dev/aether/components/editor';

const SimpleEditor = defineComponent(() => {
  const editorInstance = signal(null);

  return () =>
    jsx('div', {
      class: 'editor-container',
      children: [
        jsx(Toolbar, {
          editor: editorInstance,
        }),
        jsx(AdvancedEditor, {
          content: '',
          contentType: 'text',
          extensions: defaultExtensions,
          editable: true,
          autofocus: 'start',
          class: 'editor-wrapper',
          editorClass: 'prosemirror-editor',
          onCreate: (editor) => {
            editorInstance.set(editor);
            console.log('Editor created:', editor);
          },
          onUpdate: ({ editor }) => {
            console.log('Content updated:', editor.getText());
          },
        }),
      ],
    });
}, 'SimpleEditor');
```

### Editor with Toolbar and Status Bar

```typescript
import { Statusbar, getDefaultStatusbarItems } from '@omnitron-dev/aether/components/editor';

const FullEditor = defineComponent(() => {
  const editorInstance = signal(null);

  return () =>
    jsx('div', {
      class: 'editor-container',
      children: [
        // Toolbar at the top
        jsx(Toolbar, {
          editor: editorInstance,
          sticky: true,
        }),

        // Editor content area
        jsx(AdvancedEditor, {
          content: '',
          contentType: 'text',
          extensions: defaultExtensions,
          editable: true,
          autofocus: true,
          onCreate: (editor) => {
            editorInstance.set(editor);
          },
        }),

        // Status bar at the bottom
        jsx(Statusbar, {
          editor: editorInstance,
          items: getDefaultStatusbarItems(),
        }),
      ],
    });
}, 'FullEditor');
```

### Markdown Editor

```typescript
import { MarkdownExtension } from '@omnitron-dev/aether/components/editor';
import { MarkdownPreview } from '@omnitron-dev/aether/components/editor';

const MarkdownEditor = defineComponent(() => {
  const editorInstance = signal(null);
  const showPreview = signal(false);

  const markdownExtensions = [
    ...defaultExtensions,
    new MarkdownExtension(),
  ];

  return () =>
    jsx('div', {
      class: 'markdown-editor-container',
      children: [
        jsx(Toolbar, {
          editor: editorInstance,
        }),

        jsx('div', {
          class: 'editor-layout',
          children: [
            // Editor pane
            jsx('div', {
              class: 'editor-pane',
              children: jsx(AdvancedEditor, {
                content: '# Hello Markdown\n\nStart writing...',
                contentType: 'markdown',
                extensions: markdownExtensions,
                onCreate: (editor) => {
                  editorInstance.set(editor);
                },
              }),
            }),

            // Preview pane (conditional)
            showPreview()
              ? jsx('div', {
                  class: 'preview-pane',
                  children: jsx(MarkdownPreview, {
                    editor: editorInstance,
                  }),
                })
              : null,
          ],
        }),
      ],
    });
}, 'MarkdownEditor');
```

### Code Editor with Syntax Highlighting

```typescript
import {
  CodeBlockExtension,
  SyntaxHighlightExtension,
} from '@omnitron-dev/aether/components/editor';

const CodeEditor = defineComponent(() => {
  const editorInstance = signal(null);

  const codeExtensions = [
    // Basic formatting
    new BoldExtension(),
    new ItalicExtension(),
    new CodeExtension(),

    // Nodes
    new ParagraphExtension(),
    new HeadingExtension(),

    // Code blocks with syntax highlighting
    new CodeBlockExtension({
      defaultLanguage: 'typescript',
      languageSelector: true,
    }),
    new SyntaxHighlightExtension({
      languages: ['typescript', 'javascript', 'python', 'rust', 'go'],
    }),

    // Behavior
    new HistoryExtension(),
  ];

  return () =>
    jsx('div', {
      class: 'code-editor-container',
      children: jsx(AdvancedEditor, {
        content: '```typescript\nconst hello = "world";\n```',
        contentType: 'markdown',
        extensions: codeExtensions,
        onCreate: (editor) => {
          editorInstance.set(editor);
        },
      }),
    });
}, 'CodeEditor');
```

## Common Patterns

### Accessing Editor State

The editor instance provides reactive signals for all state:

```typescript
const editorInstance = signal(null);

// Access state through signals
const isEmpty = computed(() => {
  const editor = editorInstance();
  return editor ? editor.signals.isEmpty() : true;
});

const wordCount = computed(() => {
  const editor = editorInstance();
  return editor ? editor.signals.wordCount() : 0;
});

const canUndo = computed(() => {
  const editor = editorInstance();
  return editor ? editor.signals.canUndo() : false;
});

// Use in your component
return () =>
  jsx('div', {
    children: [
      jsx('div', {
        children: `Words: ${wordCount()}`,
      }),
      jsx('button', {
        disabled: computed(() => !canUndo()),
        onClick: () => {
          const editor = editorInstance();
          if (editor?.commands) {
            editor.commands.execute('undo');
          }
        },
        children: 'Undo',
      }),
    ],
  });
```

### Programmatic Content Updates

```typescript
const editorInstance = signal(null);

// Set content
const setContent = (content: string, type: 'html' | 'markdown' | 'text' = 'text') => {
  const editor = editorInstance();
  if (editor) {
    editor.setContent(content, type);
  }
};

// Get content
const getContent = () => {
  const editor = editorInstance();
  if (!editor) return '';

  // Get as different formats
  const text = editor.getText();
  const html = editor.getHTML();
  const json = editor.getJSON();

  return html; // or text, or json
};

// Clear content
const clearContent = () => {
  const editor = editorInstance();
  if (editor) {
    editor.clearContent();
  }
};
```

### Custom Commands

```typescript
// Execute built-in commands
const toggleBold = () => {
  const editor = editorInstance();
  if (editor?.commands) {
    editor.commands.execute('bold');
  }
};

// Chain multiple commands
const formatHeading = (level: number) => {
  const editor = editorInstance();
  if (editor?.commands) {
    editor.commands
      .chain()
      .focus()
      .execute('heading', level)
      .run();
  }
};

// Check if a command can execute
const canToggleBold = () => {
  const editor = editorInstance();
  return editor?.commands ? editor.commands.can('bold') : false;
};
```

### Handling Events

```typescript
jsx(AdvancedEditor, {
  content: '',
  extensions: defaultExtensions,

  // Called when editor is created
  onCreate: (editor) => {
    console.log('Editor created');
    editorInstance.set(editor);
  },

  // Called on every content change
  onUpdate: ({ editor }) => {
    console.log('Content updated:', editor.getText());
    // Save to backend, update local state, etc.
  },

  // Called when selection changes
  onSelectionUpdate: ({ editor }) => {
    console.log('Selection changed:', editor.signals.selectedText());
  },

  // Called on every transaction (low-level)
  onTransaction: ({ editor, transaction }) => {
    console.log('Transaction applied:', transaction);
  },

  // Focus events
  onFocus: ({ editor, event }) => {
    console.log('Editor focused');
  },

  onBlur: ({ editor, event }) => {
    console.log('Editor blurred');
  },

  // Called when editor is destroyed
  onDestroy: () => {
    console.log('Editor destroyed');
  },
});
```

### Editable/Read-only Mode

```typescript
const editable = signal(true);

jsx(AdvancedEditor, {
  content: 'This content can be toggled between editable and read-only',
  extensions: defaultExtensions,
  editable: editable(),

  onCreate: (editor) => {
    // Toggle editability programmatically
    editor.signals.isEditable.set(false); // Make read-only
    editor.signals.isEditable.set(true); // Make editable
  },
});
```

### Focus Management

```typescript
// Autofocus on mount
jsx(AdvancedEditor, {
  content: '',
  extensions: defaultExtensions,
  autofocus: true, // Focus at current position
  // autofocus: 'start', // Focus at start
  // autofocus: 'end', // Focus at end
  // autofocus: 100, // Focus at position 100
});

// Programmatic focus
const focusEditor = () => {
  const editor = editorInstance();
  if (editor) {
    editor.focus(); // Focus at current position
    // editor.focus('start'); // Focus at start
    // editor.focus('end'); // Focus at end
    // editor.focus(50); // Focus at position 50
  }
};

// Blur editor
const blurEditor = () => {
  const editor = editorInstance();
  if (editor) {
    editor.blur();
  }
};
```

## Troubleshooting

### Editor Not Rendering

**Problem:** The editor container is empty or not showing.

**Solutions:**

1. Ensure you're importing from the correct path:
   ```typescript
   import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
   ```

2. Check that extensions are properly instantiated:
   ```typescript
   // Wrong: passing extension class
   extensions: [BoldExtension]

   // Correct: passing extension instance
   extensions: [new BoldExtension()]
   ```

3. Verify the editor container has a parent element:
   ```typescript
   jsx('div', {
     class: 'editor-container', // Must exist in DOM
     children: jsx(AdvancedEditor, { /* ... */ }),
   });
   ```

### Content Not Updating

**Problem:** Changes to the `content` prop don't update the editor.

**Solution:** The editor is controlled through its instance, not props after initialization. Use the editor API:

```typescript
// Don't do this:
const content = signal('initial');
jsx(AdvancedEditor, { content: content() }); // Won't update

// Do this instead:
const editor = signal(null);
jsx(AdvancedEditor, {
  content: 'initial',
  onCreate: (ed) => editor.set(ed),
});

// Update content programmatically
editor()?.setContent('new content');
```

### Extensions Not Working

**Problem:** Extension features (e.g., bold, italic) aren't working.

**Solutions:**

1. Ensure all required extensions are loaded:
   ```typescript
   // ParagraphExtension is required for block content
   extensions: [
     new ParagraphExtension(), // Required!
     new BoldExtension(),
     new ItalicExtension(),
   ];
   ```

2. Check extension dependencies:
   ```typescript
   // ListItemExtension requires BulletListExtension or OrderedListExtension
   extensions: [
     new BulletListExtension(),
     new ListItemExtension(),
   ];
   ```

3. Verify keyboard shortcuts aren't conflicting with browser shortcuts.

### Performance Issues

**Problem:** Editor is slow with large documents.

**Solutions:**

1. Limit history depth:
   ```typescript
   new HistoryExtension({ depth: 50 }); // Default is 100
   ```

2. Disable expensive features for large documents:
   ```typescript
   new PlaceholderExtension({ placeholder: '' }); // Disable placeholder
   ```

3. Use virtualization for very large documents (>10,000 nodes).

### TypeScript Errors

**Problem:** TypeScript complains about types.

**Solutions:**

1. Ensure you're importing types correctly:
   ```typescript
   import type { EditorInstance, EditorProps } from '@omnitron-dev/aether/components/editor';
   ```

2. Check that peer dependencies are properly installed:
   ```bash
   pnpm install prosemirror-model prosemirror-state prosemirror-view
   ```

### Styling Issues

**Problem:** Editor doesn't look right or has no styles.

**Solutions:**

1. Import base styles (if provided):
   ```typescript
   import '@omnitron-dev/aether/components/editor/styles.css';
   ```

2. Add custom CSS classes:
   ```typescript
   jsx(AdvancedEditor, {
     class: 'my-editor-wrapper',
     editorClass: 'my-prosemirror',
   });
   ```

3. Check that ProseMirror base styles are loaded.

## Next Steps

Now that you have a basic editor running, explore these topics:

- **[API Reference](./api-reference.md)** - Complete API documentation for all classes and methods
- **[Extensions Guide](./extensions.md)** - Learn how to create custom extensions
- **[Theming Guide](./theming.md)** - Customize the editor's appearance
- **[Migration Guide](./migration.md)** - Migrate from other editors

### Recommended Learning Path

1. **Basics** (you are here)
   - Installation and setup
   - Creating a simple editor
   - Using built-in extensions

2. **Intermediate**
   - Custom toolbar configurations
   - Event handling and state management
   - Content serialization (HTML, Markdown, JSON)
   - Search and replace functionality

3. **Advanced**
   - Creating custom extensions
   - Custom node and mark schemas
   - Plugin development
   - Collaborative editing
   - Performance optimization

### Example Projects

Check out these example implementations in `packages/aether/examples/editor/`:

- `basic-editor.ts` - Minimal setup
- `rich-text-editor.ts` - Full-featured rich text editor
- `markdown-editor.ts` - Markdown editor with live preview
- `code-editor.ts` - Code editor with syntax highlighting
- `collaborative-editor.ts` - Real-time collaborative editing

### Community Resources

- **Documentation:** `packages/aether/docs/editor/`
- **Specifications:** `packages/aether/specs/advanced-editor.md`
- **Source Code:** `packages/aether/src/components/editor/`

### Getting Help

If you encounter issues:

1. Check the [API Reference](./api-reference.md) for detailed documentation
2. Review [common troubleshooting steps](#troubleshooting) above
3. Examine the source code in `packages/aether/src/components/editor/`
4. Check ProseMirror documentation for low-level details

Happy editing!
