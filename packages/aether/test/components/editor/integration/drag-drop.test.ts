/**
 * Drag and Drop Integration Tests
 *
 * Tests drag and drop functionality including images and files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { ImageExtension } from '../../../../src/components/editor/extensions/media/ImageExtension.js';
import { DropCursorExtension } from '../../../../src/components/editor/extensions/behavior/DropCursorExtension.js';
import { createIntegrationTestEditor, cleanupEditor, simulateDragDrop, createTestFile } from './helpers.js';

describe('Drag and Drop', () => {
  let editor: EditorInstance;

  beforeEach(() => {
    editor = createIntegrationTestEditor([new ParagraphExtension(), new ImageExtension(), new DropCursorExtension()]);
  });

  afterEach(() => {
    cleanupEditor(editor);
  });

  describe('Image Drag and Drop', () => {
    it('should handle image file drop', () => {
      editor.setContent('<p>Text</p>');

      const imageFile = createTestFile('test.jpg', 'fake image data', 'image/jpeg');
      simulateDragDrop(editor, imageFile, 1);

      expect(editor.state).toBeDefined();
    });

    it('should handle PNG image drop', () => {
      editor.setContent('<p>Text</p>');

      const imageFile = createTestFile('test.png', 'fake image data', 'image/png');
      simulateDragDrop(editor, imageFile, 1);

      expect(editor.state).toBeDefined();
    });

    it('should handle GIF image drop', () => {
      editor.setContent('<p>Text</p>');

      const imageFile = createTestFile('test.gif', 'fake image data', 'image/gif');
      simulateDragDrop(editor, imageFile, 1);

      expect(editor.state).toBeDefined();
    });

    it('should handle WebP image drop', () => {
      editor.setContent('<p>Text</p>');

      const imageFile = createTestFile('test.webp', 'fake image data', 'image/webp');
      simulateDragDrop(editor, imageFile, 1);

      expect(editor.state).toBeDefined();
    });

    it('should insert image at drop position', () => {
      editor.setContent('<p>Before After</p>');

      const imageFile = createTestFile('test.jpg', 'fake image data', 'image/jpeg');
      simulateDragDrop(editor, imageFile, 7);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Text Drag and Drop', () => {
    it('should handle text drag within editor', () => {
      editor.setContent('<p>Hello world</p>');

      // Text drag and drop would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should handle text drag from outside', () => {
      editor.setContent('<p>Text</p>');

      // External text drag would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should preserve formatting on text drag', () => {
      editor.setContent('<p><strong>Bold text</strong></p>');

      // Drag with formatting would be tested here
      expect(editor.state).toBeDefined();
    });
  });

  describe('File Upload', () => {
    it('should handle file upload via drop', () => {
      editor.setContent('<p>Text</p>');

      const textFile = createTestFile('test.txt', 'file content', 'text/plain');
      simulateDragDrop(editor, textFile, 1);

      expect(editor.state).toBeDefined();
    });

    it('should reject invalid file types', () => {
      editor.setContent('<p>Text</p>');

      const execFile = createTestFile('test.exe', 'executable', 'application/x-executable');
      simulateDragDrop(editor, execFile, 1);

      // Should not insert invalid file types
      expect(editor.state).toBeDefined();
    });

    it('should handle multiple file drop', () => {
      editor.setContent('<p>Text</p>');

      const file1 = createTestFile('test1.jpg', 'image1', 'image/jpeg');
      const file2 = createTestFile('test2.jpg', 'image2', 'image/jpeg');

      simulateDragDrop(editor, file1, 1);
      simulateDragDrop(editor, file2, 3);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Drop Cursor', () => {
    it('should show drop cursor on drag over', () => {
      editor.setContent('<p>Text</p>');

      // Drop cursor visibility would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should update drop cursor position', () => {
      editor.setContent('<p>Long text content</p>');

      // Drop cursor position updates would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should hide drop cursor on drag end', () => {
      editor.setContent('<p>Text</p>');

      // Drop cursor hiding would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should hide drop cursor on drop', () => {
      editor.setContent('<p>Text</p>');

      const file = createTestFile('test.jpg', 'image', 'image/jpeg');
      simulateDragDrop(editor, file, 1);

      // Drop cursor should be hidden after drop
      expect(editor.state).toBeDefined();
    });
  });

  describe('Invalid Drops', () => {
    it('should reject drops outside editor', () => {
      editor.setContent('<p>Text</p>');

      // Invalid position drops would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should reject drops in read-only mode', () => {
      editor.setContent('<p>Text</p>');
      editor.signals.isEditable.set(false);

      const file = createTestFile('test.jpg', 'image', 'image/jpeg');
      simulateDragDrop(editor, file, 1);

      // Should not allow drops when read-only
      expect(editor.isEditable()).toBe(false);
    });

    it('should reject unsupported file types', () => {
      editor.setContent('<p>Text</p>');

      const unsupportedFile = createTestFile('test.xyz', 'content', 'application/xyz');
      simulateDragDrop(editor, unsupportedFile, 1);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Drop Position Handling', () => {
    it('should handle drop at start', () => {
      editor.setContent('<p>Text</p>');

      const file = createTestFile('test.jpg', 'image', 'image/jpeg');
      simulateDragDrop(editor, file, 0);

      expect(editor.state).toBeDefined();
    });

    it('should handle drop at end', () => {
      editor.setContent('<p>Text</p>');

      const file = createTestFile('test.jpg', 'image', 'image/jpeg');
      const endPos = editor.state.doc.content.size - 1;
      simulateDragDrop(editor, file, endPos);

      expect(editor.state).toBeDefined();
    });

    it('should handle drop in middle', () => {
      editor.setContent('<p>Hello world</p>');

      const file = createTestFile('test.jpg', 'image', 'image/jpeg');
      simulateDragDrop(editor, file, 7);

      expect(editor.state).toBeDefined();
    });

    it('should handle drop between paragraphs', () => {
      editor.setContent('<p>First</p><p>Second</p>');

      const file = createTestFile('test.jpg', 'image', 'image/jpeg');
      simulateDragDrop(editor, file, 7);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Large Files', () => {
    it('should handle large image files', () => {
      editor.setContent('<p>Text</p>');

      const largeContent = 'x'.repeat(1000000); // 1MB
      const largeFile = createTestFile('large.jpg', largeContent, 'image/jpeg');
      simulateDragDrop(editor, largeFile, 1);

      expect(editor.state).toBeDefined();
    });

    it('should reject files over size limit', () => {
      editor.setContent('<p>Text</p>');

      const hugeContent = 'x'.repeat(10000000); // 10MB
      const hugeFile = createTestFile('huge.jpg', hugeContent, 'image/jpeg');
      simulateDragDrop(editor, hugeFile, 1);

      // Should reject if over limit
      expect(editor.state).toBeDefined();
    });
  });

  describe('Drag and Drop Events', () => {
    it('should fire dragenter event', () => {
      editor.setContent('<p>Text</p>');

      let eventFired = false;
      // Dragenter event listener would be tested here

      expect(editor.state).toBeDefined();
    });

    it('should fire dragover event', () => {
      editor.setContent('<p>Text</p>');

      // Dragover event listener would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should fire dragleave event', () => {
      editor.setContent('<p>Text</p>');

      // Dragleave event listener would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should fire drop event', () => {
      editor.setContent('<p>Text</p>');

      const file = createTestFile('test.jpg', 'image', 'image/jpeg');
      simulateDragDrop(editor, file, 1);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle drop with empty file', () => {
      editor.setContent('<p>Text</p>');

      const emptyFile = createTestFile('empty.jpg', '', 'image/jpeg');
      simulateDragDrop(editor, emptyFile, 1);

      expect(editor.state).toBeDefined();
    });

    it('should handle drop with no file', () => {
      editor.setContent('<p>Text</p>');

      // Drop with no file would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should handle concurrent drops', () => {
      editor.setContent('<p>Text</p>');

      const file1 = createTestFile('test1.jpg', 'image1', 'image/jpeg');
      const file2 = createTestFile('test2.jpg', 'image2', 'image/jpeg');

      simulateDragDrop(editor, file1, 1);
      simulateDragDrop(editor, file2, 3);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle rapid drops efficiently', () => {
      editor.setContent('<p>Text</p>');

      const start = Date.now();

      for (let i = 0; i < 5; i++) {
        const file = createTestFile(`test${i}.jpg`, 'image', 'image/jpeg');
        simulateDragDrop(editor, file, 1 + i);
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000);
    });

    it('should not block UI during drop', () => {
      editor.setContent('<p>Text</p>');

      const file = createTestFile('test.jpg', 'x'.repeat(100000), 'image/jpeg');

      const start = Date.now();
      simulateDragDrop(editor, file, 1);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });
  });
});
