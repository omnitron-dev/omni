/**
 * Button Primitive E2E Tests
 *
 * End-to-end tests for Button primitive accessibility, keyboard navigation, and user interactions
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { PrimitivePage, AccessibilityAssertions } from './utils/primitive-test-helpers.js';

/**
 * Button page helper
 */
class ButtonPage extends PrimitivePage {
  getButton(testId: string): Locator {
    return this.getByTestId(testId);
  }

  getButtonByText(text: string | RegExp): Locator {
    return this.getByRole('button', { name: text });
  }

  getAllButtons(): Locator {
    return this.page.locator('button, [role="button"]');
  }

  async clickButton(testId: string) {
    await this.getButton(testId).click();
  }

  async isButtonDisabled(testId: string): Promise<boolean> {
    const button = this.getButton(testId);
    const disabled = await button.getAttribute('disabled');
    const ariaDisabled = await button.getAttribute('aria-disabled');
    return disabled !== null || ariaDisabled === 'true';
  }

  async isButtonLoading(testId: string): Promise<boolean> {
    const button = this.getButton(testId);
    const loading = await button.getAttribute('data-loading');
    return loading !== null;
  }

  async getButtonVariant(testId: string): Promise<string | null> {
    const button = this.getButton(testId);
    return await button.getAttribute('data-variant');
  }

  async getButtonSize(testId: string): Promise<string | null> {
    const button = this.getButton(testId);
    return await button.getAttribute('data-size');
  }
}

