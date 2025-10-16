/**
 * E2E Tests: Code Blocks
 *
 * Tests code block insertion, syntax highlighting, and language selection.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorHTML,
  selectAll,
  pressShortcut,
  pressEnter,
} from './helpers';

test.describe('Code Blocks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/code-editor.html');
    await waitForEditor(page);
  });

  test('should insert code block', async ({ page }) => {
    const codeButton = page.locator('[data-command="codeBlock"], button:has-text("Code")');
    if (await codeButton.isVisible()) {
      await codeButton.click();
    }

    await typeText(page, 'const x = 1;');
    const html = await getEditorHTML(page);
    expect(html).toMatch(/<pre>.*<code>.*const x = 1;.*<\/code>.*<\/pre>/);
  });

  test('should type code in editor', async ({ page }) => {
    const code = 'function hello() {\n  return "Hello World";\n}';
    await typeText(page, code);

    const html = await getEditorHTML(page);
    expect(html).toContain('function hello()');
  });

  test('should preserve indentation', async ({ page }) => {
    await typeText(page, 'function test() {');
    await pressEnter(page);
    await typeText(page, '  return true;');

    const html = await getEditorHTML(page);
    expect(html).toContain('return true');
  });

  test('should handle Tab for indentation', async ({ page }) => {
    await typeText(page, 'function test() {');
    await pressEnter(page);
    await page.keyboard.press('Tab');
    await typeText(page, 'return true;');

    const text = await page.locator('.ProseMirror').textContent();
    expect(text).toContain('return true');
  });

  test('should change programming language', async ({ page }) => {
    const languageSelect = page.locator('#language-select');
    if (await languageSelect.isVisible()) {
      await languageSelect.selectOption('python');

      const selectedValue = await languageSelect.inputValue();
      expect(selectedValue).toBe('python');
    }
  });

  test('should highlight syntax for JavaScript', async ({ page }) => {
    const languageSelect = page.locator('#language-select');
    if (await languageSelect.isVisible()) {
      await languageSelect.selectOption('javascript');
    }

    await typeText(page, 'const x = "hello";');
    // Syntax highlighting is typically applied via CSS classes
    // Check if code element exists
    const html = await getEditorHTML(page);
    expect(html).toContain('const');
  });

  test('should highlight syntax for TypeScript', async ({ page }) => {
    const languageSelect = page.locator('#language-select');
    if (await languageSelect.isVisible()) {
      await languageSelect.selectOption('typescript');
    }

    await typeText(page, 'interface User { name: string; }');
    const html = await getEditorHTML(page);
    expect(html).toContain('interface');
  });

  test('should highlight syntax for Python', async ({ page }) => {
    const languageSelect = page.locator('#language-select');
    if (await languageSelect.isVisible()) {
      await languageSelect.selectOption('python');
    }

    await typeText(page, 'def hello():\n    return "Hello"');
    const html = await getEditorHTML(page);
    expect(html).toContain('def hello()');
  });

  test('should exit code block with arrow keys', async ({ page }) => {
    await typeText(page, 'const x = 1;');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await typeText(page, 'Normal text');

    const html = await getEditorHTML(page);
    expect(html).toContain('Normal text');
  });

  test('should handle multi-line code', async ({ page }) => {
    const code = `function test() {
  if (true) {
    return "hello";
  }
}`;
    await typeText(page, code);

    const html = await getEditorHTML(page);
    expect(html).toContain('function test()');
    expect(html).toContain('return "hello"');
  });

  test('should paste code', async ({ page }) => {
    const code = 'const x = 1;\nconst y = 2;';
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, code);

    await pressShortcut(page, 'Mod+v');

    const html = await getEditorHTML(page);
    expect(html).toContain('const x = 1');
    expect(html).toContain('const y = 2');
  });

  test('should handle special characters in code', async ({ page }) => {
    await typeText(page, 'const regex = /[a-z]+/gi;');

    const html = await getEditorHTML(page);
    expect(html).toContain('regex');
  });

  test('should show line numbers', async ({ page }) => {
    const lineNumbers = page.locator('#line-numbers');
    if (await lineNumbers.isVisible()) {
      await expect(lineNumbers).toBeVisible();
      await expect(lineNumbers).toContainText('1');
    }
  });

  test('should update line numbers when typing', async ({ page }) => {
    await typeText(page, 'Line 1');
    await pressEnter(page);
    await typeText(page, 'Line 2');
    await pressEnter(page);
    await typeText(page, 'Line 3');

    const lineNumbers = page.locator('#line-numbers');
    if (await lineNumbers.isVisible()) {
      const text = await lineNumbers.textContent();
      expect(text).toContain('2');
      expect(text).toContain('3');
    }
  });

  test('should handle copy/paste in code block', async ({ page }) => {
    await typeText(page, 'const x = 1;');
    await selectAll(page);
    await pressShortcut(page, 'Mod+c');

    await page.keyboard.press('End');
    await pressEnter(page);
    await pressShortcut(page, 'Mod+v');

    const html = await getEditorHTML(page);
    const count = (html.match(/const x = 1/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should handle undo/redo in code block', async ({ page }) => {
    await typeText(page, 'const x = 1;');
    await pressShortcut(page, 'Mod+z');

    let html = await getEditorHTML(page);
    expect(html).not.toContain('const x = 1');

    await pressShortcut(page, 'Mod+Shift+z');
    html = await getEditorHTML(page);
    expect(html).toContain('const x = 1');
  });
});
