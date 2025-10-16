/**
 * E2E Test Helpers for Advanced Editor
 *
 * Utility functions for interacting with the editor in E2E tests
 */

import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Wait for editor to be ready
 */
export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForEvent('editor-ready', { timeout: 5000 });
  await page.waitForSelector('.ProseMirror', { state: 'visible' });
}

/**
 * Get the editor element
 */
export function getEditor(page: Page): Locator {
  return page.locator('.ProseMirror');
}

/**
 * Type text in the editor
 */
export async function typeText(page: Page, text: string): Promise<void> {
  const editor = getEditor(page);
  await editor.click();
  await editor.type(text);
}

/**
 * Get editor HTML content
 */
export async function getEditorHTML(page: Page): Promise<string> {
  const editor = getEditor(page);
  return await editor.innerHTML();
}

/**
 * Get editor text content
 */
export async function getEditorText(page: Page): Promise<string> {
  const editor = getEditor(page);
  const text = await editor.textContent();
  return text || '';
}

/**
 * Select text by typing selection commands
 */
export async function selectText(page: Page, from: number, to: number): Promise<void> {
  const editor = getEditor(page);
  await editor.click();

  // Move to start position
  await page.keyboard.press('Home');
  for (let i = 0; i < from; i++) {
    await page.keyboard.press('ArrowRight');
  }

  // Select to end position
  const selectCount = to - from;
  for (let i = 0; i < selectCount; i++) {
    await page.keyboard.press('Shift+ArrowRight');
  }
}

/**
 * Select all text in editor
 */
export async function selectAll(page: Page): Promise<void> {
  const editor = getEditor(page);
  await editor.click();
  await pressShortcut(page, 'Mod+a');
}

/**
 * Press a keyboard shortcut (Mod is Cmd on Mac, Ctrl on others)
 */
export async function pressShortcut(page: Page, shortcut: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  const normalizedShortcut = shortcut.replace('Mod', isMac ? 'Meta' : 'Control');
  await page.keyboard.press(normalizedShortcut);
}

/**
 * Click a toolbar button by its data-command attribute
 */
export async function clickToolbarButton(page: Page, command: string): Promise<void> {
  const button = page.locator(`[data-command="${command}"]`);
  await button.click();
}

/**
 * Check if a toolbar button is active
 */
export async function isToolbarButtonActive(page: Page, command: string): Promise<boolean> {
  const button = page.locator(`[data-command="${command}"]`);
  const className = await button.getAttribute('class');
  return className?.includes('active') || false;
}

/**
 * Clear editor content
 */
export async function clearEditor(page: Page): Promise<void> {
  await selectAll(page);
  await page.keyboard.press('Backspace');
}

/**
 * Insert text at cursor position
 */
export async function insertText(page: Page, text: string): Promise<void> {
  await page.keyboard.insertText(text);
}

/**
 * Delete text (press backspace n times)
 */
export async function deleteText(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Backspace');
  }
}

/**
 * Move cursor with arrow keys
 */
export async function moveCursor(
  page: Page,
  direction: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  count: number = 1
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(direction);
  }
}

/**
 * Undo last action
 */
export async function undo(page: Page): Promise<void> {
  await pressShortcut(page, 'Mod+z');
}

/**
 * Redo last undone action
 */
export async function redo(page: Page): Promise<void> {
  const isMac = process.platform === 'darwin';
  await pressShortcut(page, isMac ? 'Mod+Shift+z' : 'Mod+y');
}

/**
 * Copy selected text
 */
export async function copy(page: Page): Promise<void> {
  await pressShortcut(page, 'Mod+c');
}

/**
 * Cut selected text
 */
export async function cut(page: Page): Promise<void> {
  await pressShortcut(page, 'Mod+x');
}

/**
 * Paste text
 */
export async function paste(page: Page): Promise<void> {
  await pressShortcut(page, 'Mod+v');
}

/**
 * Paste text from clipboard (set clipboard first)
 */
export async function pasteFromClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, text);
  await paste(page);
}

/**
 * Check if element contains specific HTML
 */
export async function expectHTML(page: Page, expectedHTML: string): Promise<void> {
  const html = await getEditorHTML(page);
  expect(html).toContain(expectedHTML);
}

/**
 * Check if element contains specific text
 */
export async function expectText(page: Page, expectedText: string): Promise<void> {
  const text = await getEditorText(page);
  expect(text).toContain(expectedText);
}

/**
 * Get current selection
 */
