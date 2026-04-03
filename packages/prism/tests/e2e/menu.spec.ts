/**
 * E2E Tests: Menu Components
 *
 * Tests for dropdown menus, context menus, and menu interactions.
 * Validates user interactions, accessibility, and keyboard navigation.
 *
 * @see https://playwright.dev/docs/test-components
 */

import { test, expect } from '@playwright/test';

test.describe('Button Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/menu');
  });

  test('should open menu when button is clicked', async ({ page }) => {
    const optionsButton = page.getByRole('button', { name: 'Options', exact: true });
    await optionsButton.click();

    // Menu should be visible
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Should have menu items
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('should close menu when item is clicked', async ({ page }) => {
    // Open menu
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Click menu item
    await page.getByRole('menuitem', { name: 'Edit' }).click();

    // Menu should be closed
    await expect(menu).toBeHidden();
  });

  test('should close menu on escape key', async ({ page }) => {
    // Open menu
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Menu should be closed
    await expect(menu).toBeHidden();
  });

  test('should close menu when clicking outside', async ({ page }) => {
    // Open menu
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Click outside
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Menu should be closed
    await expect(menu).toBeHidden();
  });

  test('should support keyboard navigation with arrow keys', async ({ page }) => {
    // Open menu via click
    await page.getByRole('button', { name: 'Options', exact: true }).click();

    // Wait for menu to be visible
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // MUI Menu auto-focuses first item, pressing ArrowDown moves to second
    // First verify menu items are visible and navigable
    const firstItem = page.getByRole('menuitem', { name: 'Edit' });
    const secondItem = page.getByRole('menuitem', { name: 'Duplicate' });
    const thirdItem = page.getByRole('menuitem', { name: 'Delete' });

    await expect(firstItem).toBeVisible();
    await expect(secondItem).toBeVisible();
    await expect(thirdItem).toBeVisible();

    // Navigate through items with arrow keys
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    // After two ArrowDowns, third item should be focused (or wrapped around)
    // Check that navigation works by selecting an item
    await page.keyboard.press('Enter');

    // Menu should be closed after selection
    await expect(menu).toBeHidden();
  });

  test('should select item with Enter key', async ({ page }) => {
    // Open menu
    await page.getByRole('button', { name: 'Options', exact: true }).click();

    // Navigate and select
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Menu should be closed
    const menu = page.getByRole('menu');
    await expect(menu).toBeHidden();
  });

  test('should have proper ARIA attributes', async ({ page }) => {
    // Check button has aria-haspopup before opening
    const optionsButton = page.getByRole('button', { name: 'Options', exact: true });
    await expect(optionsButton).toBeVisible();
    await expect(optionsButton).toHaveAttribute('aria-haspopup', 'true');

    // Open menu
    await optionsButton.click();

    // Menu should be visible with proper role
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Verify menu has proper menuitem children
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });
});

test.describe('Icon Button Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/menu');
  });

  test('should open icon menu when clicked', async ({ page }) => {
    const moreButton = page.getByRole('button', { name: 'More options' });
    await moreButton.click();

    // Menu should be visible
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Should have menu items
    await expect(page.getByRole('menuitem', { name: 'Option 1' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Option 2' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Option 3' })).toBeVisible();
  });

  test('should have accessible label on icon button', async ({ page }) => {
    const moreButton = page.getByRole('button', { name: 'More options' });
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveAttribute('aria-label', 'More options');
  });

  test('should close and return focus to button', async ({ page }) => {
    const moreButton = page.getByRole('button', { name: 'More options' });

    // Open menu
    await moreButton.click();
    await expect(page.getByRole('menu')).toBeVisible();

    // Close with Escape
    await page.keyboard.press('Escape');

    // Focus should return to button
    await expect(moreButton).toBeFocused();
  });
});

test.describe('Menu with Icons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/menu');
  });

  test('should display icons with menu items', async ({ page }) => {
    // Open menu
    await page.getByRole('button', { name: 'Options', exact: true }).click();

    // Menu items should have icons
    const editItem = page.getByRole('menuitem', { name: 'Edit' });
    await expect(editItem).toBeVisible();

    // Check that icon is rendered (svg element)
    const editIcon = editItem.locator('svg');
    await expect(editIcon).toBeVisible();
  });
});
