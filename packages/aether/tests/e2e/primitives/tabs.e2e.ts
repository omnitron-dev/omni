/**
 * Tabs Primitive E2E Tests
 *
 * Tests for Tabs primitive accessibility, keyboard navigation, and functionality
 */

import { test, expect } from '@playwright/test';
import { TabsPage, AccessibilityAssertions } from './utils/primitive-test-helpers';

test.describe('Tabs Primitive', () => {
  let tabs: TabsPage;
  let a11y: AccessibilityAssertions;

  test.beforeEach(async ({ page }) => {
    test.skip(true, 'Requires dev server with primitive examples');

    await page.goto('/primitives/tabs');
    tabs = new TabsPage(page);
    a11y = new AccessibilityAssertions(page);
    await tabs.waitForReady();
  });

  test.describe('Basic Functionality', () => {
    test('should display first tab content by default', async () => {
      const tab1 = tabs.getTab('Tab 1');
      const panel1 = tabs.getPanel('Tab 1');

      await expect(tab1).toHaveAttribute('aria-selected', 'true');
      await expect(panel1).toBeVisible();
    });

    test('should switch tabs on click', async () => {
      await tabs.selectTab('Tab 2');

      const panel2 = tabs.getPanel('Tab 2');
      await expect(panel2).toBeVisible();
    });

    test('should hide inactive tab panels', async () => {
      await tabs.selectTab('Tab 2');

      const panel1 = tabs.getPanel('Tab 1');
      await expect(panel1).not.toBeVisible();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should navigate tabs with Arrow keys', async ({ page }) => {
      const tab1 = tabs.getTab('Tab 1');
      await tab1.focus();

      // Arrow Right should move to next tab
      await tabs.navigateWithArrow('right');

      const tab2 = tabs.getTab('Tab 2');
      await expect(tab2).toBeFocused();
    });

    test('should navigate tabs with Arrow Left', async ({ page }) => {
      const tab2 = tabs.getTab('Tab 2');
      await tab2.focus();

      // Arrow Left should move to previous tab
      await tabs.navigateWithArrow('left');

      const tab1 = tabs.getTab('Tab 1');
      await expect(tab1).toBeFocused();
    });

    test('should support Home key', async ({ page }) => {
      const tab3 = tabs.getTab('Tab 3');
      await tab3.focus();

      await page.keyboard.press('Home');

      const tab1 = tabs.getTab('Tab 1');
      await expect(tab1).toBeFocused();
    });

    test('should support End key', async ({ page }) => {
      const tab1 = tabs.getTab('Tab 1');
      await tab1.focus();

      await page.keyboard.press('End');

      const tab3 = tabs.getTab('Tab 3');
      await expect(tab3).toBeFocused();
    });

    test('should activate tab on Enter key', async ({ page }) => {
      const tab2 = tabs.getTab('Tab 2');
      await tab2.focus();
      await page.keyboard.press('Enter');

      await expect(tab2).toHaveAttribute('aria-selected', 'true');

      const panel2 = tabs.getPanel('Tab 2');
      await expect(panel2).toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA roles', async () => {
      const tabList = tabs.page.locator('[role="tablist"]');
      await expect(tabList).toBeVisible();

      const tab1 = tabs.getTab('Tab 1');
      await a11y.assertHasRole(tab1, 'tab');

      const panel1 = tabs.getPanel('Tab 1');
      await a11y.assertHasRole(panel1, 'tabpanel');
    });

    test('should have proper ARIA attributes', async () => {
      const tab1 = tabs.getTab('Tab 1');

      // Should have aria-selected
      await expect(tab1).toHaveAttribute('aria-selected', 'true');

      // Should have aria-controls
      const tabId = await tab1.getAttribute('id');
      const panelId = await tab1.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();

      // Panel should have matching aria-labelledby
      const panel = tabs.page.locator(`[id="${panelId}"]`);
      await expect(panel).toHaveAttribute('aria-labelledby', tabId);
    });

    test('should support keyboard focus', async () => {
      const tab1 = tabs.getTab('Tab 1');
      await expect(tab1).toHaveAttribute('tabindex', '0');
    });

    test('should remove tabindex from inactive tabs', async () => {
      const tab2 = tabs.getTab('Tab 2');
      const tab3 = tabs.getTab('Tab 3');

      // Inactive tabs should have tabindex="-1"
      await expect(tab2).toHaveAttribute('tabindex', '-1');
      await expect(tab3).toHaveAttribute('tabindex', '-1');
    });
  });

  test.describe('Orientation', () => {
    test('should support horizontal orientation', async ({ page }) => {
      const tabList = page.locator('[role="tablist"]');
      await expect(tabList).toHaveAttribute('aria-orientation', 'horizontal');
    });

    test('should support vertical orientation', async ({ page }) => {
      // Navigate to vertical tabs example
      test.skip(true, 'Requires vertical tabs example');

      const tabList = page.locator('[role="tablist"]');
      await expect(tabList).toHaveAttribute('aria-orientation', 'vertical');

      // Arrow Down should navigate in vertical mode
      const tab1 = tabs.getTab('Tab 1');
      await tab1.focus();
      await page.keyboard.press('ArrowDown');

      const tab2 = tabs.getTab('Tab 2');
      await expect(tab2).toBeFocused();
    });
  });

  test.describe('Activation Mode', () => {
    test('should support automatic activation', async ({ page }) => {
      // In automatic mode, focus = activation
      const tab2 = tabs.getTab('Tab 2');
      await tab2.focus();

      // Should automatically activate
      await expect(tab2).toHaveAttribute('aria-selected', 'true');

      const panel2 = tabs.getPanel('Tab 2');
      await expect(panel2).toBeVisible();
    });

    test('should support manual activation', async ({ page }) => {
      // Navigate to manual activation example
      test.skip(true, 'Requires manual activation example');

      // In manual mode, focus != activation
      const tab2 = tabs.getTab('Tab 2');
      await tabs.navigateWithArrow('right');
      await expect(tab2).toBeFocused();

      // Should not activate automatically
      await expect(tab2).toHaveAttribute('aria-selected', 'false');

      // Need to press Enter/Space to activate
      await page.keyboard.press('Enter');
      await expect(tab2).toHaveAttribute('aria-selected', 'true');
    });
  });
});
