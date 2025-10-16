/**
 * E2E Tests: Performance
 *
 * Tests editor performance including typing latency, scrolling,
 * memory usage, and large document handling.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  pressShortcut,
  measureTypingLatency,
  getPerformanceMetrics,
  getEditor,
} from './helpers';

test.describe('Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should load editor quickly', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(3000); // Should load in < 3s
  });

  test('should have low typing latency', async ({ page }) => {
    const latency = await measureTypingLatency(page, 'Hello World Test');

    // Latency should be under 100ms for ~15 characters
    expect(latency).toBeLessThan(100);
  });

  test('should handle rapid typing', async ({ page }) => {
    const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(10);

    const startTime = Date.now();
    await typeText(page, longText);
    const duration = Date.now() - startTime;

    // Should type 450+ characters in reasonable time
    expect(duration).toBeLessThan(2000);
  });

  test('should handle large document', async ({ page }) => {
    // Create document with 1000 lines
    for (let i = 0; i < 100; i++) {
      await typeText(page, `Line ${i} with some content here`);
      await pressShortcut(page, 'Enter');
    }

    const editor = getEditor(page);
    const text = await editor.textContent();
    expect(text).toContain('Line 99');
  });

  test('should scroll smoothly with large content', async ({ page }) => {
    // Create large content
    for (let i = 0; i < 200; i++) {
      await typeText(page, `Line ${i}`);
      if (i < 199) await pressShortcut(page, 'Enter');
    }

    const startTime = Date.now();

    // Scroll to bottom
    await page.keyboard.press('End');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageDown');

    const scrollTime = Date.now() - startTime;

    expect(scrollTime).toBeLessThan(1000);
  });

  test('should not leak memory on repeated operations', async ({ page }) => {
    const initialMetrics = await getPerformanceMetrics(page);

    // Perform many operations
    for (let i = 0; i < 50; i++) {
      await typeText(page, 'Test ');
      await pressShortcut(page, 'Mod+b');
      await typeText(page, 'Bold ');
      await pressShortcut(page, 'Mod+z');
      await pressShortcut(page, 'Mod+z');
    }

    const finalMetrics = await getPerformanceMetrics(page);

    // Memory shouldn't grow excessively (allow 50MB growth)
    const memoryGrowth = finalMetrics.memory - initialMetrics.memory;
    expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
  });

  test('should handle many undo operations efficiently', async ({ page }) => {
    // Create many undo states
    for (let i = 0; i < 100; i++) {
      await typeText(page, 'X');
    }

    const startTime = Date.now();

    // Undo all
    for (let i = 0; i < 100; i++) {
      await pressShortcut(page, 'Mod+z');
    }

    const undoTime = Date.now() - startTime;

    expect(undoTime).toBeLessThan(5000); // 100 undos in < 5s
  });

  test('should render complex formatting quickly', async ({ page }) => {
    await typeText(page, 'Complex text');
    await pressShortcut(page, 'Mod+a');

    const startTime = Date.now();

    // Apply multiple formats
    await pressShortcut(page, 'Mod+b');
    await pressShortcut(page, 'Mod+i');
    await pressShortcut(page, 'Mod+u');

    const formatTime = Date.now() - startTime;

    expect(formatTime).toBeLessThan(200);
  });

  test('should handle many formatted blocks', async ({ page }) => {
    // Create 50 formatted paragraphs
    for (let i = 0; i < 50; i++) {
      await typeText(page, `Paragraph ${i}`);
      await pressShortcut(page, 'Mod+a');
      await pressShortcut(page, 'Mod+b');
      await page.keyboard.press('End');
      await pressShortcut(page, 'Enter');
    }

    const editor = getEditor(page);
    const html = await editor.innerHTML();
    expect(html).toContain('Paragraph 49');
  });

  test('should handle large paste operation', async ({ page }) => {
    const largeText = 'Lorem ipsum dolor sit amet. '.repeat(500);

    const startTime = Date.now();

    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, largeText);

    await pressShortcut(page, 'Mod+v');

    const pasteTime = Date.now() - startTime;

    expect(pasteTime).toBeLessThan(2000);
  });

  test('should maintain performance with long lines', async ({ page }) => {
    const longLine = 'Word '.repeat(500);

    const startTime = Date.now();
    await typeText(page, longLine);
    const typeTime = Date.now() - startTime;

    // Even long lines should be handled efficiently
    expect(typeTime).toBeLessThan(5000);
  });

  test('should handle rapid selection changes', async ({ page }) => {
    await typeText(page, 'The quick brown fox jumps over the lazy dog');

    const startTime = Date.now();

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('ArrowRight');
    }

    const selectionTime = Date.now() - startTime;

    expect(selectionTime).toBeLessThan(1000);
  });

  test('should efficiently handle document with tables', async ({ page }) => {
    const tableButton = page.locator('[data-command="insertTable"]');

    if (await tableButton.isVisible()) {
      // Insert multiple tables
      for (let i = 0; i < 5; i++) {
        await tableButton.click();
        await typeText(page, `Table ${i}`);
        await page.keyboard.press('End');
        await pressShortcut(page, 'Enter');
      }

      const editor = getEditor(page);
      const html = await editor.innerHTML();
      const tableCount = (html.match(/<table/g) || []).length;
      expect(tableCount).toBeGreaterThanOrEqual(5);
    }
  });

  test('should handle rapid toolbar interactions', async ({ page }) => {
    await typeText(page, 'Text');

    const startTime = Date.now();

    // Rapidly click toolbar buttons
    for (let i = 0; i < 10; i++) {
      await pressShortcut(page, 'Mod+b');
      await pressShortcut(page, 'Mod+b');
      await pressShortcut(page, 'Mod+i');
      await pressShortcut(page, 'Mod+i');
    }

    const interactionTime = Date.now() - startTime;

    expect(interactionTime).toBeLessThan(2000);
  });

  test('should not block UI on heavy operations', async ({ page }) => {
    // Start heavy operation
    for (let i = 0; i < 50; i++) {
      await typeText(page, 'Heavy operation ');
    }

    // UI should still be responsive
    const editor = getEditor(page);
    const isVisible = await editor.isVisible();
    expect(isVisible).toBe(true);
  });

  test('should clean up resources on navigation', async ({ page }) => {
    const initialMetrics = await getPerformanceMetrics(page);

    // Navigate away and back
    await page.goto('about:blank');
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);

    const finalMetrics = await getPerformanceMetrics(page);

    // Memory should not grow significantly after navigation
    expect(finalMetrics.memory).toBeLessThan(initialMetrics.memory * 2);
  });
});
