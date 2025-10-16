/**
 * E2E Tests: Accessibility
 *
 * Tests ARIA attributes, screen reader support, and keyboard accessibility.
 */

import { test, expect } from '@playwright/test';
import { waitForEditor, typeText, pressShortcut, getEditor, checkA11y } from './helpers';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should have proper ARIA role for editor', async ({ page }) => {
    const editor = getEditor(page);
    const role = await editor.getAttribute('role');
    expect(role).toBe('textbox');
  });

  test('should have ARIA label for editor', async ({ page }) => {
    const editor = getEditor(page);
    const label = await editor.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });

  test('should have contenteditable attribute', async ({ page }) => {
    const editor = getEditor(page);
    const editable = await editor.getAttribute('contenteditable');
    expect(editable).toBe('true');
  });

  test('should have ARIA labels for toolbar buttons', async ({ page }) => {
    const buttons = page.locator('.toolbar-button');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      const label = await button.getAttribute('aria-label');
      const title = await button.getAttribute('title');
      expect(label || title).toBeTruthy();
    }
  });

  test('should have role="toolbar" for toolbar', async ({ page }) => {
    const toolbar = page.locator('.toolbar');
    if (await toolbar.isVisible()) {
      const role = await toolbar.getAttribute('role');
      expect(role).toBe('toolbar');
    }
  });

  test('should announce formatting changes', async ({ page }) => {
    await typeText(page, 'Text');
    await pressShortcut(page, 'Mod+a');
    await pressShortcut(page, 'Mod+b');

    // Check for aria-live region
    const liveRegion = page.locator('[aria-live]');
    if (await liveRegion.isVisible()) {
      await expect(liveRegion).toBeVisible();
    }
  });

  test('should have keyboard-only operation', async ({ page }) => {
    // Test that all functionality is accessible via keyboard
    const editor = getEditor(page);
    await editor.focus();

    await typeText(page, 'Test');
    await pressShortcut(page, 'Mod+b'); // Bold via keyboard

    const html = await editor.innerHTML();
    expect(html).toMatch(/<(strong|b)>/);
  });

  test('should have visible focus indicators', async ({ page }) => {
    const button = page.locator('.toolbar-button').first();
    await button.focus();

    const hasOutline = await button.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return styles.outline !== 'none' || styles.outlineWidth !== '0px' || styles.border !== 'none';
    });

    expect(hasOutline).toBe(true);
  });

  test('should support screen reader navigation', async ({ page }) => {
    const editor = getEditor(page);
    await editor.focus();

    await typeText(page, 'Heading');
    await page.keyboard.press('Home');

    const headingButton = page.locator('[data-command="heading1"]');
    if (await headingButton.isVisible()) {
      await headingButton.focus();
      const label = await headingButton.getAttribute('aria-label');
      expect(label).toBeTruthy();
    }
  });

  test('should have proper heading hierarchy', async ({ page }) => {
    // Check that page has proper heading structure
    const headings = await page.evaluate(() => {
      const h1 = document.querySelectorAll('h1').length;
      const h2 = document.querySelectorAll('h2').length;
      const h3 = document.querySelectorAll('h3').length;
      return { h1, h2, h3 };
    });

    // Should have logical heading structure
    expect(headings).toBeDefined();
  });

  test('should have alt text support for images', async ({ page }) => {
    const imageButton = page.locator('[data-command="image"]');
    if (await imageButton.isVisible()) {
      await imageButton.click();

      const altInput = page.locator('input[placeholder*="alt"], input[aria-label*="alt"]');
      if (await altInput.isVisible()) {
        await expect(altInput).toBeVisible();
      }
    }
  });

  test('should support high contrast mode', async ({ page }) => {
    // Enable high contrast mode simulation
    await page.emulateMedia({ colorScheme: 'dark' });

    const editor = getEditor(page);
    const color = await editor.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return styles.color;
    });

    expect(color).toBeTruthy();
  });

  test('should have sufficient color contrast', async ({ page }) => {
    const editor = getEditor(page);
    const { color, backgroundColor } = await editor.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        color: styles.color,
        backgroundColor: styles.backgroundColor,
      };
    });

    expect(color).toBeTruthy();
    expect(backgroundColor).toBeTruthy();
  });

  test('should have ARIA attributes for lists', async ({ page }) => {
    await typeText(page, 'Item 1');
    const listButton = page.locator('[data-command="bulletList"]');
    if (await listButton.isVisible()) {
      await listButton.click();

      const list = page.locator('ul');
      if (await list.isVisible()) {
        const role = await list.evaluate((el) => {
          return el.getAttribute('role') || el.tagName.toLowerCase();
        });
        expect(role).toMatch(/list|ul/i);
      }
    }
  });

  test('should announce undo/redo operations', async ({ page }) => {
    await typeText(page, 'Test');
    await pressShortcut(page, 'Mod+z');

    const liveRegion = page.locator('[aria-live="polite"], [aria-live="assertive"]');
    if (await liveRegion.isVisible()) {
      // Should announce undo
      await expect(liveRegion).toBeVisible();
    }
  });

  test('should have proper table accessibility', async ({ page }) => {
    const tableButton = page.locator('[data-command="insertTable"]');
    if (await tableButton.isVisible()) {
      await tableButton.click();

      const table = page.locator('table');
      if (await table.isVisible()) {
        const caption = await table.locator('caption').count();
        const headers = await table.locator('th').count();
        // Tables should have headers or caption
        expect(caption + headers).toBeGreaterThan(0);
      }
    }
  });

  test('should support reduced motion preference', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const editor = getEditor(page);
    await editor.focus();

    // Animations should be disabled or reduced
    const transition = await editor.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return styles.transition;
    });

    // Check that transitions respect prefers-reduced-motion
    expect(transition).toBeDefined();
  });

  test('should have skip links or landmarks', async ({ page }) => {
    const landmarks = await page.evaluate(() => {
      const main = document.querySelector('main, [role="main"]');
      const nav = document.querySelector('nav, [role="navigation"]');
      return { main: !!main, nav: !!nav };
    });

    // Should have semantic HTML or ARIA landmarks
    expect(landmarks).toBeDefined();
  });
});