export async function getSelection(page: Page): Promise<{
  text: string;
  html: string;
}> {
  return await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { text: '', html: '' };
    }

    const range = selection.getRangeAt(0);
    const text = range.toString();

    const div = document.createElement('div');
    div.appendChild(range.cloneContents());
    const html = div.innerHTML;

    return { text, html };
  });
}

/**
 * Focus the editor
 */
export async function focusEditor(page: Page): Promise<void> {
  const editor = getEditor(page);
  await editor.focus();
}

/**
 * Blur the editor (remove focus)
 */
export async function blurEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror') as HTMLElement;
    if (editor) {
      editor.blur();
    }
  });
}

/**
 * Check if editor is focused
 */
export async function isEditorFocused(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror');
    return document.activeElement === editor;
  });
}

/**
 * Wait for specific HTML to appear in editor
 */
export async function waitForHTML(page: Page, expectedHTML: string, timeout: number = 3000): Promise<void> {
  await page.waitForFunction(
    (html) => {
      const editor = document.querySelector('.ProseMirror');
      return editor?.innerHTML.includes(html);
    },
    expectedHTML,
    { timeout }
  );
}

/**
 * Get all paragraph texts
 */
export async function getParagraphs(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const paragraphs = document.querySelectorAll('.ProseMirror p');
    return Array.from(paragraphs).map((p) => p.textContent || '');
  });
}

/**
 * Click at specific coordinates in editor
 */
export async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const editor = getEditor(page);
  const box = await editor.boundingBox();
  if (!box) throw new Error('Editor not found');

  await page.mouse.click(box.x + x, box.y + y);
}

/**
 * Double click to select word
 */
export async function doubleClick(page: Page): Promise<void> {
  const editor = getEditor(page);
  await editor.dblclick();
}

/**
 * Triple click to select paragraph
 */
export async function tripleClick(page: Page): Promise<void> {
  const editor = getEditor(page);
  await editor.click({ clickCount: 3 });
}

/**
 * Drag and drop file into editor
 */
export async function dropFile(page: Page, filePath: string, mimeType: string): Promise<void> {
  const editor = getEditor(page);
  const box = await editor.boundingBox();
  if (!box) throw new Error('Editor not found');

  const buffer = await page.evaluate(async (path) => {
    const response = await fetch(path);
    const arrayBuffer = await response.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, filePath);

  const dataTransfer = await page.evaluateHandle(
    ({ buffer, mimeType }) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(buffer)], 'test-file', {
        type: mimeType,
      });
      dt.items.add(file);
      return dt;
    },
    { buffer, mimeType }
  );

  await editor.dispatchEvent('drop', { dataTransfer });
}

/**
 * Take screenshot of editor
 */
export async function screenshotEditor(page: Page, path?: string): Promise<Buffer> {
  const editor = getEditor(page);
  return await editor.screenshot({ path });
}

/**
 * Check element accessibility
 */
export async function checkA11y(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector);

  // Check for ARIA attributes
  const role = await element.getAttribute('role');
  const ariaLabel = await element.getAttribute('aria-label');

  expect(role || ariaLabel).toBeTruthy();
}

/**
 * Wait for specific element to be visible
 */
export async function waitForVisible(page: Page, selector: string, timeout: number = 3000): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

/**
 * Wait for specific element to be hidden
 */
export async function waitForHidden(page: Page, selector: string, timeout: number = 3000): Promise<void> {
  await page.waitForSelector(selector, { state: 'hidden', timeout });
}

/**
 * Press Tab key
 */
export async function pressTab(page: Page, shift: boolean = false): Promise<void> {
  await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
}

/**
 * Press Enter key
 */
export async function pressEnter(page: Page, shift: boolean = false): Promise<void> {
  await page.keyboard.press(shift ? 'Shift+Enter' : 'Enter');
}

/**
 * Press Escape key
 */
export async function pressEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/**
 * Measure typing latency
 */
export async function measureTypingLatency(page: Page, text: string): Promise<number> {
  const editor = getEditor(page);
  await editor.click();

  const startTime = Date.now();
  await page.keyboard.type(text);
  const endTime = Date.now();

  return endTime - startTime;
}

/**
 * Get editor performance metrics
 */
export async function getPerformanceMetrics(page: Page): Promise<{
  memory: number;
  duration: number;
}> {
  return await page.evaluate(() => {
    const memory = (performance as any).memory ? (performance as any).memory.usedJSHeapSize : 0;
    const duration = performance.now();
    return { memory, duration };
  });
}