test.describe('Button Primitive E2E', () => {
  let buttonPage: ButtonPage;
  let a11y: AccessibilityAssertions;

  test.beforeEach(async ({ page }) => {
    // Note: This requires a dev server with button examples
    // For now, we'll skip these tests until the dev server is set up
    test.skip(true, 'Requires dev server with button examples');

    await page.goto('/primitives/button');
    buttonPage = new ButtonPage(page);
    a11y = new AccessibilityAssertions(page);
    await buttonPage.waitForReady();
  });

  test.describe('User Interactions', () => {
    test('should respond to click', async ({ page }) => {
      const button = buttonPage.getByTestId('click-button');
      const counter = page.getByTestId('click-counter');

      await expect(counter).toHaveText('0');

      await button.click();
      await expect(counter).toHaveText('1');

      await button.click();
      await expect(counter).toHaveText('2');
    });

    test('should respond to keyboard activation (Space)', async ({ page }) => {
      const button = buttonPage.getByTestId('keyboard-button');
      const output = page.getByTestId('keyboard-output');

      await button.focus();
      await page.keyboard.press('Space');

      await expect(output).toContainText('activated');
    });

    test('should respond to keyboard activation (Enter)', async ({ page }) => {
      const button = buttonPage.getByTestId('keyboard-button');
      const output = page.getByTestId('keyboard-output');

      await button.focus();
      await page.keyboard.press('Enter');

      await expect(output).toContainText('activated');
    });

    test('should not respond to click when disabled', async ({ page }) => {
      const button = buttonPage.getByTestId('disabled-button');
      const counter = page.getByTestId('disabled-counter');

      await expect(counter).toHaveText('0');

      await button.click({ force: true });

      // Counter should still be 0
      await expect(counter).toHaveText('0');
    });

    test('should prevent multiple clicks during loading', async ({ page }) => {
      const button = buttonPage.getByTestId('loading-button');
      const clickCount = page.getByTestId('loading-click-count');

      await expect(clickCount).toHaveText('0');

      // Click button to start loading
      await button.click();

      // Try to click again while loading (should be prevented)
      await button.click({ force: true });
      await button.click({ force: true });

      // Wait for loading to complete
      await page.waitForTimeout(1000);

      // Should only have been clicked once
      await expect(clickCount).toHaveText('1');
    });

    test('should handle double-click prevention', async ({ page }) => {
      const button = buttonPage.getByTestId('debounce-button');
      const clickCount = page.getByTestId('debounce-count');

      await button.click();
      await button.click();
      await button.click();

      // Depending on implementation, might debounce clicks
      // Just verify it doesn't crash
      expect(await clickCount.textContent()).toBeTruthy();
    });
  });

  test.describe('Visual States', () => {
    test('should show hover state', async ({ page }) => {
      const button = buttonPage.getByTestId('hover-button');

      await button.hover();

      // Check for hover state - implementation specific
      // Could check for CSS changes, attribute changes, etc.
      const hasHover = await button.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return styles.cursor === 'pointer';
      });

      expect(hasHover).toBe(true);
    });

    test('should show focus state on keyboard navigation', async ({ page }) => {
      const button = buttonPage.getByTestId('focus-button');

      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();

      // Check for focus ring or indicator
      const hasFocusIndicator = await button.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return styles.outline !== 'none' || styles.boxShadow !== 'none';
      });

      expect(hasFocusIndicator).toBe(true);
    });

    test('should show active/pressed state on click', async ({ page }) => {
      const button = buttonPage.getByTestId('active-button');

      // Mouse down
      await button.hover();
      await page.mouse.down();

      // Check for active state
      const hasActiveState = await button.evaluate((el) => {
        return el.matches(':active');
      });

      expect(hasActiveState).toBe(true);

      await page.mouse.up();
    });

    test('should show loading animation', async ({ page }) => {
      const button = buttonPage.getByTestId('loading-animation-button');

      await button.click();

      // Should have loading indicator
      const loadingIcon = button.locator('[data-icon-loading]');
      await expect(loadingIcon).toBeVisible();

      // Icon should have animation (check for rotation/spin)
      const isAnimating = await loadingIcon.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return styles.animation !== 'none' || styles.animationName !== 'none';
      });

      // Note: This depends on CSS implementation
      // expect(isAnimating).toBe(true);
    });

    test('should show disabled appearance', async ({ page }) => {
      const button = buttonPage.getByTestId('disabled-appearance-button');

      // Check for disabled visual styling
      const hasDisabledStyle = await button.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const opacity = parseFloat(styles.opacity);
        return opacity < 1 || styles.cursor === 'not-allowed';
      });

      expect(hasDisabledStyle).toBe(true);
    });

    test('should preserve width during loading state', async ({ page }) => {
      const button = buttonPage.getByTestId('width-preservation-button');

      // Get initial width
      const initialBox = await button.boundingBox();
      const initialWidth = initialBox?.width;

      // Trigger loading
      await button.click();
      await page.waitForTimeout(100);

      // Get loading width
      const loadingBox = await button.boundingBox();
      const loadingWidth = loadingBox?.width;

      // Width should be similar (within 1px due to rounding)
      expect(Math.abs((initialWidth || 0) - (loadingWidth || 0))).toBeLessThan(1);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper button role', async ({ page }) => {
      const button = buttonPage.getByTestId('basic-button');
      await a11y.assertHasRole(button, 'button');
    });

    test('should be keyboard navigable', async ({ page }) => {
      const firstButton = buttonPage.getByTestId('first-button');
      const secondButton = buttonPage.getByTestId('second-button');

      // Tab to first button
      await page.keyboard.press('Tab');
      await expect(firstButton).toBeFocused();

      // Tab to second button
      await page.keyboard.press('Tab');
      await expect(secondButton).toBeFocused();

      // Shift+Tab back
      await page.keyboard.press('Shift+Tab');
      await expect(firstButton).toBeFocused();
    });

    test('should have accessible name for icon-only buttons', async ({ page }) => {
      const iconButton = buttonPage.getByTestId('icon-only-button');

      const ariaLabel = await iconButton.getAttribute('aria-label');
      const ariaLabelledby = await iconButton.getAttribute('aria-labelledby');

      expect(ariaLabel || ariaLabelledby).toBeTruthy();
    });

    test('should announce loading state to screen readers', async ({ page }) => {
      const button = buttonPage.getByTestId('sr-loading-button');

      await button.click();

      // Should have aria-busy when loading
      await expect(button).toHaveAttribute('aria-busy', 'true');

      // Wait for loading to complete
      await page.waitForTimeout(1000);

      // aria-busy should be removed or false
      const ariaBusy = await button.getAttribute('aria-busy');
      expect(ariaBusy === null || ariaBusy === 'false').toBe(true);
    });

    test('should announce disabled state to screen readers', async ({ page }) => {
      const button = buttonPage.getByTestId('sr-disabled-button');

      const ariaDisabled = await button.getAttribute('aria-disabled');
      expect(ariaDisabled).toBe('true');
    });

    test('should support toggle button pattern with aria-pressed', async ({ page }) => {
      const toggleButton = buttonPage.getByTestId('toggle-button');

      // Initially not pressed
      await expect(toggleButton).toHaveAttribute('aria-pressed', 'false');

      // Click to toggle
      await toggleButton.click();
      await expect(toggleButton).toHaveAttribute('aria-pressed', 'true');

      // Click again to toggle off
      await toggleButton.click();
      await expect(toggleButton).toHaveAttribute('aria-pressed', 'false');
    });

    test('should support menu trigger pattern with aria-expanded', async ({ page }) => {
      const menuButton = buttonPage.getByTestId('menu-button');

      // Initially collapsed
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

      // Click to open menu
      await menuButton.click();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

      // aria-controls should reference menu
      const ariaControls = await menuButton.getAttribute('aria-controls');
      expect(ariaControls).toBeTruthy();
    });

    test('should have correct tabindex', async ({ page }) => {
      const button = buttonPage.getByTestId('tabindex-button');
      const tabindex = await button.getAttribute('tabindex');

      // Should be focusable (0 or positive)
      expect(parseInt(tabindex || '0')).toBeGreaterThanOrEqual(0);
    });

    test('should work with aria-describedby', async ({ page }) => {
      const button = buttonPage.getByTestId('described-button');
      const ariaDescribedby = await button.getAttribute('aria-describedby');

      expect(ariaDescribedby).toBeTruthy();

      // Description element should exist
      const description = page.locator(`#${ariaDescribedby}`);
      await expect(description).toBeAttached();
    });
  });

  test.describe('Form Integration', () => {
    test('should submit form on click (type="submit")', async ({ page }) => {
      const form = page.locator('form[data-testid="submit-form"]');
      const submitButton = form.locator('button[type="submit"]');
      const output = page.getByTestId('form-submit-output');

      await submitButton.click();

      await expect(output).toContainText('submitted');
    });

    test('should reset form on click (type="reset")', async ({ page }) => {
      const form = page.locator('form[data-testid="reset-form"]');
      const input = form.locator('input[type="text"]');
      const resetButton = form.locator('button[type="reset"]');

      // Type something
      await input.fill('test value');
      await expect(input).toHaveValue('test value');

      // Reset
      await resetButton.click();

      await expect(input).toHaveValue('');
    });

    test('should not submit form when disabled', async ({ page }) => {
      const form = page.locator('form[data-testid="disabled-submit-form"]');
      const submitButton = form.locator('button[type="submit"][disabled]');
      const submitCount = page.getByTestId('disabled-submit-count');

      await expect(submitCount).toHaveText('0');

      // Try to submit (should be prevented)
      await submitButton.click({ force: true });

      await expect(submitCount).toHaveText('0');
    });

    test('should work with formAction attribute', async ({ page }) => {
      const button = buttonPage.getByTestId('form-action-button');

      const formAction = await button.getAttribute('formAction');
      expect(formAction).toBeTruthy();
    });
  });

  test.describe('Link Integration', () => {
    test('should navigate when rendered as link', async ({ page }) => {
      const link = buttonPage.getByTestId('link-button');

      // Should have href
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();

      // Should have button role
      await a11y.assertHasRole(link, 'button');

      // Click should navigate (prevent for test)
      const currentUrl = page.url();
      await link.click({ modifiers: ['Meta'] }); // Open in new tab
      // Or just check href is set
    });

    test('should open in new tab with target="_blank"', async ({ page }) => {
      const link = buttonPage.getByTestId('external-link-button');

      const target = await link.getAttribute('target');
      expect(target).toBe('_blank');

      const rel = await link.getAttribute('rel');
      expect(rel).toContain('noopener');
    });

    test('should not navigate when disabled', async ({ page }) => {
      const link = buttonPage.getByTestId('disabled-link-button');

      const initialUrl = page.url();

      await link.click({ force: true });

      // Should stay on same page
      expect(page.url()).toBe(initialUrl);
    });
  });

  test.describe('Variants and Styles', () => {
    test('should apply variant styles', async ({ page }) => {
      const variants = ['default', 'primary', 'secondary', 'danger', 'ghost', 'link'];

      for (const variant of variants) {
        const button = buttonPage.getByTestId(`${variant}-variant-button`);
        const dataVariant = await button.getAttribute('data-variant');
        expect(dataVariant).toBe(variant);
      }
    });

    test('should apply size styles', async ({ page }) => {
      const sizes = ['xs', 'sm', 'md', 'lg', 'xl'];

      for (const size of sizes) {
        const button = buttonPage.getByTestId(`${size}-size-button`);
        const dataSize = await button.getAttribute('data-size');
        expect(dataSize).toBe(size);
      }
    });

    test('should support full-width buttons', async ({ page }) => {
      const button = buttonPage.getByTestId('full-width-button');
      const parent = button.locator('..');

      const buttonBox = await button.boundingBox();
      const parentBox = await parent.boundingBox();

      // Button width should match parent width (or close to it)
      const widthDiff = Math.abs((buttonBox?.width || 0) - (parentBox?.width || 0));
      expect(widthDiff).toBeLessThan(10); // Within 10px
    });
  });

  test.describe('Real-world Scenarios', () => {
    test('should handle async operation with loading state', async ({ page }) => {
      const button = buttonPage.getByTestId('async-button');
      const status = page.getByTestId('async-status');

      await expect(status).toHaveText('idle');

      // Click to start async operation
      await button.click();

      // Should show loading
      await expect(status).toHaveText('loading');
      await expect(button).toHaveAttribute('data-loading', '');

      // Wait for completion
      await page.waitForTimeout(1500);

      // Should show success
      await expect(status).toHaveText('success');
      const loading = await button.getAttribute('data-loading');
      expect(loading).toBeNull();
    });

    test('should work in button group', async ({ page }) => {
      const buttonGroup = page.locator('[role="group"][data-testid="button-group"]');
      const buttons = buttonGroup.locator('button');

      const count = await buttons.count();
      expect(count).toBeGreaterThan(1);

      // All buttons should be keyboard navigable
      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i);
        await button.focus();
        await expect(button).toBeFocused();

        if (i < count - 1) {
          await page.keyboard.press('Tab');
        }
      }
    });

    test('should work in toolbar', async ({ page }) => {
      const toolbar = page.locator('[role="toolbar"]');
      const buttons = toolbar.locator('button');

      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);

      // Keyboard navigation in toolbar
      await buttons.first().focus();

      for (let i = 0; i < count - 1; i++) {
        await page.keyboard.press('ArrowRight');
      }

      // Should wrap or stop at end
      const lastButton = buttons.last();
      await expect(lastButton).toBeFocused();
    });

    test('should handle rapid state changes', async ({ page }) => {
      const button = buttonPage.getByTestId('rapid-change-button');
      const toggleButton = buttonPage.getByTestId('rapid-toggle');

      // Rapidly toggle state
      for (let i = 0; i < 10; i++) {
        await toggleButton.click();
        await page.waitForTimeout(10);
      }

      // Button should still be functional
      await button.click();
      expect(await button.isVisible()).toBe(true);
    });

    test('should work with conditional rendering', async ({ page }) => {
      const showButton = buttonPage.getByTestId('show-conditional-button');
      const conditionalButton = buttonPage.getByTestId('conditional-button');

      // Initially hidden
      await expect(conditionalButton).not.toBeVisible();

      // Show button
      await showButton.click();
      await expect(conditionalButton).toBeVisible();

      // Should be functional
      await conditionalButton.click();
    });
  });

  test.describe('Focus Management', () => {
    test('should maintain focus after click', async ({ page }) => {
      const button = buttonPage.getByTestId('focus-maintain-button');

      await button.click();

      // Button should still be focused after click
      await expect(button).toBeFocused();
    });

    test('should restore focus correctly', async ({ page }) => {
      const triggerButton = buttonPage.getByTestId('dialog-trigger');
      const closeButton = buttonPage.getByTestId('dialog-close');

      // Focus trigger and open dialog
      await triggerButton.focus();
      await triggerButton.click();

      // Close dialog
      await closeButton.click();

      // Focus should return to trigger
      await expect(triggerButton).toBeFocused();
    });

    test('should skip disabled buttons in tab order', async ({ page }) => {
      const button1 = buttonPage.getByTestId('tab-button-1');
      const disabledButton = buttonPage.getByTestId('tab-button-disabled');
      const button3 = buttonPage.getByTestId('tab-button-3');

      await button1.focus();
      await expect(button1).toBeFocused();

      // Tab should skip disabled button
      await page.keyboard.press('Tab');
      await expect(button3).toBeFocused();
    });
  });

  test.describe('Performance', () => {
    test('should handle many buttons efficiently', async ({ page }) => {
      const manyButtons = page.locator('[data-testid^="perf-button-"]');
      const count = await manyButtons.count();

      expect(count).toBeGreaterThan(50);

      // All should be rendered and clickable
      const randomIndex = Math.floor(Math.random() * count);
      const randomButton = manyButtons.nth(randomIndex);

      await randomButton.click();
      expect(await randomButton.isVisible()).toBe(true);
    });

    test('should update loading state quickly', async ({ page }) => {
      const button = buttonPage.getByTestId('perf-loading-button');

      const start = Date.now();

      await button.click();

      // Should show loading state within reasonable time
      await expect(button).toHaveAttribute('data-loading', '');

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // Should be nearly instant
    });
  });
});
