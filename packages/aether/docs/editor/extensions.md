# Extension Development Guide

Learn how to create custom extensions for the Advanced Editor.

## Table of Contents

- [Introduction](#introduction)
- [Extension Basics](#extension-basics)
- [Extension Types](#extension-types)
- [Creating Your First Extension](#creating-your-first-extension)
- [Schema Definition](#schema-definition)
- [Commands](#commands)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Plugins](#plugins)
- [Input Rules](#input-rules)
- [Paste Rules](#paste-rules)
- [Extension Dependencies](#extension-dependencies)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Best Practices](#best-practices)
- [Example Extensions](#example-extensions)

---

## Introduction

Extensions are the building blocks of the Advanced Editor. They provide:

- **Schema contributions** - Define nodes and marks
- **Commands** - Add editor operations
- **Keyboard shortcuts** - Map keys to commands
- **Plugins** - Add ProseMirror plugins
- **Input rules** - Markdown-style shortcuts
- **Paste rules** - Handle pasted content
- **UI components** - Add toolbar buttons, menus, etc.

The extension system is designed to be:

- **Composable** - Extensions can build on each other
- **Type-safe** - Full TypeScript support
- **Modular** - Each extension is independent
- **Extensible** - Easy to customize and override

---

## Extension Basics

All extensions extend the `Extension` base class:

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';

class MyExtension extends Extension<MyOptions> {
  // Extension name (required, unique)
  readonly name = 'myExtension';

  // Extension type (required)
  readonly type = 'behavior' as const;

  // Default options
  protected defaultOptions(): MyOptions {
    return {
      // Default option values
    };
  }

  // Optional: Schema contribution
  getSchema?(): SchemaContribution {
    return {
      nodes: { /* ... */ },
      marks: { /* ... */ },
    };
  }

  // Optional: Plugin contribution
  getPlugins?(): Plugin[] {
    return [/* ... */];
  }

  // Optional: Input rules
  getInputRules?(): InputRule[] {
    return [/* ... */];
  }

  // Optional: Keyboard shortcuts
  getKeyboardShortcuts?(): Record<string, Command> {
    return {
      'Mod-x': /* command */,
    };
  }

  // Optional: Lifecycle hooks
  onCreate?(editor: EditorInstance): void {
    // Initialize
  }

  onDestroy?(): void {
    // Cleanup
  }
}
```

**Key Points:**

- Extensions are **classes**, not functions
- The `name` property must be **unique**
- The `type` indicates what the extension provides
- Options are **typed** and **configurable**
- All methods except `name` and `type` are **optional**

---

## Extension Types

There are three types of extensions:

### Node Extensions

Add block-level or inline nodes to the schema.

```typescript
class MyNodeExtension extends Extension {
  readonly name = 'myNode';
  readonly type = 'node' as const;

  getSchema() {
    return {
      nodes: {
        myNode: {
          content: 'inline*',
          group: 'block',
          parseDOM: [{ tag: 'div.my-node' }],
          toDOM: () => ['div', { class: 'my-node' }, 0],
        },
      },
    };
  }
}
```

**Examples:** Paragraph, Heading, CodeBlock, Image

### Mark Extensions

Add inline formatting (marks) to the schema.

```typescript
class MyMarkExtension extends Extension {
  readonly name = 'myMark';
  readonly type = 'mark' as const;

  getSchema() {
    return {
      marks: {
        myMark: {
          parseDOM: [{ tag: 'span.my-mark' }],
          toDOM: () => ['span', { class: 'my-mark' }, 0],
        },
      },
    };
  }
}
```

**Examples:** Bold, Italic, Link, Code

### Behavior Extensions

Add functionality without schema changes.

```typescript
class MyBehaviorExtension extends Extension {
  readonly name = 'myBehavior';
  readonly type = 'behavior' as const;

  getPlugins() {
    return [
      new Plugin({
        // Plugin implementation
      }),
    ];
  }
}
```

**Examples:** History, Placeholder, Search, Collaboration

---

## Creating Your First Extension

Let's create a simple extension that highlights selected text in a custom color.

### Step 1: Define Options

```typescript
interface HighlightOptions {
  color: string;
  HTMLAttributes: Record<string, any>;
}
```

### Step 2: Create Extension Class

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { toggleMark } from 'prosemirror-commands';
import { markInputRule } from 'prosemirror-inputrules';

class HighlightExtension extends Extension<HighlightOptions> {
  readonly name = 'highlight';
  readonly type = 'mark' as const;

  protected defaultOptions(): HighlightOptions {
    return {
      color: '#ffff00',
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      marks: {
        highlight: {
          attrs: {
            color: {
              default: this.options.color,
            },
          },
          parseDOM: [
            {
              tag: 'mark',
              getAttrs: (dom: HTMLElement) => ({
                color: dom.style.backgroundColor || this.options.color,
              }),
            },
          ],
          toDOM: (mark) => [
            'mark',
            {
              ...this.options.HTMLAttributes,
              style: `background-color: ${mark.attrs.color}`,
            },
            0,
          ],
        },
      },
    };
  }

  getKeyboardShortcuts() {
    return {
      'Mod-Shift-h': toggleMark(this.editor!.schema.marks.highlight),
    };
  }

  getInputRules() {
    return [
      markInputRule(
        /==([^=]+)==$/,
        this.editor!.schema.marks.highlight,
        { color: this.options.color }
      ),
    ];
  }

  getCommands() {
    return {
      highlight: (color?: string) => (state, dispatch) => {
        const attrs = color ? { color } : { color: this.options.color };
        return toggleMark(this.editor!.schema.marks.highlight, attrs)(state, dispatch);
      },
    };
  }
}
```

### Step 3: Use Your Extension

```typescript
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';

jsx(AdvancedEditor, {
  content: 'Try ==highlighting== this text!',
  contentType: 'markdown',
  extensions: [
    new HighlightExtension({ color: '#ffff00' }),
    // ... other extensions
  ],
});
```

---

## Schema Definition

The schema defines the structure of your document.

### Defining Nodes

Nodes are block or inline elements.

```typescript
getSchema() {
  return {
    nodes: {
      myNode: {
        // Content expression (what can be inside)
        content: 'inline*', // Any inline content
        // content: 'block+', // One or more blocks
        // content: 'text*', // Zero or more text nodes

        // Group (for content expressions)
        group: 'block', // or 'inline'

        // Attributes
        attrs: {
          level: { default: 1 },
          id: { default: null },
        },

        // Parsing from HTML
        parseDOM: [
          {
            tag: 'div.my-node',
            getAttrs: (dom: HTMLElement) => ({
              level: parseInt(dom.getAttribute('data-level') || '1'),
              id: dom.id || null,
            }),
          },
        ],

        // Serializing to HTML
        toDOM: (node) => [
          'div',
          {
            class: 'my-node',
            'data-level': node.attrs.level,
            id: node.attrs.id,
          },
          0, // Content goes here
        ],

        // Optional: Make it draggable
        draggable: false,

        // Optional: Mark as code (disables input rules)
        code: false,

        // Optional: Atom (treated as a unit)
        atom: false,

        // Optional: Selectable
        selectable: true,

        // Optional: Isolating (create a boundary)
        isolating: false,
      },
    },
  };
}
```

### Defining Marks

Marks are inline formatting.

```typescript
getSchema() {
  return {
    marks: {
      myMark: {
        // Attributes
        attrs: {
          color: { default: '#000' },
        },

        // Parsing from HTML
        parseDOM: [
          {
            tag: 'span.my-mark',
            getAttrs: (dom: HTMLElement) => ({
              color: dom.style.color || '#000',
            }),
          },
        ],

        // Serializing to HTML
        toDOM: (mark) => [
          'span',
          {
            class: 'my-mark',
            style: `color: ${mark.attrs.color}`,
          },
          0,
        ],

        // Optional: Exclude other marks
        excludes: '', // Empty = exclude nothing
        // excludes: 'link', // Exclude link mark
        // excludes: '_', // Exclude all other marks

        // Optional: Mark group
        group: 'fontStyle',

        // Optional: Spanning (can cross node boundaries)
        spanning: true,
      },
    },
  };
}
```

### Content Expressions

Content expressions define what can be inside a node:

- `inline*` - Zero or more inline nodes
- `inline+` - One or more inline nodes
- `block*` - Zero or more blocks
- `block+` - One or more blocks
- `text*` - Zero or more text nodes
- `text` - Exactly one text node
- `paragraph` - Specific node type
- `paragraph+` - One or more paragraphs
- `(paragraph | heading)+` - Paragraphs or headings
- `paragraph heading` - Paragraph followed by heading
- `paragraph{2}` - Exactly 2 paragraphs
- `paragraph{2,5}` - 2 to 5 paragraphs

---

## Commands

Commands are functions that modify the editor state.

### Defining Commands

```typescript
import type { Command } from 'prosemirror-state';

getCommands() {
  return {
    // Simple command
    myCommand: (): Command => (state, dispatch) => {
      if (dispatch) {
        const tr = state.tr;
        // Modify transaction
        dispatch(tr);
      }
      return true; // Command can execute
    },

    // Command with arguments
    myCommandWithArgs: (arg1: string, arg2: number): Command => (state, dispatch) => {
      if (dispatch) {
        // Use arguments
        const tr = state.tr;
        dispatch(tr);
      }
      return true;
    },
  };
}
```

### Common Command Patterns

#### Toggle Mark

```typescript
import { toggleMark } from 'prosemirror-commands';

getCommands() {
  return {
    toggleBold: () => toggleMark(this.editor!.schema.marks.bold),
  };
}
```

#### Set Block Type

```typescript
import { setBlockType } from 'prosemirror-commands';

getCommands() {
  return {
    setParagraph: () => setBlockType(this.editor!.schema.nodes.paragraph),
    setHeading: (level: number) =>
      setBlockType(this.editor!.schema.nodes.heading, { level }),
  };
}
```

#### Insert Node

```typescript
getCommands() {
  return {
    insertHR: (): Command => (state, dispatch) => {
      if (dispatch) {
        const hr = state.schema.nodes.horizontalRule.create();
        const tr = state.tr.replaceSelectionWith(hr);
        dispatch(tr);
      }
      return true;
    },
  };
}
```

#### Wrap in Node

```typescript
import { wrapIn } from 'prosemirror-commands';

getCommands() {
  return {
    wrapInBlockquote: () => wrapIn(this.editor!.schema.nodes.blockquote),
  };
}
```

#### Lift from Wrapping

```typescript
import { lift } from 'prosemirror-commands';

getCommands() {
  return {
    liftBlockquote: (): Command => (state, dispatch) => {
      return lift(state, dispatch);
    },
  };
}
```

---

## Keyboard Shortcuts

Map keyboard shortcuts to commands.

### Basic Shortcuts

```typescript
import { toggleMark } from 'prosemirror-commands';

getKeyboardShortcuts() {
  return {
    'Mod-b': toggleMark(this.editor!.schema.marks.bold),
    'Mod-i': toggleMark(this.editor!.schema.marks.italic),
    'Mod-u': toggleMark(this.editor!.schema.marks.underline),
  };
}
```

### Key Notation

- `Mod` - Cmd on Mac, Ctrl on Windows/Linux
- `Ctrl` - Control key
- `Alt` - Alt/Option key
- `Shift` - Shift key
- `Enter` - Enter key
- `Backspace` - Backspace key
- `Delete` - Delete key
- `Escape` - Escape key
- `Tab` - Tab key

**Combinations:**
- `Mod-b` - Cmd/Ctrl + B
- `Shift-Enter` - Shift + Enter
- `Mod-Shift-x` - Cmd/Ctrl + Shift + X
- `Alt-ArrowUp` - Alt + Up Arrow

### Complex Shortcuts

```typescript
getKeyboardShortcuts() {
  return {
    // Multiple modifiers
    'Mod-Shift-Enter': (state, dispatch) => {
      // Insert hard break
      if (dispatch) {
        dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hardBreak.create()));
      }
      return true;
    },

    // Conditional execution
    'Backspace': (state, dispatch, view) => {
      // Custom backspace behavior
      if (someCondition(state)) {
        return customBackspace(state, dispatch);
      }
      return false; // Let default behavior handle it
    },
  };
}
```

---

## Plugins

Plugins add low-level functionality to ProseMirror.

### Basic Plugin

```typescript
import { Plugin, PluginKey } from 'prosemirror-state';

getPlugins() {
  const pluginKey = new PluginKey('myPlugin');

  return [
    new Plugin({
      key: pluginKey,

      state: {
        init: (config, state) => {
          // Initialize plugin state
          return { /* initial state */ };
        },

        apply: (tr, value, oldState, newState) => {
          // Update plugin state on transaction
          return value;
        },
      },

      props: {
        // Plugin props
      },
    }),
  ];
}
```

### Plugin with Decorations

```typescript
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

getPlugins() {
  return [
    new Plugin({
      state: {
        init: (config, state) => {
          return DecorationSet.empty;
        },

        apply: (tr, set, oldState, newState) => {
          // Update decorations
          const decorations: Decoration[] = [];

          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'myNode') {
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: 'my-decoration',
                })
              );
            }
          });

          return DecorationSet.create(newState.doc, decorations);
        },
      },

      props: {
        decorations: (state) => {
          return this.getState(state);
        },
      },
    }),
  ];
}
```

### Plugin with Event Handlers

```typescript
getPlugins() {
  return [
    new Plugin({
      props: {
        // Handle DOM events
        handleClick: (view, pos, event) => {
          // Return true to prevent default
          return false;
        },

        handleDoubleClick: (view, pos, event) => {
          return false;
        },

        handleKeyDown: (view, event) => {
          return false;
        },

        handlePaste: (view, event, slice) => {
          return false;
        },

        handleDrop: (view, event, slice, moved) => {
          return false;
        },

        // Transform pasted content
        transformPasted: (slice) => {
          return slice;
        },

        // Transform copied content
        transformCopied: (slice) => {
          return slice;
        },
      },
    }),
  ];
}
```

---

## Input Rules

Input rules provide markdown-style shortcuts.

### Mark Input Rules

```typescript
import { markInputRule } from 'prosemirror-inputrules';

getInputRules() {
  return [
    // Bold: **text**
    markInputRule(/\*\*([^*]+)\*\*$/, this.editor!.schema.marks.bold),

    // Italic: *text*
    markInputRule(/\*([^*]+)\*$/, this.editor!.schema.marks.italic),

    // Code: `text`
    markInputRule(/`([^`]+)`$/, this.editor!.schema.marks.code),
  ];
}
```

### Node Input Rules

```typescript
import { wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules';

getInputRules() {
  return [
    // Heading: # text
    textblockTypeInputRule(
      /^(#{1,6})\s$/,
      this.editor!.schema.nodes.heading,
      (match) => ({ level: match[1].length })
    ),

    // Blockquote: > text
    wrappingInputRule(/^\s*>\s$/, this.editor!.schema.nodes.blockquote),

    // Bullet list: - text
    wrappingInputRule(
      /^\s*[-*]\s$/,
      this.editor!.schema.nodes.bulletList,
      undefined,
      (match, node) => node.type === this.editor!.schema.nodes.listItem
    ),

    // Ordered list: 1. text
    wrappingInputRule(
      /^\s*(\d+)\.\s$/,
      this.editor!.schema.nodes.orderedList,
      (match) => ({ order: parseInt(match[1]) }),
      (match, node) => node.type === this.editor!.schema.nodes.listItem
    ),
  ];
}
```

### Custom Input Rules

```typescript
import { InputRule } from 'prosemirror-inputrules';

getInputRules() {
  return [
    // Horizontal rule: ---
    new InputRule(/^---$/, (state, match, start, end) => {
      const tr = state.tr;
      tr.replaceWith(
        start,
        end,
        state.schema.nodes.horizontalRule.create()
      );
      return tr;
    }),

    // Emoji replacement: :smile: → 😊
    new InputRule(/:smile:$/, (state, match, start, end) => {
      const tr = state.tr;
      tr.replaceWith(start, end, state.schema.text('😊'));
      return tr;
    }),
  ];
}
```

---

## Paste Rules

Paste rules transform pasted content.

### Basic Paste Rule

```typescript
import { Plugin } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';

getPlugins() {
  return [
    new Plugin({
      props: {
        transformPasted: (slice: Slice) => {
          // Transform pasted content
          const content = /* ... */;
          return new Slice(content, slice.openStart, slice.openEnd);
        },
      },
    }),
  ];
}
```

### Link Auto-Detection

```typescript
getPlugins() {
  return [
    new Plugin({
      props: {
        transformPasted: (slice) => {
          const linkRegex = /(https?:\/\/[^\s]+)/g;

          const nodes = [];
          slice.content.forEach((node) => {
            if (node.isText) {
              const text = node.text!;
              let lastIndex = 0;
              let match;

              while ((match = linkRegex.exec(text)) !== null) {
                // Text before link
                if (match.index > lastIndex) {
                  nodes.push(
                    this.editor!.schema.text(
                      text.substring(lastIndex, match.index)
                    )
                  );
                }

                // Link
                nodes.push(
                  this.editor!.schema.text(match[0]).mark([
                    this.editor!.schema.marks.link.create({ href: match[0] }),
                  ])
                );

                lastIndex = match.index + match[0].length;
              }

              // Remaining text
              if (lastIndex < text.length) {
                nodes.push(this.editor!.schema.text(text.substring(lastIndex)));
              }
            } else {
              nodes.push(node);
            }
          });

          return new Slice(
            Fragment.fromArray(nodes),
            slice.openStart,
            slice.openEnd
          );
        },
      },
    }),
  ];
}
```

---

## Extension Dependencies

Extensions can depend on other extensions.

### Declaring Dependencies

```typescript
class TaskItemExtension extends Extension {
  readonly name = 'taskItem';
  readonly type = 'node' as const;

  // Require TaskListExtension to be loaded
  get dependencies() {
    return ['taskList'];
  }

  // ...
}
```

### Accessing Dependent Extensions

```typescript
onCreate(editor: EditorInstance) {
  // Access extension manager through editor
  const extensionManager = editor.view.state.plugins.find(
    p => p.spec.key === 'extensionManager'
  );

  // Get dependent extension
  const taskList = extensionManager?.getExtension('taskList');
}
```

### Dependency Order

Extensions are loaded in dependency order:

```typescript
const extensions = [
  new TaskItemExtension(), // Depends on taskList
  new TaskListExtension(), // No dependencies
];

// Extensions are automatically sorted:
// 1. TaskListExtension (no deps)
// 2. TaskItemExtension (depends on taskList)
```

---

## Lifecycle Hooks

Extensions have lifecycle hooks for initialization and cleanup.

### onCreate

Called when the extension is added to the editor.

```typescript
onCreate(editor: EditorInstance) {
  // Store editor reference
  this.editor = editor;

  // Initialize state
  this.state = {
    // ...
  };

  // Add event listeners
  editor.view.dom.addEventListener('click', this.handleClick);

  // Register commands
  editor.commands.register('myCommand', this.myCommand);
}
```

### onDestroy

Called when the extension is removed or editor is destroyed.

```typescript
onDestroy() {
  // Clean up event listeners
  if (this.editor) {
    this.editor.view.dom.removeEventListener('click', this.handleClick);
  }

  // Clean up state
  this.state = null;

  // Clear timers
  if (this.timer) {
    clearTimeout(this.timer);
  }
}
```

---

## Best Practices

### 1. Type Safety

Always provide TypeScript types for options:

```typescript
interface MyExtensionOptions {
  enabled: boolean;
  color: string;
  onUpdate?: (value: string) => void;
}

class MyExtension extends Extension<MyExtensionOptions> {
  protected defaultOptions(): MyExtensionOptions {
    return {
      enabled: true,
      color: '#000',
    };
  }
}
```

### 2. Immutability

Don't modify options directly; use `configure()`:

```typescript
// Wrong
extension.options.color = '#fff';

// Correct
extension.configure({ color: '#fff' });
```

### 3. Error Handling

Handle errors gracefully:

```typescript
onCreate(editor: EditorInstance) {
  try {
    // Initialize
  } catch (error) {
    console.error('Failed to initialize extension:', error);
  }
}
```

### 4. Performance

- Avoid expensive operations in `apply()` callbacks
- Use memoization for derived values
- Debounce frequent updates
- Limit decoration count

```typescript
import { debounce } from '@omnitron-dev/common';

class MyExtension extends Extension {
  private updateDecorations = debounce(() => {
    // Update decorations
  }, 100);

  getPlugins() {
    return [
      new Plugin({
        state: {
          apply: (tr, value) => {
            this.updateDecorations();
            return value;
          },
        },
      }),
    ];
  }
}
```

### 5. Accessibility

- Add ARIA labels to custom nodes
- Ensure keyboard navigation works
- Provide screen reader support

```typescript
getSchema() {
  return {
    nodes: {
      myNode: {
        toDOM: (node) => [
          'div',
          {
            class: 'my-node',
            role: 'article',
            'aria-label': 'Custom content block',
          },
          0,
        ],
      },
    },
  };
}
```

### 6. Documentation

Document your extension:

```typescript
/**
 * MyExtension - Adds custom functionality
 *
 * @example
 * ```typescript
 * new MyExtension({
 *   enabled: true,
 *   color: '#ff0000',
 * });
 * ```
 */
class MyExtension extends Extension<MyExtensionOptions> {
  // ...
}
```

---

## Example Extensions

### 1. Word Count Extension

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { Plugin, PluginKey } from 'prosemirror-state';

interface WordCountOptions {
  onUpdate?: (count: number) => void;
}

class WordCountExtension extends Extension<WordCountOptions> {
  readonly name = 'wordCount';
  readonly type = 'behavior' as const;

  private pluginKey = new PluginKey('wordCount');

  protected defaultOptions(): WordCountOptions {
    return {};
  }

  getPlugins() {
    return [
      new Plugin({
        key: this.pluginKey,
        state: {
          init: (config, state) => {
            return this.countWords(state.doc);
          },
          apply: (tr, value, oldState, newState) => {
            if (!tr.docChanged) return value;

            const count = this.countWords(newState.doc);
            this.options.onUpdate?.(count);
            return count;
          },
        },
      }),
    ];
  }

  private countWords(doc: Node): number {
    const text = doc.textBetween(0, doc.content.size, ' ', ' ');
    const words = text.trim().split(/\s+/);
    return words.filter((w) => w.length > 0).length;
  }

  getWordCount(): number {
    if (!this.editor) return 0;
    const state = this.pluginKey.getState(this.editor.state);
    return state || 0;
  }
}
```

### 2. Auto-Save Extension

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { Plugin } from 'prosemirror-state';

interface AutoSaveOptions {
  delay: number; // ms
  onSave: (content: string) => Promise<void>;
}

class AutoSaveExtension extends Extension<AutoSaveOptions> {
  readonly name = 'autoSave';
  readonly type = 'behavior' as const;

  private saveTimer: number | null = null;

  protected defaultOptions(): AutoSaveOptions {
    return {
      delay: 2000,
      onSave: async () => {},
    };
  }

  getPlugins() {
    return [
      new Plugin({
        view: () => ({
          update: (view) => {
            this.scheduleSave(view.state.doc.textContent);
          },
        }),
      }),
    ];
  }

  private scheduleSave(content: string) {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.options.onSave(content).catch((error) => {
        console.error('Auto-save failed:', error);
      });
    }, this.options.delay);
  }

  onDestroy() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
  }
}
```

### 3. Character Limit Extension

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { Plugin } from 'prosemirror-state';

interface CharacterLimitOptions {
  limit: number;
  onLimitExceeded?: () => void;
}

class CharacterLimitExtension extends Extension<CharacterLimitOptions> {
  readonly name = 'characterLimit';
  readonly type = 'behavior' as const;

  protected defaultOptions(): CharacterLimitOptions {
    return {
      limit: 1000,
    };
  }

  getPlugins() {
    return [
      new Plugin({
        filterTransaction: (tr, state) => {
          if (!tr.docChanged) return true;

          const newLength = tr.doc.textContent.length;

          if (newLength > this.options.limit) {
            this.options.onLimitExceeded?.();
            return false;
          }

          return true;
        },
      }),
    ];
  }
}
```

### 4. Mention Extension

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { InputRule } from 'prosemirror-inputrules';

interface MentionOptions {
  users: Array<{ id: string; name: string }>;
  onMention?: (userId: string) => void;
}

class MentionExtension extends Extension<MentionOptions> {
  readonly name = 'mention';
  readonly type = 'mark' as const;

  protected defaultOptions(): MentionOptions {
    return {
      users: [],
    };
  }

  getSchema() {
    return {
      marks: {
        mention: {
          attrs: {
            id: { default: null },
            label: { default: null },
          },
          parseDOM: [
            {
              tag: 'span.mention',
              getAttrs: (dom: HTMLElement) => ({
                id: dom.getAttribute('data-id'),
                label: dom.textContent,
              }),
            },
          ],
          toDOM: (mark) => [
            'span',
            {
              class: 'mention',
              'data-id': mark.attrs.id,
            },
            mark.attrs.label,
          ],
        },
      },
    };
  }

  getInputRules() {
    return [
      new InputRule(/@(\w+)$/, (state, match, start, end) => {
        const username = match[1];
        const user = this.options.users.find((u) => u.name === username);

        if (!user) return null;

        const tr = state.tr;
        tr.replaceWith(
          start,
          end,
          state.schema.text(`@${user.name}`).mark([
            state.schema.marks.mention.create({
              id: user.id,
              label: user.name,
            }),
          ])
        );

        this.options.onMention?.(user.id);

        return tr;
      }),
    ];
  }
}
```

### 5. Read Time Extension

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { Plugin, PluginKey } from 'prosemirror-state';

interface ReadTimeOptions {
  wordsPerMinute: number;
  onUpdate?: (minutes: number) => void;
}

class ReadTimeExtension extends Extension<ReadTimeOptions> {
  readonly name = 'readTime';
  readonly type = 'behavior' as const;

  private pluginKey = new PluginKey('readTime');

  protected defaultOptions(): ReadTimeOptions {
    return {
      wordsPerMinute: 200,
    };
  }

  getPlugins() {
    return [
      new Plugin({
        key: this.pluginKey,
        state: {
          init: (config, state) => {
            return this.calculateReadTime(state.doc);
          },
          apply: (tr, value, oldState, newState) => {
            if (!tr.docChanged) return value;

            const readTime = this.calculateReadTime(newState.doc);
            this.options.onUpdate?.(readTime);
            return readTime;
          },
        },
      }),
    ];
  }

  private calculateReadTime(doc: Node): number {
    const text = doc.textBetween(0, doc.content.size, ' ', ' ');
    const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
    const minutes = Math.ceil(words.length / this.options.wordsPerMinute);
    return minutes;
  }

  getReadTime(): number {
    if (!this.editor) return 0;
    const state = this.pluginKey.getState(this.editor.state);
    return state || 0;
  }
}
```

---

## See Also

- **[Getting Started Guide](./getting-started.md)** - Installation and basic setup
- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Theming Guide](./theming.md)** - Customizing appearance
- **[Migration Guide](./migration.md)** - Migrating from other editors

---

**Last Updated:** 2025-10-16
**Package:** `@omnitron-dev/aether`
**Version:** 1.0.0
