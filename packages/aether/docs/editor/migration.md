# Migration Guide

Guide for migrating to the Advanced Editor from other popular editors.

## Table of Contents

- [Introduction](#introduction)
- [Migrating from ProseMirror](#migrating-from-prosemirror)
- [Migrating from Tiptap](#migrating-from-tiptap)
- [Migrating from Slate](#migrating-from-slate)
- [Migrating from Draft.js](#migrating-from-draftjs)
- [Migrating from Quill](#migrating-from-quill)
- [Feature Comparison](#feature-comparison)
- [Common Patterns](#common-patterns)

---

## Introduction

The Advanced Editor is built on ProseMirror and shares many concepts with other popular editors. This guide helps you migrate from your current editor by mapping familiar patterns to Advanced Editor equivalents.

**Migration Strategy:**

1. **Understand the differences** - Learn how concepts map between editors
2. **Start simple** - Begin with basic functionality
3. **Migrate incrementally** - Move features one at a time
4. **Test thoroughly** - Verify behavior matches expectations
5. **Optimize** - Leverage Advanced Editor's features

---

## Migrating from ProseMirror

If you're using ProseMirror directly, the Advanced Editor provides a higher-level API while maintaining full ProseMirror compatibility.

### Key Differences

| Aspect | ProseMirror | Advanced Editor |
|--------|-------------|-----------------|
| Framework | Framework-agnostic | Aether-integrated |
| State Management | Manual | Reactive signals |
| Extension System | Plugins | Extension classes |
| Schema Definition | Manual | Extension-based |
| Commands | Functions | Command manager |

### Basic Setup

**Before (ProseMirror):**

```javascript
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema, DOMParser } from 'prosemirror-model';
import { schema } from 'prosemirror-schema-basic';
import { exampleSetup } from 'prosemirror-example-setup';

const view = new EditorView(document.querySelector('#editor'), {
  state: EditorState.create({
    doc: DOMParser.fromSchema(schema).parse(document.querySelector('#content')),
    plugins: exampleSetup({ schema }),
  }),
});
```

**After (Advanced Editor):**

```typescript
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
import {
  ParagraphExtension,
  BoldExtension,
  ItalicExtension,
  HistoryExtension,
} from '@omnitron-dev/aether/components/editor';

jsx(AdvancedEditor, {
  content: '<p>Hello world</p>',
  contentType: 'html',
  extensions: [
    new ParagraphExtension(),
    new BoldExtension(),
    new ItalicExtension(),
    new HistoryExtension(),
  ],
});
```

### Schema Definition

**Before (ProseMirror):**

```javascript
const mySchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM() {
        return ['p', 0];
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: 'strong' }],
      toDOM() {
        return ['strong', 0];
      },
    },
  },
});
```

**After (Advanced Editor):**

```typescript
class ParagraphExtension extends Extension {
  readonly name = 'paragraph';
  readonly type = 'node' as const;

  getSchema() {
    return {
      nodes: {
        paragraph: {
          content: 'inline*',
          group: 'block',
          parseDOM: [{ tag: 'p' }],
          toDOM: () => ['p', 0],
        },
      },
    };
  }
}

class StrongExtension extends Extension {
  readonly name = 'strong';
  readonly type = 'mark' as const;

  getSchema() {
    return {
      marks: {
        strong: {
          parseDOM: [{ tag: 'strong' }],
          toDOM: () => ['strong', 0],
        },
      },
    };
  }
}
```

### Plugins

**Before (ProseMirror):**

```javascript
import { Plugin } from 'prosemirror-state';

const myPlugin = new Plugin({
  state: {
    init: () => ({ count: 0 }),
    apply: (tr, value) => {
      return { count: value.count + 1 };
    },
  },
});

const state = EditorState.create({
  schema,
  plugins: [myPlugin],
});
```

**After (Advanced Editor):**

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { Plugin } from 'prosemirror-state';

class CounterExtension extends Extension {
  readonly name = 'counter';
  readonly type = 'behavior' as const;

  getPlugins() {
    return [
      new Plugin({
        state: {
          init: () => ({ count: 0 }),
          apply: (tr, value) => {
            return { count: value.count + 1 };
          },
        },
      }),
    ];
  }
}
```

### State Updates

**Before (ProseMirror):**

```javascript
const tr = view.state.tr;
tr.insertText('Hello');
view.dispatch(tr);
```

**After (Advanced Editor):**

```typescript
const editor = editorSignal();
editor?.commands.execute('insertText', 'Hello');
```

### Accessing ProseMirror

You can still access ProseMirror internals:

```typescript
const editor = editorSignal();

// Access state
const state = editor.state;

// Access view
const view = editor.view;

// Access schema
const schema = editor.schema;

// Dispatch transactions
const tr = state.tr;
tr.insertText('Hello');
view.dispatch(tr);
```

---

## Migrating from Tiptap

Tiptap and Advanced Editor share similar extension-based architectures. The main difference is framework integration (Vue/React vs. Aether).

### Key Differences

| Aspect | Tiptap | Advanced Editor |
|--------|--------|-----------------|
| Framework | Vue/React | Aether |
| Reactivity | Vue/React state | Aether signals |
| Extension API | Similar | Similar |
| Bundle Size | ~25KB | ~15KB |

### Basic Setup

**Before (Tiptap):**

```javascript
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

function MyEditor() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>Hello World!</p>',
  });

  return <EditorContent editor={editor} />;
}
```

**After (Advanced Editor):**

```typescript
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';
import {
  ParagraphExtension,
  BoldExtension,
  ItalicExtension,
  // ... other extensions
} from '@omnitron-dev/aether/components/editor';

const MyEditor = defineComponent(() => {
  const editorInstance = signal(null);

  return () =>
    jsx(AdvancedEditor, {
      content: '<p>Hello World!</p>',
      contentType: 'html',
      extensions: [
        new ParagraphExtension(),
        new BoldExtension(),
        new ItalicExtension(),
        // ... other extensions
      ],
      onCreate: (editor) => editorInstance.set(editor),
    });
}, 'MyEditor');
```

### Extension Creation

**Before (Tiptap):**

```javascript
import { Mark } from '@tiptap/core';

const Highlight = Mark.create({
  name: 'highlight',

  addOptions() {
    return {
      color: '#ffff00',
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', HTMLAttributes, 0];
  },

  addCommands() {
    return {
      setHighlight:
        () =>
        ({ commands }) => {
          return commands.setMark('highlight');
        },
      unsetHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark('highlight');
        },
    };
  },
});
```

**After (Advanced Editor):**

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import { toggleMark } from 'prosemirror-commands';

interface HighlightOptions {
  color: string;
}

class HighlightExtension extends Extension<HighlightOptions> {
  readonly name = 'highlight';
  readonly type = 'mark' as const;

  protected defaultOptions(): HighlightOptions {
    return {
      color: '#ffff00',
    };
  }

  getSchema() {
    return {
      marks: {
        highlight: {
          parseDOM: [{ tag: 'mark' }],
          toDOM: () => ['mark', 0],
        },
      },
    };
  }

  getCommands() {
    return {
      highlight: () => toggleMark(this.editor!.schema.marks.highlight),
    };
  }
}
```

### Commands

**Before (Tiptap):**

```javascript
editor.chain().focus().toggleBold().run();
```

**After (Advanced Editor):**

```typescript
editor.commands.chain().focus().execute('bold').run();
```

### Content Management

**Before (Tiptap):**

```javascript
// Get content
const html = editor.getHTML();
const json = editor.getJSON();

// Set content
editor.commands.setContent('<p>New content</p>');
```

**After (Advanced Editor):**

```typescript
// Get content
const html = editor.getHTML();
const json = editor.getJSON();

// Set content
editor.setContent('<p>New content</p>', 'html');
```

---

## Migrating from Slate

Slate uses a different architecture (React + Hooks), but concepts map well to Advanced Editor.

### Key Differences

| Aspect | Slate | Advanced Editor |
|--------|-------|-----------------|
| Framework | React | Aether |
| Data Model | JSON tree | ProseMirror document |
| Transforms | Imperative | Transaction-based |
| Schema | Flexible | Structured |
| Plugins | Functions | Classes |

### Basic Setup

**Before (Slate):**

```javascript
import { createEditor } from 'slate';
import { Slate, Editable, withReact } from 'slate-react';

function MyEditor() {
  const [editor] = useState(() => withReact(createEditor()));
  const [value, setValue] = useState([
    {
      type: 'paragraph',
      children: [{ text: 'Hello World!' }],
    },
  ]);

  return (
    <Slate editor={editor} value={value} onChange={setValue}>
      <Editable />
    </Slate>
  );
}
```

**After (Advanced Editor):**

```typescript
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';

const MyEditor = defineComponent(() => {
  const editorInstance = signal(null);

  return () =>
    jsx(AdvancedEditor, {
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello World!' }],
          },
        ],
      },
      contentType: 'json',
      extensions: [
        /* ... */
      ],
      onCreate: (editor) => editorInstance.set(editor),
      onUpdate: ({ editor }) => {
        console.log('Content:', editor.getJSON());
      },
    });
}, 'MyEditor');
```

### Rendering Elements

**Before (Slate):**

```javascript
const renderElement = (props) => {
  switch (props.element.type) {
    case 'heading':
      return <h1 {...props.attributes}>{props.children}</h1>;
    case 'paragraph':
      return <p {...props.attributes}>{props.children}</p>;
    default:
      return <div {...props.attributes}>{props.children}</div>;
  }
};
```

**After (Advanced Editor):**

```typescript
class HeadingExtension extends Extension {
  readonly name = 'heading';
  readonly type = 'node' as const;

  getSchema() {
    return {
      nodes: {
        heading: {
          content: 'inline*',
          group: 'block',
          attrs: { level: { default: 1 } },
          parseDOM: [{ tag: 'h1', attrs: { level: 1 } }],
          toDOM: (node) => [`h${node.attrs.level}`, 0],
        },
      },
    };
  }
}
```

### Transforms

**Before (Slate):**

```javascript
import { Transforms } from 'slate';

// Insert text
Transforms.insertText(editor, 'Hello');

// Insert node
Transforms.insertNodes(editor, {
  type: 'paragraph',
  children: [{ text: 'New paragraph' }],
});

// Set node properties
Transforms.setNodes(editor, { type: 'heading' });
```

**After (Advanced Editor):**

```typescript
// Insert text
editor.commands.execute('insertText', 'Hello');

// Insert node
const node = editor.schema.nodes.paragraph.create(null, [
  editor.schema.text('New paragraph'),
]);
editor.view.dispatch(editor.state.tr.replaceSelectionWith(node));

// Set block type
editor.commands.execute('heading', 1);
```

### Custom Elements

**Before (Slate):**

```javascript
const CustomElement = ({ attributes, children, element }) => {
  return (
    <div {...attributes} data-custom="true">
      {children}
    </div>
  );
};
```

**After (Advanced Editor):**

```typescript
class CustomExtension extends Extension {
  readonly name = 'custom';
  readonly type = 'node' as const;

  getSchema() {
    return {
      nodes: {
        custom: {
          content: 'inline*',
          group: 'block',
          parseDOM: [{ tag: 'div[data-custom]' }],
          toDOM: () => ['div', { 'data-custom': 'true' }, 0],
        },
      },
    };
  }
}
```

---

## Migrating from Draft.js

Draft.js is a React-based editor from Facebook. Advanced Editor provides similar functionality with better performance.

### Key Differences

| Aspect | Draft.js | Advanced Editor |
|--------|----------|-----------------|
| Framework | React | Aether |
| Data Model | ContentState | ProseMirror document |
| Entity System | Built-in | Extension-based |
| Decorators | Component-based | Plugin-based |
| Performance | Good | Excellent |

### Basic Setup

**Before (Draft.js):**

```javascript
import { Editor, EditorState } from 'draft-js';

class MyEditor extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      editorState: EditorState.createEmpty(),
    };
  }

  onChange = (editorState) => {
    this.setState({ editorState });
  };

  render() {
    return <Editor editorState={this.state.editorState} onChange={this.onChange} />;
  }
}
```

**After (Advanced Editor):**

```typescript
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';

const MyEditor = defineComponent(() => {
  const editorInstance = signal(null);

  return () =>
    jsx(AdvancedEditor, {
      content: '',
      contentType: 'text',
      extensions: [
        /* ... */
      ],
      onCreate: (editor) => editorInstance.set(editor),
      onUpdate: ({ editor }) => {
        console.log('Content:', editor.getText());
      },
    });
}, 'MyEditor');
```

### Inline Styles

**Before (Draft.js):**

```javascript
import { RichUtils } from 'draft-js';

const handleBold = () => {
  onChange(RichUtils.toggleInlineStyle(editorState, 'BOLD'));
};
```

**After (Advanced Editor):**

```typescript
const handleBold = () => {
  const editor = editorInstance();
  if (editor) {
    editor.commands.execute('bold');
  }
};
```

### Block Types

**Before (Draft.js):**

```javascript
const handleBlockType = (blockType) => {
  onChange(RichUtils.toggleBlockType(editorState, blockType));
};
```

**After (Advanced Editor):**

```typescript
const handleBlockType = (blockType: string) => {
  const editor = editorInstance();
  if (editor) {
    editor.commands.execute(blockType);
  }
};
```

### Entities (Links)

**Before (Draft.js):**

```javascript
import { Entity, Modifier, EditorState } from 'draft-js';

const addLink = (url) => {
  const contentState = editorState.getCurrentContent();
  const contentStateWithEntity = contentState.createEntity('LINK', 'MUTABLE', { url });
  const entityKey = contentStateWithEntity.getLastCreatedEntityKey();
  const newEditorState = EditorState.set(editorState, {
    currentContent: contentStateWithEntity,
  });
  onChange(RichUtils.toggleLink(newEditorState, newEditorState.getSelection(), entityKey));
};
```

**After (Advanced Editor):**

```typescript
const addLink = (url: string) => {
  const editor = editorInstance();
  if (editor) {
    editor.commands.execute('setLink', { href: url });
  }
};
```

### Content Conversion

**Before (Draft.js):**

```javascript
import { convertToRaw, convertFromRaw } from 'draft-js';

// Get content
const raw = convertToRaw(editorState.getCurrentContent());

// Set content
const contentState = convertFromRaw(raw);
const newEditorState = EditorState.createWithContent(contentState);
```

**After (Advanced Editor):**

```typescript
// Get content
const json = editor.getJSON();

// Set content
editor.setContent(json, 'json');
```

---

## Migrating from Quill

Quill is a popular WYSIWYG editor. Advanced Editor provides similar functionality with more extensibility.

### Key Differences

| Aspect | Quill | Advanced Editor |
|--------|-------|-----------------|
| Framework | Standalone | Aether-integrated |
| Delta Format | Custom | ProseMirror |
| Modules | Built-in | Extension-based |
| Toolbar | Configuration | Component-based |
| Themes | CSS-based | CSS Variables |

### Basic Setup

**Before (Quill):**

```javascript
import Quill from 'quill';

const quill = new Quill('#editor', {
  theme: 'snow',
  modules: {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ header: 1 }, { header: 2 }],
      [{ list: 'ordered' }, { list: 'bullet' }],
    ],
  },
});
```

**After (Advanced Editor):**

```typescript
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';
import {
  AdvancedEditor,
  Toolbar,
  BoldExtension,
  ItalicExtension,
  UnderlineExtension,
  HeadingExtension,
  BulletListExtension,
  OrderedListExtension,
} from '@omnitron-dev/aether/components/editor';

const MyEditor = defineComponent(() => {
  const editorInstance = signal(null);

  return () =>
    jsx('div', {
      children: [
        jsx(Toolbar, { editor: editorInstance }),
        jsx(AdvancedEditor, {
          content: '',
          extensions: [
            new BoldExtension(),
            new ItalicExtension(),
            new UnderlineExtension(),
            new HeadingExtension(),
            new BulletListExtension(),
            new OrderedListExtension(),
          ],
          onCreate: (editor) => editorInstance.set(editor),
        }),
      ],
    });
}, 'MyEditor');
```

### Content Management

**Before (Quill):**

```javascript
// Get content
const delta = quill.getContents();
const html = quill.root.innerHTML;

// Set content
quill.setContents(delta);
```

**After (Advanced Editor):**

```typescript
// Get content
const json = editor.getJSON();
const html = editor.getHTML();

// Set content
editor.setContent(json, 'json');
editor.setContent(html, 'html');
```

### Formatting

**Before (Quill):**

```javascript
// Apply formatting
quill.format('bold', true);
quill.format('header', 1);
```

**After (Advanced Editor):**

```typescript
// Apply formatting
editor.commands.execute('bold');
editor.commands.execute('heading', 1);
```

### Custom Formats

**Before (Quill):**

```javascript
const Inline = Quill.import('blots/inline');

class CustomFormat extends Inline {
  static blotName = 'custom';
  static tagName = 'span';
  static className = 'custom-format';
}

Quill.register(CustomFormat);
```

**After (Advanced Editor):**

```typescript
class CustomExtension extends Extension {
  readonly name = 'custom';
  readonly type = 'mark' as const;

  getSchema() {
    return {
      marks: {
        custom: {
          parseDOM: [{ tag: 'span.custom-format' }],
          toDOM: () => ['span', { class: 'custom-format' }, 0],
        },
      },
    };
  }
}
```

---

## Feature Comparison

### Core Features

| Feature | ProseMirror | Tiptap | Slate | Draft.js | Quill | Advanced Editor |
|---------|-------------|--------|-------|----------|-------|-----------------|
| Rich Text | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Markdown | ⚠️ Plugin | ✅ | ⚠️ Custom | ❌ | ⚠️ Module | ✅ |
| Tables | ⚠️ Plugin | ✅ | ⚠️ Custom | ❌ | ⚠️ Module | ✅ |
| Collaboration | ⚠️ Plugin | ✅ | ⚠️ Custom | ❌ | ⚠️ Module | ✅ |
| Code Blocks | ⚠️ Plugin | ✅ | ⚠️ Custom | ✅ | ✅ | ✅ |
| Syntax Highlight | ⚠️ Plugin | ✅ | ⚠️ Custom | ❌ | ⚠️ Module | ✅ |
| TypeScript | ✅ | ✅ | ✅ | ⚠️ Partial | ⚠️ Partial | ✅ |

### Performance

| Metric | ProseMirror | Tiptap | Slate | Draft.js | Quill | Advanced Editor |
|--------|-------------|--------|-------|----------|-------|-----------------|
| Bundle Size | ~35KB | ~25KB | ~45KB | ~70KB | ~40KB | ~15KB (core) |
| Large Docs | ✅ Excellent | ✅ Excellent | ⚠️ Good | ⚠️ Good | ✅ Excellent | ✅ Excellent |
| Mobile | ✅ Good | ✅ Good | ⚠️ Fair | ⚠️ Fair | ✅ Good | ✅ Good |

### Developer Experience

| Aspect | ProseMirror | Tiptap | Slate | Draft.js | Quill | Advanced Editor |
|--------|-------------|--------|-------|----------|-------|-----------------|
| Learning Curve | Steep | Moderate | Moderate | Moderate | Easy | Easy |
| Documentation | Excellent | Excellent | Good | Good | Good | Excellent |
| Examples | Good | Excellent | Good | Fair | Good | Excellent |
| Community | Large | Growing | Large | Large | Large | Growing |

---

## Common Patterns

### Pattern: Auto-save

**Quill:**

```javascript
quill.on('text-change', debounce(() => {
  saveContent(quill.getContents());
}, 1000));
```

**Advanced Editor:**

```typescript
jsx(AdvancedEditor, {
  onUpdate: debounce(({ editor }) => {
    saveContent(editor.getJSON());
  }, 1000),
});
```

### Pattern: Character Count

**Draft.js:**

```javascript
const length = editorState.getCurrentContent().getPlainText().length;
```

**Advanced Editor:**

```typescript
const length = editor.signals.charCount();
```

### Pattern: Read-only Mode

**Slate:**

```javascript
<Editable readOnly={true} />
```

**Advanced Editor:**

```typescript
jsx(AdvancedEditor, {
  editable: false,
});

// Or programmatically
editor.signals.isEditable.set(false);
```

### Pattern: Placeholder

**Quill:**

```javascript
new Quill('#editor', {
  placeholder: 'Start typing...',
});
```

**Advanced Editor:**

```typescript
jsx(AdvancedEditor, {
  extensions: [new PlaceholderExtension({ placeholder: 'Start typing...' })],
});
```

### Pattern: Focus on Mount

**Tiptap:**

```javascript
useEditor({
  autofocus: true,
});
```

**Advanced Editor:**

```typescript
jsx(AdvancedEditor, {
  autofocus: true,
});
```

---

## See Also

- **[Getting Started Guide](./getting-started.md)** - Installation and basic setup
- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Extensions Guide](./extensions.md)** - Creating custom extensions
- **[Theming Guide](./theming.md)** - Customizing appearance

---

**Last Updated:** 2025-10-16
**Package:** `@omnitron-dev/aether`
**Version:** 1.0.0
