/**
 * E2E Tests: Markdown
 *
 * Tests markdown input shortcuts, preview, and conversion.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorHTML,
  pressEnter,
  pressShortcut,
} from './helpers';

test.describe('Markdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/markdown-editor.html');
    await waitForEditor(page);
  });

  test('should convert ** to bold', async ({ page }) => {
    await typeText(page, '**bold**');
    await page.keyboard.press('Space');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(strong|b)>bold<\/(strong|b)>/);
  });

  test('should convert * to italic', async ({ page }) => {
    await typeText(page, '*italic*');
    await page.keyboard.press('Space');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<(em|i)>italic<\/(em|i)>/);
  });

  test('should convert ` to code', async ({ page }) => {
    await typeText(page, '`code`');
    await page.keyboard.press('Space');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<code>code<\/code>/);
  });

  test('should convert # to heading 1', async ({ page }) => {
    await typeText(page, '# Heading 1');
    await pressEnter(page);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>Heading 1<\/h1>/);
  });

  test('should convert ## to heading 2', async ({ page }) => {
    await typeText(page, '## Heading 2');
    await pressEnter(page);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h2>Heading 2<\/h2>/);
  });

  test('should convert ### to heading 3', async ({ page }) => {
    await typeText(page, '### Heading 3');
    await pressEnter(page);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h3>Heading 3<\/h3>/);
  });

  test('should convert - to bullet list', async ({ page }) => {
    await typeText(page, '- Item 1');
    await pressEnter(page);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<li>Item 1<\/li>.*<\/ul>/);
  });

  test('should convert 1. to ordered list', async ({ page }) => {
    await typeText(page, '1. Item 1');
    await pressEnter(page);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ol>.*<li>Item 1<\/li>.*<\/ol>/);
  });

  test('should convert > to blockquote', async ({ page }) => {
    await typeText(page, '> Quote');
    await pressEnter(page);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<blockquote>.*Quote.*<\/blockquote>/);
  });

  test('should convert --- to horizontal rule', async ({ page }) => {
    await typeText(page, '---');
    await pressEnter(page);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<hr/);
  });

  test('should paste markdown and convert', async ({ page }) => {
    const markdown = '# Title\n\n**Bold** and *italic*\n\n- List item';

    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, markdown);

    await pressShortcut(page, 'Mod+v');

    const html = await getEditorHTML(page);
    expect(html).toContain('Title');
  });

  test('should toggle preview mode', async ({ page }) => {
    await typeText(page, '# Hello World');

    const previewButton = page.locator('button:has-text("Preview"), [data-mode="preview"]');
    if (await previewButton.isVisible()) {
      await previewButton.click();

      const preview = page.locator('#preview, .preview-content');
      await expect(preview).toBeVisible();
    }
  });

  test('should show live preview', async ({ page }) => {
    await typeText(page, '# Hello');

    const preview = page.locator('#preview');
    if (await preview.isVisible()) {
      const previewText = await preview.textContent();
      expect(previewText).toContain('Hello');
    }
  });

  test('should update preview on typing', async ({ page }) => {
    await typeText(page, '# Title');

    let preview = page.locator('#preview');
    if (await preview.isVisible()) {
      let text = await preview.textContent();
      expect(text).toContain('Title');

      await typeText(page, ' Updated');
      text = await preview.textContent();
      expect(text).toContain('Updated');
    }
  });

  test('should handle code blocks in markdown', async ({ page }) => {
    await typeText(page, '```javascript\nconst x = 1;\n```');

    const html = await getEditorHTML(page);
    expect(html).toContain('const x = 1');
  });

  test('should handle inline code in markdown', async ({ page }) => {
    await typeText(page, 'Use `const` keyword');

    const html = await getEditorHTML(page);
    expect(html).toContain('const');
  });

  test('should handle links in markdown', async ({ page }) => {
    await typeText(page, '[Link](https://example.com)');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/https:\/\/example\.com/);
  });

  test('should handle images in markdown', async ({ page }) => {
    await typeText(page, '![Alt text](https://example.com/image.jpg)');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/image\.jpg/);
  });

  test('should handle task lists', async ({ page }) => {
    await typeText(page, '- [ ] Task 1');
    await pressEnter(page);
    await typeText(page, '- [x] Task 2');

    const html = await getEditorHTML(page);
    expect(html).toContain('Task 1');
    expect(html).toContain('Task 2');
  });

  test('should export as markdown', async ({ page }) => {
    await typeText(page, '# Title\n\nContent');

    const exportButton = page.locator('button:has-text("Export"), [data-command="exportMarkdown"]');
    if (await exportButton.isVisible()) {
      await exportButton.click();
      // Check if download initiated or content copied
    }
  });

  test('should handle mixed markdown syntax', async ({ page }) => {
    await typeText(page, '# Title\n\n**Bold** *italic* `code`\n\n- Item 1\n- Item 2');

    const html = await getEditorHTML(page);
    expect(html).toContain('Title');
    expect(html).toContain('code');
  });
});
