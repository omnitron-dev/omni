/**
 * E2E Tests: Lists
 *
 * Tests list creation and manipulation including bullet lists, ordered lists,
 * task lists, nesting, and list type conversion.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorHTML,
  selectAll,
  pressShortcut,
  clickToolbarButton,
  pressTab,
} from './helpers';

test.describe('Lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should create bullet list', async ({ page }) => {
    await typeText(page, 'Item 1');
    await selectAll(page);
    await clickToolbarButton(page, 'bulletList');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>Item 1<\/li>.*<\/ul>/);
  });

  test('should create ordered list', async ({ page }) => {
    await typeText(page, 'Item 1');
    await selectAll(page);
    await clickToolbarButton(page, 'orderedList');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ol>.*<li>Item 1<\/li>.*<\/ol>/);
  });

  test('should add list item on Enter', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>Item 1<\/li>.*<li>Item 2<\/li>.*<\/ul>/);
  });

  test('should exit list on double Enter', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await pressShortcut(page, 'Enter'); // Exit list
    await typeText(page, 'Paragraph');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>Item 1<\/li>.*<\/ul>/);
    expect(html).toMatch(/<p>Paragraph<\/p>/);
  });

  test('should convert between bullet and ordered list', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');

    // Convert to ordered
    await selectAll(page);
    await clickToolbarButton(page, 'orderedList');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ol>.*<li>Item 1<\/li>.*<\/ol>/);
    expect(html).not.toMatch(/<ul>/);
  });

  test('should convert ordered back to bullet list', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'orderedList');

    await selectAll(page);
    await clickToolbarButton(page, 'bulletList');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>Item 1<\/li>.*<\/ul>/);
    expect(html).not.toMatch(/<ol>/);
  });

  test('should remove list formatting', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');

    await selectAll(page);
    await clickToolbarButton(page, 'bulletList'); // Toggle off

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<p>Item 1<\/p>/);
    expect(html).not.toMatch(/<ul>/);
  });

  test('should indent list item with Tab', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');
    await pressTab(page);

    const html = await getEditorHTML(page);
    // Should have nested list
    expect(html).toMatch(/<ul>.*<ul>.*<\/ul>.*<\/ul>/);
  });

  test('should outdent list item with Shift+Tab', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');
    await pressTab(page); // Indent

    await pressTab(page, true); // Outdent (Shift+Tab)

    const html = await getEditorHTML(page);
    // Should not have nested list anymore
    expect(html).toMatch(/<ul>.*<li>Item 1<\/li>.*<li>Item 2<\/li>.*<\/ul>/);
  });

  test('should create multi-level nested list', async ({ page }) => {
    await typeText(page, 'Level 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Level 2');
    await pressTab(page);
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Level 3');
    await pressTab(page);

    const html = await getEditorHTML(page);
    // Should have three levels of nesting
    expect(html).toMatch(/<ul>.*<ul>.*<ul>.*<\/ul>.*<\/ul>.*<\/ul>/);
  });

  test('should preserve inline formatting in list items', async ({ page }) => {
    await typeText(page, 'Bold item');
    await selectAll(page);
    await pressShortcut(page, 'Mod+b');

    await selectAll(page);
    await clickToolbarButton(page, 'bulletList');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>.*<(strong|b)>Bold item<\/(strong|b)>.*<\/li>.*<\/ul>/);
  });

  test('should split list item on Enter in middle', async ({ page }) => {
    await typeText(page, 'Item text');
    await clickToolbarButton(page, 'bulletList');

    // Move to middle and press Enter
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await pressShortcut(page, 'Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('Item');
    expect(html).toContain('text');
    expect(html).toMatch(/<li>.*<\/li>.*<li>.*<\/li>/);
  });

  test('should merge list items on Backspace', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');

    // Move to start of second item and backspace
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    expect(html).toContain('Item 1Item 2');
  });

  test('should handle empty list items', async ({ page }) => {
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>/);
    expect(html).toContain('Item 2');
  });

  test('should convert multiple paragraphs to list', async ({ page }) => {
    await typeText(page, 'Item 1');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 3');

    await selectAll(page);
    await clickToolbarButton(page, 'bulletList');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>Item 1<\/li>.*<li>Item 2<\/li>.*<li>Item 3<\/li>.*<\/ul>/);
  });

  test('should handle list with long text', async ({ page }) => {
    const longText =
      'This is a very long list item that contains multiple words and should wrap to multiple lines in the editor';
    await typeText(page, longText);
    await clickToolbarButton(page, 'bulletList');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>.*<\/li>.*<\/ul>/);
    expect(html).toContain(longText);
  });

  test('should maintain list numbering in ordered list', async ({ page }) => {
    await typeText(page, 'First');
    await clickToolbarButton(page, 'orderedList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Second');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Third');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ol>.*<li>First<\/li>.*<li>Second<\/li>.*<li>Third<\/li>.*<\/ol>/);
  });

  test('should handle mixed nested lists', async ({ page }) => {
    await typeText(page, 'Bullet 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Ordered 1');
    await pressTab(page);
    await clickToolbarButton(page, 'orderedList');

    const html = await getEditorHTML(page);
    expect(html).toContain('Bullet 1');
    expect(html).toContain('Ordered 1');
    expect(html).toMatch(/<ul>.*<ol>.*<\/ol>.*<\/ul>/);
  });

  test('should navigate list with arrow keys', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');

    await page.keyboard.press('ArrowUp'); // Move to first item
    await page.keyboard.press('End');
    await typeText(page, ' edited');

    const html = await getEditorHTML(page);
    expect(html).toContain('Item 1 edited');
  });

  test('should copy and paste list', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');

    await selectAll(page);
    await pressShortcut(page, 'Mod+c'); // Copy

    await page.keyboard.press('End');
    await pressShortcut(page, 'Enter');
    await pressShortcut(page, 'Enter'); // Exit list

    await pressShortcut(page, 'Mod+v'); // Paste

    const html = await getEditorHTML(page);
    // Should have duplicated list items
    const itemCount = (html.match(/<li>/g) || []).length;
    expect(itemCount).toBeGreaterThanOrEqual(4);
  });

  test('should handle undo/redo in lists', async ({ page }) => {
    await typeText(page, 'Item 1');
    await clickToolbarButton(page, 'bulletList');

    await pressShortcut(page, 'Mod+z'); // Undo list creation

    let html = await getEditorHTML(page);
    expect(html).not.toMatch(/<ul>/);

    await pressShortcut(page, 'Mod+Shift+z'); // Redo

    html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>/);
  });
});
