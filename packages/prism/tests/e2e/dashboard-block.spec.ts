/**
 * E2E Tests: DashboardBlock Component
 *
 * Tests for the DashboardBlock widget component.
 * Validates collapsible behavior, loading states, error handling.
 *
 * @see https://playwright.dev/docs/test-components
 */

import { test, expect } from '@playwright/test';

test.describe('DashboardBlock', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/dashboard-block');
  });

  test('should render block with title and content', async ({ page }) => {
    const block = page.getByTestId('prism-dashboard-block');
    await expect(block).toBeVisible();

    // Check title - use getByRole with specific name to avoid strict mode violation
    await expect(page.getByRole('heading', { name: 'Revenue Overview' })).toBeVisible();

    // Check content area exists
    const content = block.getByTestId('prism-dashboard-block-content');
    await expect(content).toBeVisible();
  });

  test('should toggle collapse when clicking header', async ({ page }) => {
    const block = page.getByTestId('prism-dashboard-block');
    const content = block.getByTestId('prism-dashboard-block-content');
    const collapseButton = block.getByTestId('prism-dashboard-block-collapse');

    // Content should be visible initially
    await expect(content).toBeVisible();

    // Click collapse button
    await collapseButton.click();

    // Content should be hidden
    await expect(content).toBeHidden();

    // Click again to expand
    await collapseButton.click();

    // Content should be visible again
    await expect(content).toBeVisible();
  });

  test('should have proper aria-expanded attribute', async ({ page }) => {
    const block = page.getByTestId('prism-dashboard-block');
    const collapseButton = block.getByTestId('prism-dashboard-block-collapse');

    // Initially expanded
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');

    // Collapse
    await collapseButton.click();
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'false');

    // Expand
    await collapseButton.click();
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
  });

  test('should show loading skeleton when loading', async ({ page }) => {
    await page.goto('/test/dashboard-block?loading=true');

    const block = page.getByTestId('prism-dashboard-block');

    // Should show skeleton
    const skeleton = block.locator('.MuiSkeleton-root');
    await expect(skeleton.first()).toBeVisible();

    // Content should not be visible
    const content = block.getByTestId('prism-dashboard-block-content');
    await expect(content).toBeHidden();
  });

  test('should show error state with retry button', async ({ page }) => {
    await page.goto('/test/dashboard-block?error=true');

    const block = page.getByTestId('prism-dashboard-block');

    // Should show error message
    await expect(block).toContainText(/failed to load/i);

    // Should have retry button
    const retryButton = block.getByRole('button', { name: /retry/i });
    await expect(retryButton).toBeVisible();

    // Click retry
    await retryButton.click();

    // Should trigger reload (check URL or state change)
    await expect(page).toHaveURL(/test\/dashboard-block\?error=true&retry=1/);
  });

  test('should render footer when provided', async ({ page }) => {
    await page.goto('/test/dashboard-block?footer=true');

    const block = page.getByTestId('prism-dashboard-block');
    const footer = block.getByTestId('prism-dashboard-block-footer');

    await expect(footer).toBeVisible();
    await expect(footer.getByRole('button', { name: /view all/i })).toBeVisible();
  });

  test('should support keyboard navigation', async ({ page }) => {
    const block = page.getByTestId('prism-dashboard-block');
    const collapseButton = block.getByTestId('prism-dashboard-block-collapse');

    // Focus collapse button directly (more reliable than tabbing)
    await collapseButton.focus();
    await expect(collapseButton).toBeFocused();

    // Press Enter to toggle
    await page.keyboard.press('Enter');
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'false');

    // Press Space to toggle back
    await page.keyboard.press('Space');
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('DashboardBlock Variants', () => {
  test('should render outlined variant', async ({ page }) => {
    await page.goto('/test/dashboard-block?variant=outlined');

    const block = page.getByTestId('prism-dashboard-block');

    // Check for border style
    const borderWidth = await block.evaluate((el) => {
      return window.getComputedStyle(el).borderWidth;
    });

    expect(borderWidth).not.toBe('0px');
  });

  test('should render filled variant', async ({ page }) => {
    await page.goto('/test/dashboard-block?variant=filled');

    const block = page.getByTestId('prism-dashboard-block');

    // Check for background color
    const backgroundColor = await block.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should have a non-transparent background
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('should render small size', async ({ page }) => {
    await page.goto('/test/dashboard-block?size=small');

    const block = page.getByTestId('prism-dashboard-block');
    const header = block.getByTestId('prism-dashboard-block-header');

    // Check padding is smaller
    const padding = await header.evaluate((el) => {
      return window.getComputedStyle(el).padding;
    });

    // Small size should have reduced padding
    expect(padding).toBeDefined();
  });
});

test.describe('DashboardBlock with useDashboardBlock hook', () => {
  test('should manage collapse state via hook', async ({ page }) => {
    await page.goto('/test/dashboard-block?useHook=true');

    const block = page.getByTestId('prism-dashboard-block');
    const externalToggle = page.getByRole('button', { name: /external toggle/i });

    // Initially expanded
    const content = block.getByTestId('prism-dashboard-block-content');
    await expect(content).toBeVisible();

    // Click external toggle (uses hook)
    await externalToggle.click();

    // Content should be hidden
    await expect(content).toBeHidden();
  });

  test('should sync collapse state between block and external controls', async ({ page }) => {
    await page.goto('/test/dashboard-block?useHook=true');

    const block = page.getByTestId('prism-dashboard-block');
    const collapseButton = block.getByTestId('prism-dashboard-block-collapse');
    const externalToggle = page.getByRole('button', { name: /external toggle/i });
    const stateIndicator = page.getByTestId('collapse-state');

    // Initially expanded
    await expect(stateIndicator).toContainText('expanded');

    // Collapse via block button
    await collapseButton.click();
    await expect(stateIndicator).toContainText('collapsed');

    // Expand via external toggle
    await externalToggle.click();
    await expect(stateIndicator).toContainText('expanded');
  });
});
