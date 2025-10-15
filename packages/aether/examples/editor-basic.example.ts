/**
 * Basic Editor Example
 *
 * Demonstrates the basic usage of the AdvancedEditor component
 */

import { AdvancedEditor } from '../src/components/editor/index.js';

// Example 1: Simple text editor
export function SimpleTextEditor() {
  return AdvancedEditor({
    content: 'Hello, World!',
    contentType: 'text',
    editable: true,
    autofocus: true,
    class: 'my-editor',
    onCreate: (editor) => {
      console.log('Editor created:', editor);
      console.log('Initial content:', editor.getText());
    },
    onUpdate: ({ editor }) => {
      console.log('Content updated:', editor.getText());
      console.log('Word count:', editor.signals.wordCount());
    },
  });
}

// Example 2: Empty editor
export function EmptyEditor() {
  return AdvancedEditor({
    editable: true,
    class: 'my-editor',
  });
}

// Example 3: Read-only editor
export function ReadOnlyEditor() {
  return AdvancedEditor({
    content: 'This content is read-only',
    contentType: 'text',
    editable: false,
    class: 'readonly-editor',
  });
}

// Example 4: Editor with event handling
export function EditorWithEvents() {
  return AdvancedEditor({
    content: 'Type something...',
    contentType: 'text',
    onCreate: (editor) => {
      console.log('Editor initialized');
      console.log('Is empty:', editor.isEmpty());
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      const wordCount = editor.signals.wordCount();
      const charCount = editor.signals.charCount();

      console.log(`Text: "${text}"`);
      console.log(`Words: ${wordCount}, Characters: ${charCount}`);
    },
    onFocus: ({ editor }) => {
      console.log('Editor focused');
    },
    onBlur: ({ editor }) => {
      console.log('Editor blurred');
    },
  });
}

// Example usage in a web page:
// const editor = SimpleTextEditor();
// document.getElementById('editor-container').appendChild(editor);
