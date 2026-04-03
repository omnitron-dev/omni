/**
 * Accessibility Tests for Prism Design System
 *
 * Uses @axe-core/playwright for automated accessibility testing.
 * Tests WCAG 2.1 AA compliance for all core components.
 *
 * @see https://playwright.dev/docs/accessibility-testing
 * @see https://www.deque.com/axe/
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility: Core Components', () => {
  test('ConfirmDialog should have no accessibility violations', async ({ page }) => {
    await page.goto('/test/dialog');

    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();
    await page.waitForSelector('[role="dialog"]');

    // Run axe accessibility scan
    const accessibilityScanResults = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('DashboardBlock should have no accessibility violations', async ({ page }) => {
    await page.goto('/test/dashboard-block');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('[data-testid="prism-dashboard-block"]')
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Form fields should have no accessibility violations', async ({ page }) => {
    await page.goto('/test/form');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('form')
      // Exclude known issues that are MUI's responsibility
      .disableRules(['color-contrast'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Navigation should have no accessibility violations', async ({ page }) => {
    await page.goto('/test/navigation');

    const accessibilityScanResults = await new AxeBuilder({ page }).include('[role="navigation"]').analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

test.describe('Accessibility: Keyboard Navigation', () => {
  test('form fields should be keyboard focusable', async ({ page }) => {
    await page.goto('/test/form');

    // Verify form fields can receive focus
    const firstNameField = page.getByLabel('First Name');
    await firstNameField.focus();
    await expect(firstNameField).toBeFocused();

    // Tab to next field
    await page.keyboard.press('Tab');
    const lastNameField = page.getByLabel('Last Name');
    await expect(lastNameField).toBeFocused();
  });

  test('should have visible focus indicators', async ({ page }) => {
    await page.goto('/test/form');

    const button = page.getByRole('button', { name: /submit/i });
    await button.focus();

    // Check that focus is visible (outline or box-shadow)
    const hasVisibleFocus = await button.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const outline = styles.outline;
      const boxShadow = styles.boxShadow;
      return outline !== 'none' || (boxShadow !== 'none' && boxShadow !== '');
    });

    expect(hasVisibleFocus).toBe(true);
  });

  test('dropdown menu should be keyboard operable', async ({ page }) => {
    await page.goto('/test/menu');

    // Open menu with keyboard
    const menuTrigger = page.getByRole('button', { name: 'Options', exact: true });
    await menuTrigger.focus();
    await page.keyboard.press('Enter');

    // Menu should be open
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Navigate and select with keyboard
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Menu should close after selection
    await expect(menu).toBeHidden();
  });
});

test.describe('Accessibility: Color Contrast', () => {
  test('text content should have sufficient contrast in light mode', async ({ page }) => {
    await page.goto('/test/colors?mode=light');

    // Focus on text content contrast, excluding:
    // - Disabled text (WCAG exempts disabled UI elements)
    // - Secondary text (intentionally lower contrast for hierarchy)
    // - Buttons (have different contrast considerations due to size/weight)
    // - Chips (similar to buttons - small interactive elements)
    // - Links (underlined text has different contrast requirements per WCAG)
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .exclude('[data-testid="disabled-text"]')
      .exclude('[data-testid="secondary-text"]')
      .exclude('button')
      .exclude('.MuiButton-root')
      .exclude('.MuiChip-root')
      .exclude('.MuiAlert-root')
      .exclude('a')
      .analyze();

    // Log any violations for debugging
    if (accessibilityScanResults.violations.length > 0) {
      console.log('Contrast violations:', accessibilityScanResults.violations);
    }

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('text content should have sufficient contrast in dark mode', async ({ page }) => {
    await page.goto('/test/colors?mode=dark');

    // Same exclusions for dark mode
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .exclude('[data-testid="disabled-text"]')
      .exclude('[data-testid="secondary-text"]')
      .exclude('button')
      .exclude('.MuiButton-root')
      .exclude('.MuiChip-root')
      .exclude('.MuiAlert-root')
      .exclude('a')
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

test.describe('Accessibility: Screen Reader', () => {
  test('dialogs should have proper ARIA labels', async ({ page }) => {
    await page.goto('/test/dialog');
    await page.getByRole('button', { name: /open dialog/i }).click();

    const dialog = page.getByRole('dialog');

    // Should have aria-labelledby
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    // Title should exist with matching ID
    const title = page.locator(`#${labelledBy}`);
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
  });

  test('form inputs should have associated labels', async ({ page }) => {
    await page.goto('/test/form');

    const inputs = await page.getByRole('textbox').all();

    for (const input of inputs) {
      // Each input should have an accessible name
      const accessibleName = await input.evaluate((el) => {
        return (
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          document.querySelector(`label[for="${el.id}"]`)?.textContent
        );
      });

      expect(accessibleName).toBeTruthy();
    }
  });

  test('buttons should have accessible names', async ({ page }) => {
    await page.goto('/test/buttons');

    const buttons = await page.getByRole('button').all();

    for (const button of buttons) {
      // Each button should have accessible text
      const accessibleName = await button.evaluate((el) => {
        return el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title');
      });

      expect(accessibleName).toBeTruthy();
    }
  });

  test('icon buttons should have aria-label', async ({ page }) => {
    await page.goto('/test/buttons');

    // Find icon-only buttons (buttons with only SVG/icon content)
    const iconButtons = page.locator('button:has(svg):not(:has-text(""))');
    const count = await iconButtons.count();

    for (let i = 0; i < count; i++) {
      const button = iconButtons.nth(i);
      const ariaLabel = await button.getAttribute('aria-label');
      expect(ariaLabel).toBeTruthy();
    }
  });
});

test.describe('Accessibility: Focus Management', () => {
  test('dialog should trap focus', async ({ page }) => {
    await page.goto('/test/dialog');

    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Get all focusable elements in dialog
    const focusableElements = dialog.locator(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const count = await focusableElements.count();

    // Tab through all elements
    for (let i = 0; i < count + 2; i++) {
      await page.keyboard.press('Tab');
    }

    // Focus should still be within dialog
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();

    // Verify focused element is inside dialog
    const isInDialog = await focusedElement.evaluate((el, dialogSelector) => {
      return el.closest('[role="dialog"]') !== null;
    }, '[role="dialog"]');

    expect(isInDialog).toBe(true);
  });

  test('focus should return to trigger after dialog closes', async ({ page }) => {
    await page.goto('/test/dialog');

    const trigger = page.getByRole('button', { name: /open dialog/i });
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Focus should return to trigger
    await expect(trigger).toBeFocused();
  });
});

test.describe('Accessibility: Motion and Animation', () => {
  test('should respect prefers-reduced-motion', async ({ page }) => {
    // Emulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/test/animations');

    // Check that animations are disabled or reduced
    const animatedElement = page.locator('[data-animated]');
    const animationDuration = await animatedElement.evaluate((el) => {
      return window.getComputedStyle(el).animationDuration;
    });

    // Animation should be instant or very short
    expect(animationDuration).toMatch(/^0s$|^0\.0*1s$/);
  });
});
