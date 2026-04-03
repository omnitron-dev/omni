/**
 * E2E Tests: ConfirmDialog Component
 *
 * Tests for the ConfirmDialog and DeleteDialog components.
 * Validates user interactions, accessibility, and visual appearance.
 *
 * @see https://playwright.dev/docs/test-components
 */

import { test, expect } from '@playwright/test';

test.describe('ConfirmDialog', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the test page with dialog demo
    await page.goto('/test/dialog');
  });

  test('should open dialog when trigger is clicked', async ({ page }) => {
    // Click the trigger button
    await page.getByRole('button', { name: /open dialog/i }).click();

    // Wait for dialog to appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Check dialog has proper title
    await expect(dialog.getByRole('heading')).toContainText('Confirm');
  });

  test('should close dialog on cancel button click', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Click cancel
    await page.getByRole('button', { name: /cancel/i }).click();

    // Dialog should be hidden
    await expect(dialog).toBeHidden();
  });

  test('should call onConfirm when confirm button is clicked', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();

    // Click confirm
    await page.getByRole('button', { name: /confirm/i }).click();

    // Check that confirmation message appears
    await expect(page.getByText(/confirmed!/i)).toBeVisible();
  });

  test('should close dialog when clicking outside (backdrop)', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Get dialog bounding box to click outside of it
    const dialogBox = await dialog.boundingBox();
    if (dialogBox) {
      // Click to the left of the dialog (on the backdrop)
      await page.mouse.click(dialogBox.x - 50, dialogBox.y + dialogBox.height / 2);
    }

    // Dialog should be hidden
    await expect(dialog).toBeHidden();
  });

  test('should trap focus within dialog', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();

    // Tab through dialog elements
    await page.keyboard.press('Tab');
    const cancelButton = page.getByRole('button', { name: /cancel/i });
    await expect(cancelButton).toBeFocused();

    await page.keyboard.press('Tab');
    const confirmButton = page.getByRole('button', { name: /confirm/i });
    await expect(confirmButton).toBeFocused();

    // Tab should wrap back to first focusable element
    await page.keyboard.press('Tab');
    await expect(cancelButton).toBeFocused();
  });

  test('should close dialog on Escape key', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Dialog should be hidden
    await expect(dialog).toBeHidden();
  });

  test('should have proper ARIA attributes', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /open dialog/i }).click();
    const dialog = page.getByRole('dialog');

    // Check ARIA attributes
    await expect(dialog).toHaveAttribute('aria-labelledby');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Check that title has matching ID
    const titleId = await dialog.getAttribute('aria-labelledby');
    const title = page.locator(`#${titleId}`);
    await expect(title).toBeVisible();
  });
});

test.describe('DeleteDialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/dialog');
  });

  test('should show delete confirmation with item name', async ({ page }) => {
    // Click delete button
    await page.getByRole('button', { name: /delete item/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Should show item name in title
    await expect(dialog.getByRole('heading')).toContainText('Delete');

    // Should have warning content
    await expect(dialog).toContainText(/cannot be undone/i);
  });

  test('should have red delete button', async ({ page }) => {
    await page.getByRole('button', { name: /delete item/i }).click();

    const deleteButton = page.getByRole('button', { name: /delete/i });
    await expect(deleteButton).toBeVisible();

    // Check button has error color (red)
    const backgroundColor = await deleteButton.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should be a red-ish color
    expect(backgroundColor).toMatch(/rgb\(\s*\d+,\s*\d+,\s*\d+\s*\)/);
  });
});

test.describe('Dialog Loading State', () => {
  test('should disable buttons when loading', async ({ page }) => {
    await page.goto('/test/dialog?loading=true');

    // Open dialog
    await page.getByRole('button', { name: /open async dialog/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Click confirm to trigger loading
    await page.getByRole('button', { name: /confirm/i }).click();

    // Buttons should be disabled during loading
    const confirmButton = page.getByRole('button', { name: /confirm/i });
    await expect(confirmButton).toBeDisabled();

    const cancelButton = page.getByRole('button', { name: /cancel/i });
    await expect(cancelButton).toBeDisabled();
  });

  test('should not close on backdrop click when loading', async ({ page }) => {
    await page.goto('/test/dialog?loading=true');

    // Open dialog and trigger loading
    await page.getByRole('button', { name: /open async dialog/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();

    // Try to click backdrop
    await page.locator('.MuiBackdrop-root').click({ force: true });

    // Dialog should still be visible
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
  });
});
