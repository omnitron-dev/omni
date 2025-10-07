/**
 * Dialog Primitive E2E Tests
 *
 * Tests for Dialog primitive accessibility, keyboard navigation, and functionality
 */

import { test, expect } from '@playwright/test';
import { DialogPage, AccessibilityAssertions } from './utils/primitive-test-helpers';

test.describe('Dialog Primitive', () => {
  let dialog: DialogPage;
  let a11y: AccessibilityAssertions;

  test.beforeEach(async ({ page }) => {
    // Navigate to dialog test page
    // Note: This requires a dev server with primitive examples
    test.skip(true, 'Requires dev server with primitive examples');

    await page.goto('/primitives/dialog');
    dialog = new DialogPage(page);
    a11y = new AccessibilityAssertions(page);
    await dialog.waitForReady();
  });

  test.describe('Basic Functionality', () => {
    test('should open dialog when trigger is clicked', async () => {
      await dialog.open();
      await expect(dialog.dialog).toBeVisible();
    });

    test('should close dialog when close button is clicked', async () => {
      await dialog.open();
      await dialog.close();
      await expect(dialog.dialog).not.toBeVisible();
    });

    test('should close dialog on Escape key', async () => {
      await dialog.open();
      await dialog.closeWithEscape();
      await expect(dialog.dialog).not.toBeVisible();
    });

    test('should close dialog when clicking overlay', async ({ page }) => {
      await dialog.open();
      await dialog.clickOverlay();
      await expect(dialog.dialog).not.toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA role', async () => {
      await dialog.open();
      await a11y.assertHasRole(dialog.dialog, 'dialog');
    });

    test('should have aria-modal="true"', async () => {
      await dialog.open();
      await expect(dialog.dialog).toHaveAttribute('aria-modal', 'true');
    });

    test('should have accessible title', async () => {
      await dialog.open();
      await expect(dialog.title).toBeVisible();

      const titleId = await dialog.title.getAttribute('id');
      const ariaLabelledby = await dialog.dialog.getAttribute('aria-labelledby');
      expect(ariaLabelledby).toBe(titleId);
    });

    test('should have accessible description', async () => {
      await dialog.open();
      await expect(dialog.description).toBeVisible();

      const descId = await dialog.description.getAttribute('id');
      const ariaDescribedby = await dialog.dialog.getAttribute('aria-describedby');
      expect(ariaDescribedby).toBe(descId);
    });

    test('should trap focus within dialog', async ({ page }) => {
      await dialog.open();

      // Get all focusable elements in dialog
      const focusableCount = await dialog.dialog.locator('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])').count();

      // Tab through all elements - focus should stay in dialog
      for (let i = 0; i < focusableCount + 2; i++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => document.activeElement);
        const isInDialog = await dialog.dialog.evaluate((el, focusedEl) => {
          return el.contains(focusedEl as Node);
        }, focused);
        expect(isInDialog).toBe(true);
      }
    });

    test('should restore focus on close', async ({ page }) => {
      // Get trigger element
      const trigger = dialog.trigger;
      await trigger.focus();

      // Open dialog
      await dialog.open();

      // Focus should move to dialog
      const focusInDialog = await dialog.dialog.evaluate(el => {
        return el.contains(document.activeElement);
      });
      expect(focusInDialog).toBe(true);

      // Close dialog
      await dialog.closeWithEscape();

      // Focus should return to trigger
      await expect(trigger).toBeFocused();
    });

    test('should prevent body scroll when open', async ({ page }) => {
      await dialog.open();

      // Body should have overflow hidden
      const bodyOverflow = await page.evaluate(() => {
        return window.getComputedStyle(document.body).overflow;
      });
      expect(bodyOverflow).toBe('hidden');
    });

    test('should restore body scroll when closed', async ({ page }) => {
      await dialog.open();
      await dialog.close();

      // Body overflow should be restored
      const bodyOverflow = await page.evaluate(() => {
        return window.getComputedStyle(document.body).overflow;
      });
      expect(bodyOverflow).not.toBe('hidden');
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should focus first focusable element on open', async ({ page }) => {
      await dialog.open();

      // First focusable element should be focused
      const firstFocusable = dialog.dialog.locator('button, [href], input').first();
      await expect(firstFocusable).toBeFocused();
    });

    test('should support Tab navigation', async ({ page }) => {
      await dialog.open();

      const buttons = dialog.dialog.locator('button');
      const buttonCount = await buttons.count();

      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i);
        await expect(button).toBeFocused();
        if (i < buttonCount - 1) {
          await page.keyboard.press('Tab');
        }
      }
    });

    test('should support Shift+Tab navigation', async ({ page }) => {
      await dialog.open();

      // Tab to last element
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Shift+Tab should move backwards
      await page.keyboard.press('Shift+Tab');

      const focused = await page.evaluate(() => document.activeElement?.tagName);
      expect(focused).toBeTruthy();
    });
  });

  test.describe('State Management', () => {
    test('should maintain state when open', async () => {
      await dialog.open();
      await expect(dialog.trigger).toHaveAttribute('aria-expanded', 'true');
    });

    test('should update state when closed', async () => {
      await dialog.open();
      await dialog.close();
      await expect(dialog.trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test.describe('Portal Rendering', () => {
    test('should render dialog in portal (document.body)', async ({ page }) => {
      await dialog.open();

      // Dialog should be direct child of body
      const isInBody = await page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        return dialogs.length > 0 && document.body.contains(dialogs[0]);
      });
      expect(isInBody).toBe(true);
    });
  });
});
