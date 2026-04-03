/**
 * E2E Tests: Tabs Components
 *
 * Tests for tab navigation and panel switching.
 * Validates user interactions, accessibility, and keyboard navigation.
 *
 * @see https://playwright.dev/docs/test-components
 */

import { test, expect } from '@playwright/test';

test.describe('Horizontal Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/tabs');
  });

  test('should render all tabs', async ({ page }) => {
    const tabs = page.getByTestId('horizontal-tabs');
    await expect(tabs).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'History' })).toBeVisible();
  });

  test('should show first tab content by default', async ({ page }) => {
    const overviewContent = page.getByTestId('content-overview');
    await expect(overviewContent).toBeVisible();
    await expect(overviewContent).toContainText('Overview content');

    // Other tab panels should be hidden
    await expect(page.getByTestId('content-details')).toBeHidden();
    await expect(page.getByTestId('content-settings')).toBeHidden();
    await expect(page.getByTestId('content-history')).toBeHidden();
  });

  test('should switch tabs on click', async ({ page }) => {
    // Click Details tab
    await page.getByRole('tab', { name: 'Details' }).click();

    // Details content should be visible
    await expect(page.getByTestId('content-details')).toBeVisible();
    await expect(page.getByTestId('content-overview')).toBeHidden();

    // Click Settings tab
    await page.getByRole('tab', { name: 'Settings' }).click();

    // Settings content should be visible
    await expect(page.getByTestId('content-settings')).toBeVisible();
    await expect(page.getByTestId('content-details')).toBeHidden();
  });

  test('should have proper aria-selected attribute', async ({ page }) => {
    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    const detailsTab = page.getByRole('tab', { name: 'Details' });

    // Initially Overview is selected
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    await expect(detailsTab).toHaveAttribute('aria-selected', 'false');

    // Click Details
    await detailsTab.click();

    // Now Details is selected
    await expect(overviewTab).toHaveAttribute('aria-selected', 'false');
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should support keyboard navigation with arrow keys', async ({ page }) => {
    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    const detailsTab = page.getByRole('tab', { name: 'Details' });

    // Focus first tab
    await overviewTab.focus();
    await expect(overviewTab).toBeFocused();

    // Press right arrow to move to next tab
    await page.keyboard.press('ArrowRight');
    await expect(detailsTab).toBeFocused();

    // Press Enter to select
    await page.keyboard.press('Enter');
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('content-details')).toBeVisible();
  });

  test('should navigate tabs with left/right arrow keys', async ({ page }) => {
    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    const historyTab = page.getByRole('tab', { name: 'History' });

    // Focus first tab
    await overviewTab.focus();

    // Navigate to last tab
    await page.keyboard.press('ArrowRight'); // Details
    await page.keyboard.press('ArrowRight'); // Settings
    await page.keyboard.press('ArrowRight'); // History

    // History tab should be focused
    await expect(historyTab).toBeFocused();

    // Press left to go back
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeFocused();
  });

  test('should have proper ARIA attributes', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'Demo tabs' });
    await expect(tablist).toBeVisible();

    // Check tab-panel association
    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    const tabId = await overviewTab.getAttribute('id');
    const ariaControls = await overviewTab.getAttribute('aria-controls');

    // Panel should reference the tab
    const panel = page.locator(`#${ariaControls}`);
    await expect(panel).toHaveAttribute('aria-labelledby', tabId!);
  });
});

test.describe('Vertical Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/tabs');
  });

  test('should render vertical tabs', async ({ page }) => {
    const verticalTabs = page.getByTestId('vertical-tabs');
    await expect(verticalTabs).toBeVisible();

    await expect(page.getByTestId('vtab-1')).toBeVisible();
    await expect(page.getByTestId('vtab-2')).toBeVisible();
    await expect(page.getByTestId('vtab-3')).toBeVisible();
  });

  test('should show first item content by default', async ({ page }) => {
    await expect(page.getByTestId('vcontent-1')).toBeVisible();
  });

  test('should switch content on tab click', async ({ page }) => {
    // Click Item Two
    await page.getByTestId('vtab-2').click();

    // Content should change
    await expect(page.getByTestId('vcontent-2')).toBeVisible();
    await expect(page.getByTestId('vcontent-1')).toBeHidden();

    // Click Item Three
    await page.getByTestId('vtab-3').click();
    await expect(page.getByTestId('vcontent-3')).toBeVisible();
    await expect(page.getByTestId('vcontent-2')).toBeHidden();
  });

  test('should support up/down arrow navigation', async ({ page }) => {
    const tab1 = page.getByTestId('vtab-1');
    const tab2 = page.getByTestId('vtab-2');
    const tab3 = page.getByTestId('vtab-3');

    // Focus first tab
    await tab1.focus();

    // Press down arrow
    await page.keyboard.press('ArrowDown');
    await expect(tab2).toBeFocused();

    // Press down again
    await page.keyboard.press('ArrowDown');
    await expect(tab3).toBeFocused();

    // Press up to go back
    await page.keyboard.press('ArrowUp');
    await expect(tab2).toBeFocused();
  });
});

test.describe('Disabled Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/tabs');
  });

  test('should render disabled tab', async ({ page }) => {
    const disabledTab = page.getByTestId('tab-disabled');
    await expect(disabledTab).toBeVisible();
    await expect(disabledTab).toBeDisabled();
  });

  test('should not select disabled tab on click', async ({ page }) => {
    const disabledTab = page.getByTestId('tab-disabled');
    const activeTab = page.getByTestId('tab-active');

    // Try to click disabled tab
    await disabledTab.click({ force: true });

    // Active tab should still be selected
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
  });

  test('disabled tab should have disabled attribute', async ({ page }) => {
    const disabledTab = page.getByTestId('tab-disabled');
    await expect(disabledTab).toBeDisabled();
  });
});

test.describe('Tab Focus Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/tabs');
  });

  test('should maintain focus on tab after selection', async ({ page }) => {
    const detailsTab = page.getByRole('tab', { name: 'Details' });

    // Click tab
    await detailsTab.click();

    // Tab should remain focused
    await expect(detailsTab).toBeFocused();
  });

  test('should be able to tab into tab panel content', async ({ page }) => {
    // Click Details tab
    await page.getByRole('tab', { name: 'Details' }).click();

    // Tab into panel
    await page.keyboard.press('Tab');

    // Content should be reachable (focus should move into panel area)
    const panel = page.getByTestId('tabpanel-1');
    await expect(panel).toBeVisible();
  });
});
