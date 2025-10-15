/**
 * EditorBridge integration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorBridge } from '../../../src/components/editor/core/EditorBridge.js';
import type { EditorProps } from '../../../src/components/editor/core/types.js';

describe('EditorBridge', () => {
  let container: HTMLDivElement;
  let editor: EditorBridge | null;

  beforeEach(() => {
    // Create a container for the editor
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = null;
  });

  afterEach(() => {
    // Cleanup
    if (editor) {
      editor.destroy();
      editor = null;
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should create an editor instance', () => {
    editor = new EditorBridge(container, {});
    expect(editor).toBeDefined();
    expect(editor.view).toBeDefined();
    expect(editor.state).toBeDefined();
    expect(editor.schema).toBeDefined();
    expect(editor.signals).toBeDefined();
  });

  it('should initialize with empty content', () => {
    editor = new EditorBridge(container, {});
    expect(editor.isEmpty()).toBe(true);
  });

  it('should initialize with text content', () => {
    editor = new EditorBridge(container, {
      content: 'Hello world',
      contentType: 'text',
    });

    expect(editor.isEmpty()).toBe(false);
    expect(editor.getText()).toContain('Hello world');
  });

  it('should initialize with HTML content', () => {
    editor = new EditorBridge(container, {
      content: '<p>Hello <strong>world</strong></p>',
      contentType: 'html',
    });

    expect(editor.isEmpty()).toBe(false);
    expect(editor.getHTML()).toContain('Hello');
  });

  it('should update signals on content change', () => {
    editor = new EditorBridge(container, {});

    const initialDoc = editor.signals.doc();
    editor.setContent('New content', 'text');
    const updatedDoc = editor.signals.doc();

    expect(updatedDoc).not.toBe(initialDoc);
  });

  it('should track focus state', () => {
    editor = new EditorBridge(container, {});

    expect(editor.signals.isFocused()).toBe(false);

    editor.focus();
    // Note: focus might not work in JSDOM, so we just test that the signal exists
    expect(typeof editor.signals.isFocused()).toBe('boolean');
  });

  it('should track editable state', () => {
    editor = new EditorBridge(container, { editable: false });
    expect(editor.signals.isEditable()).toBe(false);

    editor.signals.isEditable.set(true);
    expect(editor.signals.isEditable()).toBe(true);
  });

  it('should get HTML content', () => {
    editor = new EditorBridge(container, {
      content: 'Test',
      contentType: 'text',
    });

    const html = editor.getHTML();
    expect(html).toContain('Test');
  });

  it('should get JSON content', () => {
    editor = new EditorBridge(container, {
      content: 'Test',
      contentType: 'text',
    });

    const json = editor.getJSON();
    expect(json).toBeDefined();
    expect(json.type).toBe('doc');
  });

  it('should get plain text content', () => {
    editor = new EditorBridge(container, {
      content: 'Test content',
      contentType: 'text',
    });

    const text = editor.getText();
    expect(text).toContain('Test content');
  });

  it('should set content', () => {
    editor = new EditorBridge(container, {});

    editor.setContent('New content', 'text');
    expect(editor.getText()).toContain('New content');
  });

  it('should clear content', () => {
    editor = new EditorBridge(container, {
      content: 'Some content',
      contentType: 'text',
    });

    expect(editor.isEmpty()).toBe(false);

    editor.clearContent();
    expect(editor.isEmpty()).toBe(true);
  });

  it('should call onCreate callback', () => {
    let called = false;
    editor = new EditorBridge(container, {
      onCreate: (ed) => {
        called = true;
        expect(ed).toBeDefined();
      },
    });

    expect(called).toBe(true);
  });

  it('should call onUpdate callback on content change', () => {
    let called = false;
    editor = new EditorBridge(container, {
      onUpdate: ({ editor }) => {
        called = true;
        expect(editor).toBeDefined();
      },
    });

    editor.setContent('New content', 'text');
    expect(called).toBe(true);
  });

  it('should call onDestroy callback on destroy', () => {
    let called = false;
    editor = new EditorBridge(container, {
      onDestroy: () => {
        called = true;
      },
    });

    editor.destroy();
    expect(called).toBe(true);
  });

  it('should handle focus position', () => {
    editor = new EditorBridge(container, {
      content: 'Hello world',
      contentType: 'text',
    });

    // Test that focus methods don't throw
    expect(() => editor!.focus('start')).not.toThrow();
    expect(() => editor!.focus('end')).not.toThrow();
    expect(() => editor!.focus(5)).not.toThrow();
  });

  it('should update word count signal', () => {
    editor = new EditorBridge(container, {
      content: 'Hello world test',
      contentType: 'text',
    });

    expect(editor.signals.wordCount()).toBe(3);
  });

  it('should update char count signal', () => {
    editor = new EditorBridge(container, {
      content: 'Hello',
      contentType: 'text',
    });

    expect(editor.signals.charCount()).toBe(5);
  });

  it('should track isEmpty signal', () => {
    editor = new EditorBridge(container, {});
    expect(editor.signals.isEmpty()).toBe(true);

    editor.setContent('Content', 'text');
    expect(editor.signals.isEmpty()).toBe(false);
  });

  it('should not throw when destroying twice', () => {
    editor = new EditorBridge(container, {});

    editor.destroy();
    expect(() => editor!.destroy()).not.toThrow();
  });
});
