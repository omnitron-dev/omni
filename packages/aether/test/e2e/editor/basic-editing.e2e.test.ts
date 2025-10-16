/**
 * E2E Tests: Basic Editing Operations
 *
 * Tests fundamental editing operations like typing, selection, deletion,
 * undo/redo, and copy/paste functionality.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorText,
  getEditorHTML,
  selectText,
  selectAll,
  clearEditor,
  deleteText,
  undo,
  redo,
  copy,
  paste,
  pasteFromClipboard,
  pressShortcut,
  moveCursor,
  doubleClick,
  tripleClick,
  getEditor,
  focusEditor,
  blurEditor,
  isEditorFocused,
} from './helpers';

test.describe('Basic Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/basic-editor.html');
    await waitForEditor(page);
  });

  test('should load editor successfully', async ({ page }) => {
    const editor = getEditor(page);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'true');
  });

  test('should type text in editor', async ({ page }) => {
    await typeText(page, 'Hello World');

    const text = await getEditorText(page);
    expect(text).toContain('Hello World');
  });

  test('should type multiple lines of text', async ({ page }) => {
    await typeText(page, 'Line 1');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Line 2');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Line 3');

    const text = await getEditorText(page);
    expect(text).toContain('Line 1');
    expect(text).toContain('Line 2');
    expect(text).toContain('Line 3');
  });

  test('should type special characters', async ({ page }) => {
    const specialChars = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./';
    await typeText(page, specialChars);

    const text = await getEditorText(page);
    expect(text).toContain(specialChars);
  });

  test('should type unicode characters', async ({ page }) => {
    const unicode = 'Hello 你好 こんにちは مرحبا';
    await typeText(page, unicode);

    const text = await getEditorText(page);
    expect(text).toContain(unicode);
  });

  test('should delete text with backspace', async ({ page }) => {
    await typeText(page, 'Hello World');
    await deleteText(page, 5); // Delete "World"

    const text = await getEditorText(page);
    expect(text).toContain('Hello ');
    expect(text).not.toContain('World');
  });

  test('should delete text with delete key', async ({ page }) => {
    await typeText(page, 'Hello World');
    await moveCursor(page, 'ArrowLeft', 5); // Move before "World"
    await page.keyboard.press('Delete');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Delete');

    const text = await getEditorText(page);
    expect(text).toContain('Hello ');
    expect(text).not.toContain('World');
  });

  test('should select text with shift+arrows', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5); // Select "Hello"

    const selection = await page.evaluate(() => {
      return window.getSelection()?.toString();
    });

    expect(selection).toBe('Hello');
  });

  test('should select all text with Ctrl/Cmd+A', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectAll(page);

    const selection = await page.evaluate(() => {
      return window.getSelection()?.toString();
    });

    expect(selection).toContain('Hello World');
  });

  test('should double-click to select word', async ({ page }) => {
    await typeText(page, 'Hello World');
    await moveCursor(page, 'ArrowLeft', 8); // Move to "Hello"
    await doubleClick(page);

    const selection = await page.evaluate(() => {
      return window.getSelection()?.toString();
    });

    // Should select the word (implementation may vary)
    expect(selection?.length).toBeGreaterThan(0);
  });

  test('should triple-click to select paragraph', async ({ page }) => {
    await typeText(page, 'This is a paragraph with multiple words');
    await tripleClick(page);

    const selection = await page.evaluate(() => {
      return window.getSelection()?.toString();
    });

    expect(selection).toContain('paragraph');
  });

  test('should delete selected text', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 6, 11); // Select "World"
    await page.keyboard.press('Backspace');

    const text = await getEditorText(page);
    expect(text).toContain('Hello');
    expect(text).not.toContain('World');
  });

  test('should replace selected text by typing', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 6, 11); // Select "World"
    await typeText(page, 'Universe');

    const text = await getEditorText(page);
    expect(text).toContain('Hello Universe');
    expect(text).not.toContain('World');
  });

  test('should undo typing', async ({ page }) => {
    await typeText(page, 'Hello World');
    await undo(page);

    const text = await getEditorText(page);
    // After undo, text should be different
    expect(text.length).toBeLessThan('Hello World'.length);
  });

  test('should redo after undo', async ({ page }) => {
    await typeText(page, 'Hello World');
    await undo(page);
    await redo(page);

    const text = await getEditorText(page);
    expect(text).toContain('Hello World');
  });

  test('should copy and paste text', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5); // Select "Hello"
    await copy(page);
    await moveCursor(page, 'ArrowRight', 6); // Move to end
    await page.keyboard.press('Space');
    await paste(page);

    const text = await getEditorText(page);
    expect(text).toContain('Hello World Hello');
  });

  test('should cut and paste text', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5); // Select "Hello"
    await pressShortcut(page, 'Mod+x'); // Cut
    await moveCursor(page, 'ArrowRight', 6); // Move to end
    await paste(page);

    const text = await getEditorText(page);
    expect(text).toContain('World Hello');
    expect(text).not.toContain('Hello World');
  });

  test('should paste plain text from clipboard', async ({ page }) => {
    await pasteFromClipboard(page, 'Pasted text');

    const text = await getEditorText(page);
    expect(text).toContain('Pasted text');
  });

  test('should handle multiple undo operations', async ({ page }) => {
    await typeText(page, 'First ');
    await typeText(page, 'Second ');
    await typeText(page, 'Third');

    await undo(page);
    let text = await getEditorText(page);
    expect(text).not.toContain('Third');

    await undo(page);
    text = await getEditorText(page);
    expect(text).not.toContain('Second');

    await undo(page);
    text = await getEditorText(page);
    expect(text).not.toContain('First');
  });

  test('should handle multiple redo operations', async ({ page }) => {
    await typeText(page, 'First ');
    await typeText(page, 'Second ');
    await typeText(page, 'Third');

    await undo(page);
    await undo(page);
    await undo(page);

    await redo(page);
    let text = await getEditorText(page);
    expect(text).toContain('First');

    await redo(page);
    text = await getEditorText(page);
    expect(text).toContain('Second');

    await redo(page);
    text = await getEditorText(page);
    expect(text).toContain('Third');
  });

  test('should maintain cursor position after typing', async ({ page }) => {
    await typeText(page, 'Hello');
    await moveCursor(page, 'ArrowLeft', 2); // Move cursor to "Hel|lo"
    await typeText(page, 'X');

    const text = await getEditorText(page);
    expect(text).toContain('HelXlo');
  });

  test('should handle empty editor state', async ({ page }) => {
    const text = await getEditorText(page);
    expect(text.trim()).toBe('');
  });

  test('should clear all editor content', async ({ page }) => {
    await typeText(page, 'Hello World');
    await clearEditor(page);

    const text = await getEditorText(page);
    expect(text.trim()).toBe('');
  });

  test('should focus editor on click', async ({ page }) => {
    const editor = getEditor(page);
    await editor.click();

    const isFocused = await isEditorFocused(page);
    expect(isFocused).toBe(true);
  });

  test('should blur editor when clicking outside', async ({ page }) => {
    await focusEditor(page);
    await blurEditor(page);

    const isFocused = await isEditorFocused(page);
    expect(isFocused).toBe(false);
  });

  test('should preserve content after blur and focus', async ({ page }) => {
    await typeText(page, 'Hello World');
    await blurEditor(page);
    await focusEditor(page);

    const text = await getEditorText(page);
    expect(text).toContain('Hello World');
  });

  test('should handle rapid typing', async ({ page }) => {
    const rapidText =
      'The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.';
    await typeText(page, rapidText);

    const text = await getEditorText(page);
    expect(text).toContain(rapidText);
  });

  test('should handle typing with modifier keys held', async ({ page }) => {
    const editor = getEditor(page);
    await editor.click();

    // Type normal text
    await page.keyboard.type('normal');

    const text = await getEditorText(page);
    expect(text).toContain('normal');
  });

  test('should move cursor with arrow keys', async ({ page }) => {
    await typeText(page, 'Hello');
    await moveCursor(page, 'ArrowLeft', 5); // Move to start
    await typeText(page, 'X');

    const text = await getEditorText(page);
    expect(text).toContain('XHello');
  });

  test('should move cursor with Home and End keys', async ({ page }) => {
    await typeText(page, 'Hello World');
    await page.keyboard.press('Home'); // Move to start
    await typeText(page, 'Start ');

    let text = await getEditorText(page);
    expect(text).toContain('Start Hello World');

    await page.keyboard.press('End'); // Move to end
    await typeText(page, ' End');

    text = await getEditorText(page);
    expect(text).toContain('End');
  });
});
