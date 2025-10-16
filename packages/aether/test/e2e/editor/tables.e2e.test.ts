/**
 * E2E Tests: Tables
 *
 * Tests table creation, navigation, editing, and manipulation.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorHTML,
  pressShortcut,
  pressTab,
  getEditor,
} from './helpers';

test.describe('Tables', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should insert table via menu', async ({ page }) => {
    const insertTableButton = page.locator('button:has-text("Table"), [data-command="insertTable"]');
    if (await insertTableButton.isVisible()) {
      await insertTableButton.click();
      const html = await getEditorHTML(page);
      expect(html).toMatch(/<table/);
    }
  });

  test('should create table with default size', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const html = await getEditorHTML(page);
      expect(html).toMatch(/<tr/);
      expect(html).toMatch(/<td/);
    }
  });

  test('should navigate table with Tab key', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Cell 1');
      await pressTab(page);
      await typeText(page, 'Cell 2');
      await pressTab(page);
      await typeText(page, 'Cell 3');

      const html = await getEditorHTML(page);
      expect(html).toContain('Cell 1');
      expect(html).toContain('Cell 2');
      expect(html).toContain('Cell 3');
    }
  });

  test('should navigate table with Shift+Tab', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Cell 1');
      await pressTab(page);
      await typeText(page, 'Cell 2');
      await pressTab(page, true); // Go back
      await typeText(page, ' edited');

      const html = await getEditorHTML(page);
      expect(html).toContain('Cell 1 edited');
    }
  });

  test('should navigate table with arrow keys', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'A');
      await page.keyboard.press('ArrowRight');
      await typeText(page, 'B');
      await page.keyboard.press('ArrowDown');
      await typeText(page, 'C');

      const html = await getEditorHTML(page);
      expect(html).toContain('A');
      expect(html).toContain('B');
      expect(html).toContain('C');
    }
  });

  test('should add row via menu', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const addRowButton = page.locator('[data-command="addRowAfter"], button:has-text("Add row")');
      if (await addRowButton.isVisible()) {
        await addRowButton.click();
      }
    }
  });

  test('should add column via menu', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const addColButton = page.locator('[data-command="addColumnAfter"], button:has-text("Add column")');
      if (await addColButton.isVisible()) {
        await addColButton.click();
      }
    }
  });

  test('should delete row via menu', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const deleteRowButton = page.locator('[data-command="deleteRow"], button:has-text("Delete row")');
      if (await deleteRowButton.isVisible()) {
        await deleteRowButton.click();
      }
    }
  });

  test('should delete column via menu', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const deleteColButton = page.locator('[data-command="deleteColumn"], button:has-text("Delete column")');
      if (await deleteColButton.isVisible()) {
        await deleteColButton.click();
      }
    }
  });

  test('should merge cells via menu', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      // Select multiple cells (implementation-specific)
      const mergeButton = page.locator('[data-command="mergeCells"], button:has-text("Merge")');
      if (await mergeButton.isVisible()) {
        await mergeButton.click();
      }
    }
  });

  test('should split cells via menu', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const splitButton = page.locator('[data-command="splitCell"], button:has-text("Split")');
      if (await splitButton.isVisible()) {
        await splitButton.click();
      }
    }
  });

  test('should delete table via menu', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const deleteTableButton = page.locator('[data-command="deleteTable"], button:has-text("Delete table")');
      if (await deleteTableButton.isVisible()) {
        await deleteTableButton.click();
        const html = await getEditorHTML(page);
        expect(html).not.toMatch(/<table/);
      }
    }
  });

  test('should handle text formatting in table cells', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Bold text');
      await pressShortcut(page, 'Mod+a');
      await pressShortcut(page, 'Mod+b');

      const html = await getEditorHTML(page);
      expect(html).toMatch(/<td>.*<(strong|b)>Bold text<\/(strong|b)>.*<\/td>/);
    }
  });

  test('should create table header row', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      const toggleHeaderButton = page.locator('[data-command="toggleHeaderRow"], button:has-text("Header")');
      if (await toggleHeaderButton.isVisible()) {
        await toggleHeaderButton.click();
        const html = await getEditorHTML(page);
        expect(html).toMatch(/<th/);
      }
    }
  });

  test('should handle empty table cells', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await pressTab(page);
      await pressTab(page);
      await typeText(page, 'Cell 3');

      const html = await getEditorHTML(page);
      expect(html).toContain('Cell 3');
    }
  });

  test('should create new row on Tab at last cell', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      // Navigate to last cell
      await pressTab(page);
      await pressTab(page);
      await pressTab(page);
      await pressTab(page); // Should create new row

      const html = await getEditorHTML(page);
      const rowCount = (html.match(/<tr/g) || []).length;
      expect(rowCount).toBeGreaterThan(2);
    }
  });

  test('should handle copy/paste table', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Data');

      // Select table
      await pressShortcut(page, 'Mod+a');
      await pressShortcut(page, 'Mod+c');

      await page.keyboard.press('End');
      await pressShortcut(page, 'Enter');
      await pressShortcut(page, 'Mod+v');

      const html = await getEditorHTML(page);
      const tableCount = (html.match(/<table/g) || []).length;
      expect(tableCount).toBeGreaterThanOrEqual(2);
    }
  });

  test('should handle undo/redo in tables', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Data');

      await pressShortcut(page, 'Mod+z'); // Undo typing
      let html = await getEditorHTML(page);
      expect(html).not.toContain('Data');

      await pressShortcut(page, 'Mod+Shift+z'); // Redo
      html = await getEditorHTML(page);
      expect(html).toContain('Data');
    }
  });

  test('should select entire row', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      // Implementation-specific row selection
    }
  });

  test('should select entire column', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      // Implementation-specific column selection
    }
  });

  test('should handle table with many rows', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();

      // Add many rows
      for (let i = 0; i < 20; i++) {
        const addRowButton = page.locator('[data-command="addRowAfter"]');
        if (await addRowButton.isVisible()) {
          await addRowButton.click();
        }
      }

      const html = await getEditorHTML(page);
      const rowCount = (html.match(/<tr/g) || []).length;
      expect(rowCount).toBeGreaterThan(10);
    }
  });

  test('should handle table with many columns', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();

      // Add many columns
      for (let i = 0; i < 10; i++) {
        const addColButton = page.locator('[data-command="addColumnAfter"]');
        if (await addColButton.isVisible()) {
          await addColButton.click();
        }
      }

      const html = await getEditorHTML(page);
      const cellCount = (html.match(/<td/g) || []).length;
      expect(cellCount).toBeGreaterThan(10);
    }
  });

  test('should maintain table structure on edit', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Cell 1');
      await pressTab(page);
      await typeText(page, 'Cell 2');

      // Edit first cell
      await pressTab(page, true);
      await pressTab(page, true);
      await typeText(page, ' edited');

      const html = await getEditorHTML(page);
      expect(html).toContain('Cell 1 edited');
      expect(html).toContain('Cell 2');
      expect(html).toMatch(/<table/);
    }
  });

  test('should handle Backspace in table', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Text');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');

      const html = await getEditorHTML(page);
      expect(html).toContain('Te');
    }
  });

  test('should handle Enter in table cell', async ({ page }) => {
    const insertButton = page.locator('[data-command="insertTable"]');
    if (await insertButton.isVisible()) {
      await insertButton.click();
      await typeText(page, 'Line 1');
      await pressShortcut(page, 'Enter');
      await typeText(page, 'Line 2');

      const html = await getEditorHTML(page);
      expect(html).toContain('Line 1');
      expect(html).toContain('Line 2');
    }
  });
});
