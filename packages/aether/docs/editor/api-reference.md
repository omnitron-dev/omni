# API Reference

Complete API documentation for the Advanced Editor component.

## Table of Contents

- [Core API](#core-api)
  - [AdvancedEditor Component](#advancededitor-component)
  - [EditorInstance](#editorinstance)
  - [Extension Base Class](#extension-base-class)
- [Extensions](#extensions)
  - [Mark Extensions](#mark-extensions)
  - [Node Extensions](#node-extensions)
  - [List Extensions](#list-extensions)
  - [Table Extensions](#table-extensions)
  - [Media Extensions](#media-extensions)
  - [Code Extensions](#code-extensions)
  - [Behavior Extensions](#behavior-extensions)
  - [Search Extension](#search-extension)
  - [Markdown Extension](#markdown-extension)
  - [Collaboration Extensions](#collaboration-extensions)
- [UI Components](#ui-components)
  - [Toolbar](#toolbar)
  - [BubbleMenu](#bubblemenu)
  - [Statusbar](#statusbar)
  - [SearchPanel](#searchpanel)
  - [LinkEditor](#linkeditor)
  - [MarkdownPreview](#markdownpreview)
- [Signals](#signals)
  - [Editor Signals](#editor-signals)
  - [Derived Signals](#derived-signals)
- [Utilities](#utilities)
  - [Content Utilities](#content-utilities)
  - [Selection Utilities](#selection-utilities)
  - [Command Utilities](#command-utilities)
- [Commands Reference](#commands-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Types](#types)

---

## Core API

### AdvancedEditor Component

The main editor component that wraps ProseMirror with Aether reactivity.

**Location:** `packages/aether/src/components/editor/AdvancedEditor.ts`

#### Props

```typescript
interface EditorProps {
  // Content
  content?: string | JSONContent;
  contentType?: 'html' | 'json' | 'text' | 'markdown';

  // Configuration
  extensions?: IExtension[];
  editable?: boolean;
  autofocus?: boolean | 'start' | 'end' | number;

  // Styling
  class?: string;
  editorClass?: string;

  // Events
  onCreate?: (instance: EditorInstance) => void;
  onUpdate?: (props: { editor: EditorInstance }) => void;
  onSelectionUpdate?: (props: { editor: EditorInstance }) => void;
  onTransaction?: (props: { editor: EditorInstance; transaction: Transaction }) => void;
  onFocus?: (props: { editor: EditorInstance; event: FocusEvent }) => void;
  onBlur?: (props: { editor: EditorInstance; event: FocusEvent }) => void;
  onDestroy?: () => void;
}
```

##### content

- **Type:** `string | JSONContent`
- **Default:** `undefined`
- **Description:** Initial content for the editor. Can be plain text, HTML, markdown, or JSON.

##### contentType

- **Type:** `'html' | 'json' | 'text' | 'markdown'`
- **Default:** `'text'`
- **Description:** Format of the initial content.

##### extensions

- **Type:** `IExtension[]`
- **Default:** `[]`
- **Description:** Array of extension instances to load. Extensions provide nodes, marks, and functionality.

##### editable

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Whether the editor is editable or read-only.

##### autofocus

- **Type:** `boolean | 'start' | 'end' | number`
- **Default:** `false`
- **Description:** Focus the editor on mount. Can specify position.
  - `true` - Focus at current position
  - `'start'` - Focus at document start
  - `'end'` - Focus at document end
  - `number` - Focus at specific position

##### class

- **Type:** `string`
- **Default:** `undefined`
- **Description:** CSS class for the editor wrapper element.

##### editorClass

- **Type:** `string`
- **Default:** `'prosemirror-editor'`
- **Description:** CSS class for the ProseMirror editor element.

##### onCreate

- **Type:** `(instance: EditorInstance) => void`
- **Description:** Called when the editor is created. Receives the editor instance.

##### onUpdate

- **Type:** `(props: { editor: EditorInstance }) => void`
- **Description:** Called when the editor content changes.

##### onSelectionUpdate

- **Type:** `(props: { editor: EditorInstance }) => void`
- **Description:** Called when the selection changes.

##### onTransaction

- **Type:** `(props: { editor: EditorInstance; transaction: Transaction }) => void`
- **Description:** Called on every transaction (low-level).

##### onFocus

- **Type:** `(props: { editor: EditorInstance; event: FocusEvent }) => void`
- **Description:** Called when the editor gains focus.

##### onBlur

- **Type:** `(props: { editor: EditorInstance; event: FocusEvent }) => void`
- **Description:** Called when the editor loses focus.

##### onDestroy

- **Type:** `() => void`
- **Description:** Called when the editor is destroyed.

#### Usage

```typescript
import { jsx } from '@omnitron-dev/aether/jsxruntime/runtime';
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';

jsx(AdvancedEditor, {
  content: 'Hello, world!',
  contentType: 'text',
  extensions: [/* ... */],
  editable: true,
  autofocus: 'start',
  onCreate: (editor) => {
    console.log('Editor created:', editor);
  },
});
```

---

### EditorInstance

The editor instance provides the API for interacting with the editor programmatically.

**Location:** `packages/aether/src/components/editor/core/types.ts`

#### Properties

##### state

- **Type:** `EditorState` (ProseMirror)
- **Description:** Current ProseMirror editor state (read-only).

##### view

- **Type:** `EditorView` (ProseMirror)
- **Description:** ProseMirror editor view instance (read-only).

##### schema

- **Type:** `Schema` (ProseMirror)
- **Description:** Document schema (read-only).

##### signals

- **Type:** `EditorSignals`
- **Description:** Aether signals for reactive state. See [Editor Signals](#editor-signals).

##### commands

- **Type:** `CommandManager`
- **Description:** Command manager for executing editor commands.

#### Methods

##### getHTML()

Get the editor content as HTML.

```typescript
getHTML(): string
```

**Returns:** HTML string representation of the document.

**Example:**
```typescript
const html = editor.getHTML();
console.log(html); // '<p>Hello, world!</p>'
```

##### getJSON()

Get the editor content as JSON.

```typescript
getJSON(): JSONContent
```

**Returns:** JSON representation of the document.

**Example:**
```typescript
const json = editor.getJSON();
console.log(json);
// {
//   type: 'doc',
//   content: [
//     { type: 'paragraph', content: [{ type: 'text', text: 'Hello, world!' }] }
//   ]
// }
```

##### getText()

Get the editor content as plain text.

```typescript
getText(options?: { blockSeparator?: string; textBetween?: string }): string
```

**Parameters:**
- `blockSeparator` - String to use between blocks (default: `'\n\n'`)
- `textBetween` - String to use for inline content (default: `''`)

**Returns:** Plain text representation of the document.

**Example:**
```typescript
const text = editor.getText();
console.log(text); // 'Hello, world!'
```

##### setContent()

Set the editor content.

```typescript
setContent(content: string | JSONContent, type?: ContentType): void
```

**Parameters:**
- `content` - New content (string or JSON)
- `type` - Content type: `'html'`, `'json'`, `'text'`, or `'markdown'` (default: `'text'`)

**Example:**
```typescript
editor.setContent('# Hello\n\nWorld', 'markdown');
editor.setContent('<p>Hello <strong>world</strong></p>', 'html');
editor.setContent({ type: 'doc', content: [...] }, 'json');
```

##### clearContent()

Clear all content from the editor.

```typescript
clearContent(): void
```

**Example:**
```typescript
editor.clearContent();
```

##### focus()

Focus the editor.

```typescript
focus(position?: 'start' | 'end' | number): void
```

**Parameters:**
- `position` - Where to focus (default: current position)
  - `'start'` - Focus at document start
  - `'end'` - Focus at document end
  - `number` - Focus at specific position

**Example:**
```typescript
editor.focus(); // Focus at current position
editor.focus('start'); // Focus at start
editor.focus('end'); // Focus at end
editor.focus(100); // Focus at position 100
```

##### blur()

Blur the editor (remove focus).

```typescript
blur(): void
```

**Example:**
```typescript
editor.blur();
```

##### isEmpty()

Check if the editor is empty.

```typescript
isEmpty(): boolean
```

**Returns:** `true` if the editor has no content.

**Example:**
```typescript
if (editor.isEmpty()) {
  console.log('Editor is empty');
}
```

##### isFocused()

Check if the editor is focused.

```typescript
isFocused(): boolean
```

**Returns:** `true` if the editor has focus.

**Example:**
```typescript
if (editor.isFocused()) {
  console.log('Editor is focused');
}
```

##### isEditable()

Check if the editor is editable.

```typescript
isEditable(): boolean
```

**Returns:** `true` if the editor is editable.

**Example:**
```typescript
if (editor.isEditable()) {
  console.log('Editor is editable');
}
```

##### destroy()

Destroy the editor and clean up resources.

```typescript
destroy(): void
```

**Example:**
```typescript
editor.destroy();
```

---

### Extension Base Class

Base class for all editor extensions.

**Location:** `packages/aether/src/components/editor/core/Extension.ts`

#### Creating an Extension

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';

class MyExtension extends Extension<MyOptions> {
  readonly name = 'myExtension';
  readonly type = 'behavior' as const;

  protected defaultOptions(): MyOptions {
    return { /* defaults */ };
  }

  // Override methods to add functionality
}
```

#### Properties

##### name

- **Type:** `string`
- **Description:** Unique extension name (required, abstract).

##### type

- **Type:** `'node' | 'mark' | 'behavior'`
- **Description:** Extension type (required, abstract).

##### dependencies

- **Type:** `string[]`
- **Description:** Names of extensions this extension depends on.

#### Methods

##### defaultOptions()

Provide default options for the extension.

```typescript
protected defaultOptions(): Options
```

**Returns:** Default options object.

##### configure()

Update extension options after instantiation.

```typescript
configure(options: Partial<Options>): void
```

**Parameters:**
- `options` - Partial options to merge with current options.

##### getOptions()

Get current extension options.

```typescript
getOptions(): Options
```

**Returns:** Current options object.

##### getSchema()

Contribute nodes or marks to the editor schema.

```typescript
getSchema?(): SchemaContribution
```

**Returns:** Object with `nodes` and/or `marks` properties.

**Example:**
```typescript
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
    marks: {
      myMark: {
        parseDOM: [{ tag: 'span.my-mark' }],
        toDOM: () => ['span', { class: 'my-mark' }, 0],
      },
    },
  };
}
```

##### getPlugins()

Contribute ProseMirror plugins.

```typescript
getPlugins?(): Plugin[]
```

**Returns:** Array of ProseMirror plugins.

**Example:**
```typescript
getPlugins() {
  return [
    new Plugin({
      key: new PluginKey('myPlugin'),
      state: { /* ... */ },
      props: { /* ... */ },
    }),
  ];
}
```

##### getInputRules()

Contribute input rules (markdown-style shortcuts).

```typescript
getInputRules?(): InputRule[]
```

**Returns:** Array of input rules.

**Example:**
```typescript
getInputRules() {
  return [
    markInputRule(/\*\*([^*]+)\*\*$/, this.schema.marks.bold),
  ];
}
```

##### getKeyboardShortcuts()

Contribute keyboard shortcuts.

```typescript
getKeyboardShortcuts?(): Record<string, Command>
```

**Returns:** Object mapping key combinations to commands.

**Example:**
```typescript
getKeyboardShortcuts() {
  return {
    'Mod-b': toggleMark(this.schema.marks.bold),
    'Mod-i': toggleMark(this.schema.marks.italic),
  };
}
```

##### onCreate()

Called when the extension is created.

```typescript
onCreate?(instance: EditorInstance): void
```

**Parameters:**
- `instance` - The editor instance.

##### onDestroy()

Called when the extension is destroyed.

```typescript
onDestroy?(): void
```

---

## Extensions

### Mark Extensions

Mark extensions add inline formatting capabilities.

**Location:** `packages/aether/src/components/editor/extensions/marks/`

#### BoldExtension

Adds bold text formatting.

```typescript
import { BoldExtension } from '@omnitron-dev/aether/components/editor';

new BoldExtension({
  HTMLAttributes: { class: 'bold' }, // Optional custom attributes
});
```

**Keyboard Shortcut:** `Mod-b`
**Markdown:** `**text**` or `__text__`
**HTML Tag:** `<strong>`

#### ItalicExtension

Adds italic text formatting.

```typescript
import { ItalicExtension } from '@omnitron-dev/aether/components/editor';

new ItalicExtension({
  HTMLAttributes: { class: 'italic' }, // Optional custom attributes
});
```

**Keyboard Shortcut:** `Mod-i`
**Markdown:** `*text*` or `_text_`
**HTML Tag:** `<em>`

#### UnderlineExtension

Adds underline text formatting.

```typescript
import { UnderlineExtension } from '@omnitron-dev/aether/components/editor';

new UnderlineExtension({
  HTMLAttributes: { class: 'underline' },
});
```

**Keyboard Shortcut:** `Mod-u`
**HTML Tag:** `<u>`

#### StrikeExtension

Adds strikethrough text formatting.

```typescript
import { StrikeExtension } from '@omnitron-dev/aether/components/editor';

new StrikeExtension({
  HTMLAttributes: { class: 'strike' },
});
```

**Keyboard Shortcut:** `Mod-Shift-x`
**Markdown:** `~~text~~`
**HTML Tag:** `<s>`

#### CodeExtension

Adds inline code formatting.

```typescript
import { CodeExtension } from '@omnitron-dev/aether/components/editor';

new CodeExtension({
  HTMLAttributes: { class: 'code' },
});
```

**Keyboard Shortcut:** `Mod-e`
**Markdown:** `` `text` ``
**HTML Tag:** `<code>`

---

### Node Extensions

Node extensions add block-level elements.

**Location:** `packages/aether/src/components/editor/extensions/nodes/`

#### ParagraphExtension

Adds paragraph nodes (required for most editors).

```typescript
import { ParagraphExtension } from '@omnitron-dev/aether/components/editor';

new ParagraphExtension({
  HTMLAttributes: { class: 'paragraph' },
});
```

**HTML Tag:** `<p>`

#### HeadingExtension

Adds heading nodes.

```typescript
import { HeadingExtension } from '@omnitron-dev/aether/components/editor';

new HeadingExtension({
  levels: [1, 2, 3, 4, 5, 6], // Allowed heading levels
  HTMLAttributes: { class: 'heading' },
});
```

**Options:**
- `levels` - Array of allowed heading levels (default: `[1, 2, 3, 4, 5, 6]`)

**Keyboard Shortcuts:**
- `Mod-Alt-1` through `Mod-Alt-6`

**Markdown:** `# Heading 1`, `## Heading 2`, etc.
**HTML Tags:** `<h1>` through `<h6>`

#### BlockquoteExtension

Adds blockquote nodes.

```typescript
import { BlockquoteExtension } from '@omnitron-dev/aether/components/editor';

new BlockquoteExtension({
  HTMLAttributes: { class: 'blockquote' },
});
```

**Keyboard Shortcut:** `Mod-Shift-b`
**Markdown:** `> quote`
**HTML Tag:** `<blockquote>`

#### HorizontalRuleExtension

Adds horizontal rule nodes.

```typescript
import { HorizontalRuleExtension } from '@omnitron-dev/aether/components/editor';

new HorizontalRuleExtension({
  HTMLAttributes: { class: 'hr' },
});
```

**Keyboard Shortcut:** `Mod-Shift-minus`
**Markdown:** `---` or `***`
**HTML Tag:** `<hr>`

---

### List Extensions

List extensions add list functionality.

**Location:** `packages/aether/src/components/editor/extensions/lists/`

#### BulletListExtension

Adds bullet (unordered) lists.

```typescript
import { BulletListExtension } from '@omnitron-dev/aether/components/editor';

new BulletListExtension({
  HTMLAttributes: { class: 'bullet-list' },
});
```

**Keyboard Shortcut:** `Mod-Shift-8`
**Markdown:** `- item` or `* item`
**HTML Tag:** `<ul>`

#### OrderedListExtension

Adds numbered (ordered) lists.

```typescript
import { OrderedListExtension } from '@omnitron-dev/aether/components/editor';

new OrderedListExtension({
  HTMLAttributes: { class: 'ordered-list' },
});
```

**Keyboard Shortcut:** `Mod-Shift-7`
**Markdown:** `1. item`
**HTML Tag:** `<ol>`

#### ListItemExtension

Adds list item nodes (required for lists).

```typescript
import { ListItemExtension } from '@omnitron-dev/aether/components/editor';

new ListItemExtension({
  HTMLAttributes: { class: 'list-item' },
});
```

**Dependencies:** BulletListExtension or OrderedListExtension
**HTML Tag:** `<li>`

#### TaskListExtension

Adds task lists (checklists).

```typescript
import { TaskListExtension } from '@omnitron-dev/aether/components/editor';

new TaskListExtension({
  HTMLAttributes: { class: 'task-list' },
});
```

**Markdown:** `- [ ] unchecked` or `- [x] checked`
**HTML Tag:** `<ul data-type="taskList">`

#### TaskItemExtension

Adds task list item nodes.

```typescript
import { TaskItemExtension } from '@omnitron-dev/aether/components/editor';

new TaskItemExtension({
  HTMLAttributes: { class: 'task-item' },
});
```

**Dependencies:** TaskListExtension
**HTML Tag:** `<li data-type="taskItem">`

---

### Table Extensions

Table extensions add table functionality.

**Location:** `packages/aether/src/components/editor/extensions/table/`

#### TableExtension

Adds table nodes.

```typescript
import { TableExtension } from '@omnitron-dev/aether/components/editor';

new TableExtension({
  resizable: true, // Allow column resizing
  HTMLAttributes: { class: 'table' },
});
```

**Options:**
- `resizable` - Enable column resizing (default: `true`)

**Commands:**
- `insertTable({ rows, cols })` - Insert a table
- `deleteTable` - Delete the current table
- `addColumnBefore` - Add a column before current
- `addColumnAfter` - Add a column after current
- `deleteColumn` - Delete current column
- `addRowBefore` - Add a row before current
- `addRowAfter` - Add a row after current
- `deleteRow` - Delete current row
- `mergeCells` - Merge selected cells
- `splitCell` - Split current cell

#### TableRowExtension

Adds table row nodes (required for tables).

```typescript
import { TableRowExtension } from '@omnitron-dev/aether/components/editor';

new TableRowExtension();
```

#### TableCellExtension

Adds table cell nodes (required for tables).

```typescript
import { TableCellExtension } from '@omnitron-dev/aether/components/editor';

new TableCellExtension({
  HTMLAttributes: { class: 'table-cell' },
});
```

#### TableHeaderExtension

Adds table header cell nodes.

```typescript
import { TableHeaderExtension } from '@omnitron-dev/aether/components/editor';

new TableHeaderExtension({
  HTMLAttributes: { class: 'table-header' },
});
```

---

### Media Extensions

Media extensions add links and images.

**Location:** `packages/aether/src/components/editor/extensions/media/`

#### LinkExtension

Adds link marks.

```typescript
import { LinkExtension } from '@omnitron-dev/aether/components/editor';

new LinkExtension({
  openOnClick: true, // Open links on click
  autolink: true, // Auto-detect URLs
  HTMLAttributes: { class: 'link' },
});
```

**Options:**
- `openOnClick` - Open links when clicked (default: `true`)
- `autolink` - Automatically create links from URLs (default: `true`)

**Keyboard Shortcut:** `Mod-k`
**Commands:**
- `setLink({ href, title?, target? })` - Add/update link
- `unsetLink` - Remove link

#### ImageExtension

Adds image nodes.

```typescript
import { ImageExtension } from '@omnitron-dev/aether/components/editor';

new ImageExtension({
  inline: false, // Inline or block images
  allowBase64: false, // Allow base64 images
  HTMLAttributes: { class: 'image' },
});
```

**Options:**
- `inline` - Render as inline images (default: `false`)
- `allowBase64` - Allow base64 data URLs (default: `false`)

**Commands:**
- `insertImage({ src, alt?, title? })` - Insert an image

---

### Code Extensions

Code extensions add code editing functionality.

**Location:** `packages/aether/src/components/editor/extensions/code/`

#### CodeBlockExtension

Adds code block nodes.

```typescript
import { CodeBlockExtension } from '@omnitron-dev/aether/components/editor';

new CodeBlockExtension({
  defaultLanguage: 'plaintext',
  languageSelector: true, // Show language selector
  HTMLAttributes: { class: 'code-block' },
});
```

**Options:**
- `defaultLanguage` - Default language (default: `'plaintext'`)
- `languageSelector` - Show language selector UI (default: `false`)

**Keyboard Shortcut:** `Mod-Alt-c`
**Markdown:** ` ```language ` ... ` ``` `

#### SyntaxHighlightExtension

Adds syntax highlighting to code blocks.

```typescript
import { SyntaxHighlightExtension } from '@omnitron-dev/aether/components/editor';

new SyntaxHighlightExtension({
  languages: ['javascript', 'typescript', 'python', 'rust'],
});
```

**Options:**
- `languages` - Supported languages (default: common languages)

**Dependencies:** CodeBlockExtension

---

### Behavior Extensions

Behavior extensions add editor functionality.

**Location:** `packages/aether/src/components/editor/extensions/behavior/`

#### HistoryExtension

Adds undo/redo functionality.

```typescript
import { HistoryExtension } from '@omnitron-dev/aether/components/editor';

new HistoryExtension({
  depth: 100, // Max undo steps
  newGroupDelay: 500, // Time to group changes (ms)
});
```

**Options:**
- `depth` - Maximum undo steps (default: `100`)
- `newGroupDelay` - Time to group changes in ms (default: `500`)

**Keyboard Shortcuts:**
- `Mod-z` - Undo
- `Mod-y` - Redo
- `Mod-Shift-z` - Redo

**Commands:**
- `undo` - Undo last change
- `redo` - Redo last undone change

#### PlaceholderExtension

Adds placeholder text when editor is empty.

```typescript
import { PlaceholderExtension } from '@omnitron-dev/aether/components/editor';

new PlaceholderExtension({
  placeholder: 'Start typing...',
  emptyEditorClass: 'is-editor-empty',
  emptyNodeClass: 'is-empty',
  showOnlyWhenEditable: true,
});
```

**Options:**
- `placeholder` - Placeholder text (default: `''`)
- `emptyEditorClass` - CSS class for empty editor (default: `'is-editor-empty'`)
- `emptyNodeClass` - CSS class for empty nodes (default: `'is-empty'`)
- `showOnlyWhenEditable` - Only show when editable (default: `true`)

#### DropCursorExtension

Adds a drop cursor for drag-and-drop operations.

```typescript
import { DropCursorExtension } from '@omnitron-dev/aether/components/editor';

new DropCursorExtension({
  color: '#000',
  width: 2,
});
```

**Options:**
- `color` - Cursor color (default: `'#000'`)
- `width` - Cursor width in pixels (default: `1`)

#### GapCursorExtension

Adds gap cursor for navigating between blocks.

```typescript
import { GapCursorExtension } from '@omnitron-dev/aether/components/editor';

new GapCursorExtension();
```

---

### Search Extension

Adds search and replace functionality.

**Location:** `packages/aether/src/components/editor/extensions/search/`

#### SearchExtension

```typescript
import { SearchExtension } from '@omnitron-dev/aether/components/editor';

new SearchExtension({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  highlightMatches: true,
  maxMatches: 1000,
});
```

**Options:**
- `caseSensitive` - Case-sensitive search (default: `false`)
- `wholeWord` - Match whole words only (default: `false`)
- `regex` - Enable regex search (default: `false`)
- `highlightMatches` - Highlight matches (default: `true`)
- `maxMatches` - Maximum matches to find (default: `1000`)

**Keyboard Shortcuts:**
- `Mod-f` - Open search panel
- `Mod-g` - Find next
- `Mod-Shift-g` - Find previous
- `Escape` - Close search

**Methods:**

##### search()

Search for a query in the document.

```typescript
search(query: string, options?: SearchOptions): SearchResult[]
```

##### replace()

Replace the current match.

```typescript
replace(query: string, replacement: string): boolean
```

##### replaceAll()

Replace all matches.

```typescript
replaceAll(query: string, replacement: string): number
```

##### clearSearch()

Clear search state.

```typescript
clearSearch(): void
```

##### findNext()

Find next match.

```typescript
findNext(): boolean
```

##### findPrevious()

Find previous match.

```typescript
findPrevious(): boolean
```

---

### Markdown Extension

Adds markdown parsing and serialization.

**Location:** `packages/aether/src/components/editor/extensions/markdown/`

#### MarkdownExtension

```typescript
import { MarkdownExtension } from '@omnitron-dev/aether/components/editor';

new MarkdownExtension({
  html: true, // Allow HTML in markdown
  breaks: false, // Convert \n to <br>
  linkify: true, // Auto-detect links
});
```

**Options:**
- `html` - Allow HTML in markdown (default: `true`)
- `breaks` - Convert line breaks to `<br>` (default: `false`)
- `linkify` - Automatically create links from URLs (default: `true`)

**Utilities:**

##### parseMarkdown()

Parse markdown to ProseMirror document.

```typescript
import { parseMarkdown } from '@omnitron-dev/aether/components/editor';

const doc = parseMarkdown(schema, '# Hello\n\nWorld');
```

##### serializeToMarkdown()

Serialize ProseMirror document to markdown.

```typescript
import { serializeToMarkdown } from '@omnitron-dev/aether/components/editor';

const markdown = serializeToMarkdown(doc);
```

---

### Collaboration Extensions

Add real-time collaboration functionality.

**Location:** `packages/aether/src/components/editor/extensions/collaboration/`

#### CollaborationExtension

```typescript
import { CollaborationExtension } from '@omnitron-dev/aether/components/editor';

new CollaborationExtension({
  document: ydoc, // Yjs document
  field: 'content', // Field name in Yjs doc
});
```

**Options:**
- `document` - Yjs document instance (required)
- `field` - Field name in Yjs document (default: `'default'`)

**Dependencies:** Requires Yjs library

#### CollaborationCursorExtension

```typescript
import { CollaborationCursorExtension } from '@omnitron-dev/aether/components/editor';

new CollaborationCursorExtension({
  provider: provider, // Yjs provider
  user: { name: 'John', color: '#ff0000' },
});
```

**Options:**
- `provider` - Yjs provider instance (required)
- `user` - Current user information (name, color)

**Dependencies:** CollaborationExtension

---

## UI Components

### Toolbar

Toolbar component with formatting buttons.

**Location:** `packages/aether/src/components/editor/components/Toolbar.ts`

#### Props

```typescript
interface ToolbarProps {
  editor: Signal<EditorInstance | null>;
  items?: ToolbarItem[];
  class?: string;
  sticky?: boolean;
}
```

##### editor

- **Type:** `Signal<EditorInstance | null>`
- **Required:** Yes
- **Description:** Signal containing the editor instance.

##### items

- **Type:** `ToolbarItem[]`
- **Default:** `getDefaultToolbarItems()`
- **Description:** Array of toolbar items to display.

##### class

- **Type:** `string`
- **Description:** Additional CSS class for the toolbar.

##### sticky

- **Type:** `boolean`
- **Default:** `false`
- **Description:** Make toolbar sticky (fixed position).

#### Toolbar Items

```typescript
type ToolbarItem = ToolbarButton | ToolbarDropdown | ToolbarDivider | ToolbarGroup;

interface ToolbarButton {
  type: 'button';
  icon: string;
  title: string;
  command: string;
  args?: any[];
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

#### Usage

```typescript
import { Toolbar, getDefaultToolbarItems } from '@omnitron-dev/aether/components/editor';

jsx(Toolbar, {
  editor: editorSignal,
  items: getDefaultToolbarItems(),
  sticky: true,
});
```

#### Custom Toolbar

```typescript
const customItems: ToolbarItem[] = [
  {
    type: 'button',
    icon: 'B',
    title: 'Bold',
    command: 'bold',
    isActive: (editor) => editor.signals.activeMarks().some(m => m.type.name === 'bold'),
  },
  { type: 'divider' },
  {
    type: 'dropdown',
    icon: 'H',
    title: 'Heading',
    items: [
      { type: 'button', icon: 'H1', title: 'Heading 1', command: 'heading', args: [1] },
      { type: 'button', icon: 'H2', title: 'Heading 2', command: 'heading', args: [2] },
    ],
  },
];

jsx(Toolbar, {
  editor: editorSignal,
  items: customItems,
});
```

---

### BubbleMenu

Context menu that appears near selected text.

**Location:** `packages/aether/src/components/editor/components/BubbleMenu.ts`

#### Props

```typescript
interface BubbleMenuProps {
  editor: Signal<EditorInstance | null>;
  items?: BubbleMenuItem[];
  class?: string;
}
```

#### Usage

```typescript
import { BubbleMenu, getDefaultBubbleMenuItems } from '@omnitron-dev/aether/components/editor';

jsx(BubbleMenu, {
  editor: editorSignal,
  items: getDefaultBubbleMenuItems(),
});
```

---

### Statusbar

Status bar with editor information.

**Location:** `packages/aether/src/components/editor/components/Statusbar.ts`

#### Props

```typescript
interface StatusbarProps {
  editor: Signal<EditorInstance | null>;
  items?: StatusbarItem[];
  class?: string;
}
```

#### StatusbarItem Types

```typescript
type StatusbarItem = StatusbarText | StatusbarButton | StatusbarCustom;

interface StatusbarText {
  type: 'text';
  text: (editor: EditorInstance) => string;
}

interface StatusbarButton {
  type: 'button';
  text: string;
  onClick: (editor: EditorInstance) => void;
}

interface StatusbarCustom {
  type: 'custom';
  render: (editor: EditorInstance) => Node;
}
```

#### Usage

```typescript
import { Statusbar, getDefaultStatusbarItems } from '@omnitron-dev/aether/components/editor';

jsx(Statusbar, {
  editor: editorSignal,
  items: getDefaultStatusbarItems(),
});
```

#### Custom Statusbar

```typescript
const customItems: StatusbarItem[] = [
  {
    type: 'text',
    text: (editor) => `Words: ${editor.signals.wordCount()}`,
  },
  {
    type: 'text',
    text: (editor) => `Characters: ${editor.signals.charCount()}`,
  },
];

jsx(Statusbar, {
  editor: editorSignal,
  items: customItems,
});
```

---

### SearchPanel

Search and replace panel.

**Location:** `packages/aether/src/components/editor/components/SearchPanel.ts`

#### Props

```typescript
interface SearchPanelProps {
  editor: Signal<EditorInstance | null>;
  class?: string;
}
```

#### Usage

```typescript
import { SearchPanel } from '@omnitron-dev/aether/components/editor';

jsx(SearchPanel, {
  editor: editorSignal,
});
```

---

### LinkEditor

Link editing popup.

**Location:** `packages/aether/src/components/editor/components/LinkEditor.ts`

#### Props

```typescript
interface LinkEditorProps {
  editor: Signal<EditorInstance | null>;
  class?: string;
}
```

#### Usage

```typescript
import { LinkEditor } from '@omnitron-dev/aether/components/editor';

jsx(LinkEditor, {
  editor: editorSignal,
});
```

---

### MarkdownPreview

Live markdown preview component.

**Location:** `packages/aether/src/components/editor/components/MarkdownPreview.ts`

#### Props

```typescript
interface MarkdownPreviewProps {
  editor: Signal<EditorInstance | null>;
  class?: string;
}
```

#### Usage

```typescript
import { MarkdownPreview } from '@omnitron-dev/aether/components/editor';

jsx(MarkdownPreview, {
  editor: editorSignal,
});
```

---

## Signals

### Editor Signals

The editor instance exposes reactive signals for all state.

**Location:** `packages/aether/src/components/editor/signals/editorSignals.ts`

```typescript
interface EditorSignals {
  // Document state
  doc: Signal<PMNode>;
  selection: Signal<Selection>;

  // Editor state
  isFocused: WritableSignal<boolean>;
  isEditable: WritableSignal<boolean>;

  // Derived state (computed)
  isEmpty: Signal<boolean>;
  wordCount: Signal<number>;
  charCount: Signal<number>;
  canUndo: Signal<boolean>;
  canRedo: Signal<boolean>;

  // Active formatting
  activeMarks: Signal<Mark[]>;
  currentNodeType: Signal<NodeType | null>;

  // Selection state
  selectedText: Signal<string>;
}
```

#### Usage

```typescript
const editor = editorSignal();

// Read signals
const isEmpty = editor.signals.isEmpty();
const wordCount = editor.signals.wordCount();
const canUndo = editor.signals.canUndo();

// Write signals
editor.signals.isFocused.set(false);
editor.signals.isEditable.set(true);

// Use in computed
const status = computed(() => {
  const editor = editorSignal();
  if (!editor) return 'No editor';
  return editor.signals.isEmpty() ? 'Empty' : 'Has content';
});
```

---

### Derived Signals

Utility functions for creating derived signals.

**Location:** `packages/aether/src/components/editor/signals/derivedSignals.ts`

#### isDocumentEmpty()

```typescript
isDocumentEmpty(doc: Signal<PMNode>): Signal<boolean>
```

Check if document is empty.

#### countWords()

```typescript
countWords(doc: Signal<PMNode>): Signal<number>
```

Count words in document.

#### countCharacters()

```typescript
countCharacters(doc: Signal<PMNode>): Signal<number>
```

Count characters in document.

#### canUndoCommand()

```typescript
canUndoCommand(state: Signal<EditorState>): Signal<boolean>
```

Check if undo is available.

#### canRedoCommand()

```typescript
canRedoCommand(state: Signal<EditorState>): Signal<boolean>
```

Check if redo is available.

#### getActiveMarks()

```typescript
getActiveMarks(state: Signal<EditorState>): Signal<Mark[]>
```

Get active marks at selection.

#### getCurrentNodeType()

```typescript
getCurrentNodeType(state: Signal<EditorState>): Signal<NodeType | null>
```

Get current node type.

#### getSelectedText()

```typescript
getSelectedText(state: Signal<EditorState>): Signal<string>
```

Get selected text.

---

## Utilities

### Content Utilities

**Location:** `packages/aether/src/components/editor/utils/content.ts`

#### parseContent()

Parse content to ProseMirror document.

```typescript
parseContent(
  schema: Schema,
  content: string | JSONContent,
  type: ContentType,
  options?: ParseOptions
): Node
```

#### serializeContent()

Serialize ProseMirror document.

```typescript
serializeContent(
  doc: Node,
  type: ContentType,
  options?: SerializeOptions
): string | JSONContent
```

#### serializeHTML()

Serialize to HTML.

```typescript
serializeHTML(doc: Node, schema: Schema): string
```

#### serializeJSON()

Serialize to JSON.

```typescript
serializeJSON(doc: Node): JSONContent
```

#### serializeText()

Serialize to plain text.

```typescript
serializeText(doc: Node, separator?: string): string
```

#### createEmptyDoc()

Create an empty document.

```typescript
createEmptyDoc(schema: Schema): Node
```

---

### Selection Utilities

**Location:** `packages/aether/src/components/editor/utils/selection.ts`

#### setSelection()

Set selection position.

```typescript
setSelection(view: EditorView, from: number, to?: number): void
```

#### selectAll()

Select entire document.

```typescript
selectAll(state: EditorState, dispatch?: (tr: Transaction) => void): boolean
```

#### selectStart()

Select start of document.

```typescript
selectStart(view: EditorView): void
```

#### selectEnd()

Select end of document.

```typescript
selectEnd(view: EditorView): void
```

#### getSelectionStart()

Get selection start position.

```typescript
getSelectionStart(state: EditorState): number
```

#### getSelectionEnd()

Get selection end position.

```typescript
getSelectionEnd(state: EditorState): number
```

#### isSelectionEmpty()

Check if selection is empty.

```typescript
isSelectionEmpty(state: EditorState): boolean
```

#### getSelectionText()

Get selected text.

```typescript
getSelectionText(state: EditorState): string
```

#### isMultiBlockSelection()

Check if selection spans multiple blocks.

```typescript
isMultiBlockSelection(state: EditorState): boolean
```

#### getSelectionDepth()

Get selection depth.

```typescript
getSelectionDepth(state: EditorState): number
```

---

### Command Utilities

**Location:** `packages/aether/src/components/editor/utils/commands.ts`

#### canExecuteCommand()

Check if a command can execute.

```typescript
canExecuteCommand(command: Command, state: EditorState, view: EditorView): boolean
```

#### executeCommand()

Execute a command.

```typescript
executeCommand(command: Command, state: EditorState, dispatch: (tr: Transaction) => void, view: EditorView): boolean
```

#### undoCommand()

Undo last change.

```typescript
undoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean
```

#### redoCommand()

Redo last undone change.

```typescript
redoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean
```

#### insertText()

Insert text at selection.

```typescript
insertText(text: string): Command
```

#### deleteSelection()

Delete current selection.

```typescript
deleteSelection(): Command
```

#### insertNode()

Insert a node.

```typescript
insertNode(node: Node): Command
```

#### selectAllCommand()

Select all content.

```typescript
selectAllCommand(): Command
```

---

## Commands Reference

Commands are executed via the editor's command manager.

### Text Formatting

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `bold` | Toggle bold | `Mod-b` |
| `italic` | Toggle italic | `Mod-i` |
| `underline` | Toggle underline | `Mod-u` |
| `strike` | Toggle strikethrough | `Mod-Shift-x` |
| `code` | Toggle inline code | `Mod-e` |

### Blocks

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `heading` | Set heading (level as arg) | `Mod-Alt-1` to `Mod-Alt-6` |
| `paragraph` | Convert to paragraph | `Mod-Alt-0` |
| `blockquote` | Toggle blockquote | `Mod-Shift-b` |
| `horizontalRule` | Insert horizontal rule | `Mod-Shift-minus` |
| `codeBlock` | Toggle code block | `Mod-Alt-c` |

### Lists

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `bulletList` | Toggle bullet list | `Mod-Shift-8` |
| `orderedList` | Toggle ordered list | `Mod-Shift-7` |
| `taskList` | Toggle task list | - |
| `liftListItem` | Decrease indentation | `Shift-Tab` |
| `sinkListItem` | Increase indentation | `Tab` |

### Tables

| Command | Description |
|---------|-------------|
| `insertTable` | Insert table ({ rows, cols }) |
| `deleteTable` | Delete table |
| `addColumnBefore` | Add column before |
| `addColumnAfter` | Add column after |
| `deleteColumn` | Delete column |
| `addRowBefore` | Add row before |
| `addRowAfter` | Add row after |
| `deleteRow` | Delete row |
| `mergeCells` | Merge cells |
| `splitCell` | Split cell |

### History

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `undo` | Undo | `Mod-z` |
| `redo` | Redo | `Mod-y`, `Mod-Shift-z` |

### Links

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `setLink` | Set link ({ href, title?, target? }) | `Mod-k` |
| `unsetLink` | Remove link | - |

### Images

| Command | Description |
|---------|-------------|
| `insertImage` | Insert image ({ src, alt?, title? }) |

### Search

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `search` | Search | `Mod-f` |
| `findNext` | Find next | `Mod-g` |
| `findPrevious` | Find previous | `Mod-Shift-g` |
| `replace` | Replace current | - |
| `replaceAll` | Replace all | - |

### Example: Executing Commands

```typescript
const editor = editorSignal();

// Simple command
editor.commands.execute('bold');

// Command with arguments
editor.commands.execute('heading', 1);

// Check if command can execute
if (editor.commands.can('bold')) {
  editor.commands.execute('bold');
}

// Chain commands
editor.commands
  .chain()
  .focus()
  .execute('bold')
  .execute('italic')
  .run();
```

---

## Keyboard Shortcuts

### Text Formatting

| Shortcut | Action |
|----------|--------|
| `Mod-b` | Bold |
| `Mod-i` | Italic |
| `Mod-u` | Underline |
| `Mod-Shift-x` | Strikethrough |
| `Mod-e` | Inline code |

### Headings

| Shortcut | Action |
|----------|--------|
| `Mod-Alt-0` | Paragraph |
| `Mod-Alt-1` | Heading 1 |
| `Mod-Alt-2` | Heading 2 |
| `Mod-Alt-3` | Heading 3 |
| `Mod-Alt-4` | Heading 4 |
| `Mod-Alt-5` | Heading 5 |
| `Mod-Alt-6` | Heading 6 |

### Lists

| Shortcut | Action |
|----------|--------|
| `Mod-Shift-8` | Bullet list |
| `Mod-Shift-7` | Ordered list |
| `Tab` | Increase indent (in list) |
| `Shift-Tab` | Decrease indent (in list) |
| `Enter` | Split list item |

### Blocks

| Shortcut | Action |
|----------|--------|
| `Mod-Shift-b` | Blockquote |
| `Mod-Alt-c` | Code block |
| `Mod-Shift-minus` | Horizontal rule |

### History

| Shortcut | Action |
|----------|--------|
| `Mod-z` | Undo |
| `Mod-y` | Redo |
| `Mod-Shift-z` | Redo (alternative) |

### Selection

| Shortcut | Action |
|----------|--------|
| `Mod-a` | Select all |

### Links

| Shortcut | Action |
|----------|--------|
| `Mod-k` | Add/edit link |

### Search

| Shortcut | Action |
|----------|--------|
| `Mod-f` | Open search |
| `Mod-g` | Find next |
| `Mod-Shift-g` | Find previous |
| `Escape` | Close search |

**Note:** `Mod` is `Cmd` on macOS and `Ctrl` on Windows/Linux.

---

## Types

### Core Types

#### ContentType

```typescript
type ContentType = 'html' | 'json' | 'text' | 'markdown';
```

#### JSONContent

```typescript
interface JSONContent {
  type: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: Array<{
    type: string;
    attrs?: Record<string, any>;
  }>;
  text?: string;
}
```

#### ExtensionType

```typescript
type ExtensionType = 'node' | 'mark' | 'behavior';
```

#### SchemaContribution

```typescript
interface SchemaContribution {
  nodes?: Record<string, NodeSpec>;
  marks?: Record<string, MarkSpec>;
}
```

### See Also

- **[Getting Started Guide](./getting-started.md)** - Installation and basic setup
- **[Extensions Guide](./extensions.md)** - Creating custom extensions
- **[Theming Guide](./theming.md)** - Customizing appearance
- **[Migration Guide](./migration.md)** - Migrating from other editors

---

**Last Updated:** 2025-10-16
**Package:** `@omnitron-dev/aether`
**Version:** 1.0.0
