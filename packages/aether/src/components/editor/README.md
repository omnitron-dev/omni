# Advanced Editor Component - Phase 1 Implementation

A ProseMirror-based rich text editor with Aether signal integration.

## Overview

The Advanced Editor provides a foundation for building rich text editing experiences in Aether applications. Phase 1 focuses on core infrastructure and basic text editing capabilities.

## Architecture

### Core Components

1. **Extension System** (`core/Extension.ts`)
   - Base class for all editor extensions
   - Support for schema contribution, plugins, input rules, and keyboard shortcuts
   - Dependency management between extensions

2. **ExtensionManager** (`core/ExtensionManager.ts`)
   - Manages extension lifecycle
   - Topological sort for dependency resolution
   - Aggregates schema, plugins, keymaps, and input rules

3. **SchemaBuilder** (`core/SchemaBuilder.ts`)
   - Builds ProseMirror schema from extensions
   - Provides base schema (doc, paragraph, text)
   - Merges contributions from all extensions

4. **EditorBridge** (`core/EditorBridge.ts`)
   - Bridge between ProseMirror and Aether signals
   - Syncs editor state with reactive signals
   - Manages editor lifecycle and event handling

5. **AdvancedEditor** (`AdvancedEditor.ts`)
   - Main Aether component
   - Uses `defineComponent()` for proper lifecycle management
   - Provides props-based API

### Signals

The editor exposes reactive signals for:
- `doc` - ProseMirror document
- `selection` - Current selection
- `isFocused` - Focus state
- `isEditable` - Editable state
- `isEmpty` - Whether document is empty
- `wordCount` - Word count
- `charCount` - Character count
- `canUndo` / `canRedo` - Undo/redo availability
- `activeMarks` - Active marks at selection
- `currentNodeType` - Node type at selection
- `selectedText` - Selected text content

### Utilities

- **content.ts** - Parse/serialize content (HTML, JSON, text)
- **selection.ts** - Selection helper functions
- **commands.ts** - Basic command utilities

## Usage

```typescript
import { AdvancedEditor } from '@omnitron-dev/aether/components/editor';

// Basic usage
const editor = AdvancedEditor({
  content: 'Hello world',
  contentType: 'text',
  editable: true,
  autofocus: true,

  onCreate: (editor) => {
    console.log('Editor created');
  },

  onUpdate: ({ editor }) => {
    console.log('Content:', editor.getText());
    console.log('Words:', editor.signals.wordCount());
  },
});
```

## API

### Props

- `content?: string | JSONContent` - Initial content
- `contentType?: 'html' | 'json' | 'text' | 'markdown'` - Content type
- `extensions?: IExtension[]` - Editor extensions
- `editable?: boolean` - Whether editor is editable
- `autofocus?: boolean | 'start' | 'end' | number` - Auto-focus behavior
- `class?: string` - CSS class for wrapper
- `editorClass?: string` - CSS class for editor element
- Event callbacks: `onCreate`, `onUpdate`, `onSelectionUpdate`, `onTransaction`, `onFocus`, `onBlur`, `onDestroy`

### Editor Instance

The `EditorInstance` provides:

- `state: EditorState` - ProseMirror state
- `view: EditorView` - ProseMirror view
- `schema: Schema` - Editor schema
- `signals: EditorSignals` - Aether signals
- Methods: `getHTML()`, `getJSON()`, `getText()`, `setContent()`, `clearContent()`, `focus()`, `blur()`, `isEmpty()`, `isFocused()`, `isEditable()`, `destroy()`

## Creating Extensions

```typescript
import { Extension } from '@omnitron-dev/aether/components/editor';
import type { ExtensionType } from '@omnitron-dev/aether/components/editor';

class MyExtension extends Extension<{ option: string }> {
  get name() {
    return 'myExtension';
  }

  get type(): ExtensionType {
    return 'behavior';
  }

  protected defaultOptions() {
    return { option: 'default' };
  }

  getSchema() {
    return {
      nodes: {
        // Add custom nodes
      },
      marks: {
        // Add custom marks
      },
    };
  }

  getKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        // Handle shortcut
        return true;
      },
    };
  }
}
```

## Phase 1 Status

### ✅ Completed

- Core extension system with dependency resolution
- Schema building from extensions
- ProseMirror-Aether signal integration
- Basic editor component with lifecycle management
- Content parsing and serialization (HTML, JSON, text)
- Selection utilities
- Command utilities
- Comprehensive test suite (57 tests, all passing)

### 📋 Next Steps (Phase 2)

Phase 2 will add:
- Text formatting extensions (bold, italic, underline, etc.)
- Block formatting extensions (headings, paragraphs, blockquote)
- List extensions (bullet, ordered, task)
- Command manager with chaining
- Toolbar component

## Testing

Run tests:
```bash
pnpm test test/components/editor
```

Run tests with coverage:
```bash
pnpm test:coverage test/components/editor
```

## Performance

The editor is designed for optimal performance:
- Lazy initialization
- Efficient signal updates
- Minimal DOM manipulation
- Transaction batching via ProseMirror

## Browser Support

Requires a modern browser with:
- ES2020+ support
- DOM API
- ResizeObserver
- IntersectionObserver

Same as Aether core requirements.
