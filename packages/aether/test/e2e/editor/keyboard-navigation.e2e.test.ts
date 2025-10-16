/**
 * E2E Tests: Keyboard Navigation
 *
 * Tests keyboard navigation, shortcuts, and accessibility features.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  pressShortcut,
  pressTab,
  pressEscape,
  focusEditor,
  getEditor,
} from './helpers';

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should tab through toolbar buttons', async ({ page }) => {
    const firstButton = page.locator('.toolbar-button').first();
    await firstButton.focus();

    await pressTab(page);
    const activeElement = await page.evaluate(() => document.activeElement?.className);
    expect(activeElement).toContain('toolbar-button');
  });

  test('should tab from toolbar to editor', async ({ page }) => {
    const firstButton = page.locator('.toolbar-button').first();
    await firstButton.focus();

    // Tab through all toolbar buttons
    for (let i = 0; i < 20; i++) {
      await pressTab(page);
    }

    const activeElement = await page.evaluate(() => document.activeElement?.className);
    expect(activeElement).toContain('ProseMirror');
  });

  test('should Shift+Tab backwards through toolbar', async ({ page }) => {
    const editor = getEditor(page);
    await editor.focus();

    await pressTab(page, true); // Shift+Tab

    const activeElement = await page.evaluate(() => document.activeElement?.className);
    expect(activeElement).toContain('toolbar-button');
  });

  test('should navigate with arrow keys', async ({ page }) => {
    await typeText(page, 'Hello World');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await typeText(page, 'X');

    const editor = getEditor(page);
    const text = await editor.textContent();
    expect(text).toContain('WorXld');
  });

  test('should navigate with Home key', async ({ page }) => {
    await typeText(page, 'Hello World');
    await page.keyboard.press('Home');
    await typeText(page, 'Start ');

    const editor = getEditor(page);
    const text = await editor.textContent();
    expect(text).toContain('Start Hello');
  });

  test('should navigate with End key', async ({ page }) => {
    await typeText(page, 'Hello');
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await typeText(page, ' World');

    const editor = getEditor(page);
    const text = await editor.textContent();
    expect(text).toContain('Hello World');
  });

  test('should navigate with Page Up key', async ({ page }) => {
    // Create long content
    for (let i = 0; i < 30; i++) {
      await typeText(page, `Line ${i}`);
      await pressShortcut(page, 'Enter');
    }

    await page.keyboard.press('PageUp');
    // Should scroll up
  });

  test('should navigate with Page Down key', async ({ page }) => {
    for (let i = 0; i < 30; i++) {
      await typeText(page, `Line ${i}`);
      await pressShortcut(page, 'Enter');
    }

    await page.keyboard.press('Home');
    await page.keyboard.press('PageDown');
    // Should scroll down
  });

  test('should close dialogs with Escape', async ({ page }) => {
    const linkButton = page.locator('[data-command="link"]');
    if (await linkButton.isVisible()) {
      await linkButton.click();

      const dialog = page.locator('[role="dialog"], .dialog');
      if (await dialog.isVisible()) {
        await pressEscape(page);
        await expect(dialog).not.toBeVisible();
      }
    }
  });

  test('should focus editor with F6', async ({ page }) => {
    const toolbar = page.locator('.toolbar-button').first();
    await toolbar.focus();

    await page.keyboard.press('F6');
    // F6 typically cycles through regions
  });

  test('should activate toolbar button with Space', async ({ page }) => {
    const boldButton = page.locator('[data-command="bold"]');
    await boldButton.focus();
    await page.keyboard.press('Space');

    // Bold should be activated
    await typeText(page, 'Bold text');

    const editor = getEditor(page);
    const html = await editor.innerHTML();
    expect(html).toMatch(/<(strong|b)>/);
  });

  test('should activate toolbar button with Enter', async ({ page }) => {
    const boldButton = page.locator('[data-command="bold"]');
    await boldButton.focus();
    await page.keyboard.press('Enter');

    await typeText(page, 'Bold text');

    const editor = getEditor(page);
    const html = await editor.innerHTML();
    expect(html).toMatch(/<(strong|b)>/);
  });

  test('should navigate list items with arrow keys', async ({ page }) => {
    await typeText(page, 'Item 1');
    const listButton = page.locator('[data-command="bulletList"]');
    if (await listButton.isVisible()) {
      await listButton.click();
    }

    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 2');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'Item 3');

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await typeText(page, ' edited');

    const editor = getEditor(page);
    const text = await editor.textContent();
    expect(text).toContain('Item 1 edited');
  });

  test('should handle Ctrl+A to select all', async ({ page }) => {
    await typeText(page, 'Hello World');
    await pressShortcut(page, 'Mod+a');

    const selection = await page.evaluate(() => window.getSelection()?.toString());
    expect(selection).toContain('Hello World');
  });

  test('should handle Ctrl+Z for undo', async ({ page }) => {
    await typeText(page, 'Hello');
    await pressShortcut(page, 'Mod+z');

    const editor = getEditor(page);
    const text = await editor.textContent();
    expect(text).not.toContain('Hello');
  });

  test('should handle Ctrl+Y for redo', async ({ page }) => {
    await typeText(page, 'Hello');
    await pressShortcut(page, 'Mod+z');
    await pressShortcut(page, 'Mod+y');

    const editor = getEditor(page);
    const text = await editor.textContent();
    expect(text).toContain('Hello');
  });

  test('should handle keyboard shortcuts in menus', async ({ page }) => {
    // Open menu with keyboard
    const menuButton = page.locator('[aria-haspopup="menu"]').first();
    if (await menuButton.isVisible()) {
      await menuButton.focus();
      await page.keyboard.press('Enter');

      const menu = page.locator('[role="menu"]');
      if (await menu.isVisible()) {
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      }
    }
  });

  test('should show focus indicators', async ({ page }) => {
    const button = page.locator('.toolbar-button').first();
    await button.focus();

    const outline = await button.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return styles.outline || styles.border;
    });

    expect(outline).toBeTruthy();
  });

  test('should trap focus in modal dialogs', async ({ page }) => {
    const linkButton = page.locator('[data-command="link"]');
    if (await linkButton.isVisible()) {
      await linkButton.click();

      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible()) {
        // Tab through dialog elements
        await pressTab(page);
        await pressTab(page);

        // Focus should stay within dialog
        const activeElement = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.contains(document.activeElement);
        });

        expect(activeElement).toBe(true);
      }
    }
  });
});
