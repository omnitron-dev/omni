/**
 * E2E Tests: Block Formatting
 *
 * Tests block-level formatting including headings, paragraphs, blockquotes,
 * and horizontal rules.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorHTML,
  selectAll,
  clearEditor,
  pressShortcut,
  clickToolbarButton,
} from './helpers';

test.describe('Block Formatting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should convert paragraph to heading 1', async ({ page }) => {
    await typeText(page, 'Heading Text');
    await selectAll(page);
    await clickToolbarButton(page, 'heading1');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Heading Text<\/h1>/);
  });

  test('should convert paragraph to heading 2', async ({ page }) => {
    await typeText(page, 'Heading Text');
    await selectAll(page);
    await clickToolbarButton(page, 'heading2');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h2>Heading Text<\/h2>/);
  });

  test('should convert paragraph to heading 3', async ({ page }) => {
    await typeText(page, 'Heading Text');
    await selectAll(page);
    await clickToolbarButton(page, 'heading3');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h3>Heading Text<\/h3>/);
  });

  test('should convert heading back to paragraph', async ({ page }) => {
    await typeText(page, 'Text');
    await selectAll(page);
    await clickToolbarButton(page, 'heading1');

    // Convert back
    await selectAll(page);
    await clickToolbarButton(page, 'paragraph');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<p>Text<\/p>/);
    expect(html).not.toMatch(/<h1>/);
  });

  test('should convert between different heading levels', async ({ page }) => {
    await typeText(page, 'Heading');
    await selectAll(page);
    await clickToolbarButton(page, 'heading1');

    // Convert to H2
    await selectAll(page);
    await clickToolbarButton(page, 'heading2');

    let html = await getEditorHTML(page);
    expect(html).toMatch(/<h2>Heading<\/h2>/);
    expect(html).not.toMatch(/<h1>/);

    // Convert to H3
    await selectAll(page);
    await clickToolbarButton(page, 'heading3');

    html = await getEditorHTML(page);
    expect(html).toMatch(/<h3>Heading<\/h3>/);
    expect(html).not.toMatch(/<h2>/);
  });

  test('should create blockquote', async ({ page }) => {
    await typeText(page, 'Quote text');
    await selectAll(page);
    await clickToolbarButton(page, 'blockquote');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<blockquote>.*Quote text.*<\/blockquote>/);
  });

  test('should convert blockquote back to paragraph', async ({ page }) => {
    await typeText(page, 'Quote');
    await selectAll(page);
    await clickToolbarButton(page, 'blockquote');

    // Convert back
    await selectAll(page);
    await clickToolbarButton(page, 'paragraph');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<p>Quote<\/p>/);
    expect(html).not.toMatch(/<blockquote>/);
  });

  test('should preserve inline formatting in headings', async ({ page }) => {
    await typeText(page, 'Bold Heading');
    await selectAll(page);
    await pressShortcut(page, 'Mod+b'); // Make bold

    await selectAll(page);
    await clickToolbarButton(page, 'heading1');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>.*<(strong|b)>Bold Heading<\/(strong|b)>.*<\/h1>/);
  });

  test('should preserve inline formatting in blockquotes', async ({ page }) => {
    await typeText(page, 'Italic Quote');
    await selectAll(page);
    await pressShortcut(page, 'Mod+i'); // Make italic

    await selectAll(page);
    await clickToolbarButton(page, 'blockquote');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<blockquote>.*<(em|i)>Italic Quote<\/(em|i)>.*<\/blockquote>/);
  });

  test('should handle multi-line blockquote', async ({ page }) => {
    await typeText(page, 'Line 1');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Line 2');

    await selectAll(page);
    await clickToolbarButton(page, 'blockquote');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<blockquote>/);
    expect(html).toContain('Line 1');
    expect(html).toContain('Line 2');
  });

  test('should convert only selected paragraph to heading', async ({ page }) => {
    await typeText(page, 'Paragraph 1');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Paragraph 2');

    // Select first paragraph
    await page.keyboard.press('Home');
    await clickToolbarButton(page, 'heading1');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Paragraph 1<\/h1>/);
    expect(html).toMatch(/<p>Paragraph 2<\/p>/); // Should remain paragraph
  });

  test('should handle cursor at start of block', async ({ page }) => {
    await typeText(page, 'Text');
    await page.keyboard.press('Home');
    await clickToolbarButton(page, 'heading1');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Text<\/h1>/);
  });

  test('should handle cursor at end of block', async ({ page }) => {
    await typeText(page, 'Text');
    await page.keyboard.press('End');
    await clickToolbarButton(page, 'heading1');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Text<\/h1>/);
  });

  test('should handle cursor in middle of block', async ({ page }) => {
    await typeText(page, 'Text');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await clickToolbarButton(page, 'heading1');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Text<\/h1>/);
  });

  test('should maintain block format when typing', async ({ page }) => {
    await typeText(page, 'Heading');
    await selectAll(page);
    await clickToolbarButton(page, 'heading1');

    await page.keyboard.press('End');
    await typeText(page, ' More');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Heading More<\/h1>/);
  });

  test('should create new paragraph after heading on Enter', async ({ page }) => {
    await typeText(page, 'Heading');
    await selectAll(page);
    await clickToolbarButton(page, 'heading1');

    await page.keyboard.press('End');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Paragraph');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Heading<\/h1>/);
    expect(html).toMatch(/<p>Paragraph<\/p>/);
  });

  test('should handle empty heading', async ({ page }) => {
    await clickToolbarButton(page, 'heading1');
    await typeText(page, 'Text');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Text<\/h1>/);
  });

  test('should handle empty blockquote', async ({ page }) => {
    await clickToolbarButton(page, 'blockquote');
    await typeText(page, 'Quote');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<blockquote>.*Quote.*<\/blockquote>/);
  });
});
