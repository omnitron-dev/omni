/**
 * E2E Tests: Text Formatting
 *
 * Tests text formatting operations including bold, italic, underline,
 * strikethrough, code, and combinations of formats.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorHTML,
  selectText,
  selectAll,
  clearEditor,
  pressShortcut,
  clickToolbarButton,
  isToolbarButtonActive,
} from './helpers';

test.describe('Text Formatting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  // Bold formatting tests
  test('should make text bold via keyboard shortcut', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5); // Select "Hello"
    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>Hello<\/(strong|b)>/);
  });

  test('should make text bold via toolbar button', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await clickToolbarButton(page, 'bold');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>Hello<\/(strong|b)>/);
  });

  test('should toggle bold off with keyboard shortcut', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b'); // Make bold
    await pressShortcut(page, 'Mod+b'); // Toggle off

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<(strong|b)>Hello<\/(strong|b)>/);
  });

  test('should type bold text when bold is active', async ({ page }) => {
    await pressShortcut(page, 'Mod+b'); // Activate bold
    await typeText(page, 'Bold text');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>Bold text<\/(strong|b)>/);
  });

  // Italic formatting tests
  test('should make text italic via keyboard shortcut', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 6, 11); // Select "World"
    await pressShortcut(page, 'Mod+i');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(em|i)>World<\/(em|i)>/);
  });

  test('should make text italic via toolbar button', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 6, 11);
    await clickToolbarButton(page, 'italic');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(em|i)>World<\/(em|i)>/);
  });

  test('should toggle italic off', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 6, 11);
    await pressShortcut(page, 'Mod+i');
    await pressShortcut(page, 'Mod+i');

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<(em|i)>World<\/(em|i)>/);
  });

  test('should type italic text when italic is active', async ({ page }) => {
    await pressShortcut(page, 'Mod+i');
    await typeText(page, 'Italic text');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(em|i)>Italic text<\/(em|i)>/);
  });

  // Underline formatting tests
  test('should make text underlined via keyboard shortcut', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+u');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<u>Hello<\/u>/);
  });

  test('should make text underlined via toolbar button', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await clickToolbarButton(page, 'underline');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<u>Hello<\/u>/);
  });

  test('should toggle underline off', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+u');
    await pressShortcut(page, 'Mod+u');

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<u>Hello<\/u>/);
  });

  // Strikethrough formatting tests
  test('should make text strikethrough via toolbar button', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await clickToolbarButton(page, 'strike');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<s>Hello<\/s>/);
  });

  test('should toggle strikethrough off', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await clickToolbarButton(page, 'strike');
    await clickToolbarButton(page, 'strike');

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<s>Hello<\/s>/);
  });

  // Code formatting tests
  test('should make text code via toolbar button', async ({ page }) => {
    await typeText(page, 'const x = 1');
    await selectText(page, 0, 11);
    await clickToolbarButton(page, 'code');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<code>const x = 1<\/code>/);
  });

  test('should toggle code off', async ({ page }) => {
    await typeText(page, 'const x = 1');
    await selectText(page, 0, 11);
    await clickToolbarButton(page, 'code');
    await clickToolbarButton(page, 'code');

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<code>const x = 1<\/code>/);
  });

  // Combined formatting tests
  test('should apply bold and italic together', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+i');

    const html = await getEditorHTML(page);
    expect(html).toContain('Hello');
    // Should have both bold and italic tags
    expect(html).toMatch(/<(strong|b)>.*<(em|i)>|<(em|i)>.*<(strong|b)>/);
  });

  test('should apply bold, italic, and underline together', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+i');
    await pressShortcut(page, 'Mod+u');

    const html = await getEditorHTML(page);
    expect(html).toContain('Hello');
    // Should have all three formatting tags
    const hasBold = html.match(/<(strong|b)>/);
    const hasItalic = html.match(/<(em|i)>/);
    const hasUnderline = html.match(/<u>/);
    expect(hasBold && hasItalic && hasUnderline).toBeTruthy();
  });

  test('should remove only bold from multi-formatted text', async ({ page }) => {
    await typeText(page, 'Hello');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+i');

    // Remove bold
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<(strong|b)>/);
    expect(html).toMatch(/<(em|i)>/); // Italic should remain
  });

  test('should format partial text selection', async ({ page }) => {
    await typeText(page, 'Hello World');
    await selectText(page, 2, 8); // Select "llo Wo"
    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).toContain('He'); // Not formatted
    expect(html).toContain('rld'); // Not formatted
  });

  test('should format across multiple paragraphs', async ({ page }) => {
    await typeText(page, 'Line 1');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Line 2');

    await selectAll(page);
    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>.*Line 1.*<\/(strong|b)>/);
    expect(html).toMatch(/<(strong|b)>.*Line 2.*<\/(strong|b)>/);
  });

  test('should clear all formatting', async ({ page }) => {
    await typeText(page, 'Formatted');
    await selectAll(page);
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+i');
    await pressShortcut(page, 'Mod+u');

    // Clear all formatting (implementation-specific)
    await selectAll(page);
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+i');
    await pressShortcut(page, 'Mod+u');

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<(strong|b|em|i|u)>/);
  });

  test('should preserve formatting when typing adjacent', async ({ page }) => {
    await typeText(page, 'Hello');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b');

    // Move to end and type
    await page.keyboard.press('ArrowRight');
    await typeText(page, ' World');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>Hello<\/(strong|b)>/);
    // "World" should not be bold
    expect(html).toContain('World');
  });

  test('should extend formatting when typing inside formatted text', async ({ page }) => {
    await typeText(page, 'Hello');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b');

    // Move cursor inside and type
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await typeText(page, 'X');

    const html = await getEditorHTML(page);
    expect(html).toContain('HelXlo');
    // X should also be bold
    expect(html).toMatch(/<(strong|b)>.*X.*<\/(strong|b)>/);
  });

  test('should handle formatting with empty selection', async ({ page }) => {
    await typeText(page, 'Hello World');
    // Don't select anything, just set cursor position
    await page.keyboard.press('End');
    await pressShortcut(page, 'Mod+b');

    // Type more text
    await typeText(page, ' Bold');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>Bold<\/(strong|b)>/);
  });

  test('should show toolbar button as active when format is applied', async ({ page }) => {
    await typeText(page, 'Hello');
    await selectText(page, 0, 5);
    await clickToolbarButton(page, 'bold');

    const isActive = await isToolbarButtonActive(page, 'bold');
    expect(isActive).toBe(true);
  });

  test('should deactivate toolbar button when format is removed', async ({ page }) => {
    await typeText(page, 'Hello');
    await selectText(page, 0, 5);
    await clickToolbarButton(page, 'bold');
    await clickToolbarButton(page, 'bold'); // Toggle off

    const isActive = await isToolbarButtonActive(page, 'bold');
    expect(isActive).toBe(false);
  });

  test('should handle rapid format toggling', async ({ page }) => {
    await typeText(page, 'Hello');
    await selectText(page, 0, 5);

    // Rapidly toggle bold
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+b');

    // Should end up bold (odd number of toggles)
    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>Hello<\/(strong|b)>/);
  });

  test('should preserve formatting after undo/redo', async ({ page }) => {
    await typeText(page, 'Hello');
    await selectText(page, 0, 5);
    await pressShortcut(page, 'Mod+b');

    await pressShortcut(page, 'Mod+z'); // Undo
    let html = await getEditorHTML(page);
    expect(html).not.toMatch(/<(strong|b)>/);

    await pressShortcut(page, 'Mod+Shift+z'); // Redo
    html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>/);
  });

  test('should format text with different writing systems', async ({ page }) => {
    await typeText(page, 'Hello 你好');
    await selectAll(page);
    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).toContain('Hello');
    expect(html).toContain('你好');
    expect(html).toMatch(/<(strong|b)>/);
  });

  test('should format emoji text', async ({ page }) => {
    await typeText(page, 'Hello 👋 World 🌍');
    await selectAll(page);
    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).toContain('👋');
    expect(html).toContain('🌍');
    expect(html).toMatch(/<(strong|b)>/);
  });

  test('should handle formatting at word boundaries', async ({ page }) => {
    await typeText(page, 'Hello World');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight', { delay: 10 }); // Select first char
    await page.keyboard.press('Shift+ArrowRight', { delay: 10 });
    await page.keyboard.press('Shift+ArrowRight', { delay: 10 });
    await page.keyboard.press('Shift+ArrowRight', { delay: 10 });
    await page.keyboard.press('Shift+ArrowRight', { delay: 10 }); // "Hello" selected

    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>Hello<\/(strong|b)>/);
  });
});
