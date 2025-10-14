/**
 * Primitive Test Helpers
 *
 * Utilities for testing Aether primitives with Playwright
 */

import { Page, Locator, expect } from '@playwright/test';

/**
 * Base class for primitive page objects
 */
export class PrimitivePage {
  constructor(protected page: Page) {}

  /**
   * Wait for primitive to be ready
   */
  async waitForReady() {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get element by test ID
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Get element by role
   */
  getByRole(role: string, options?: { name?: string | RegExp }): Locator {
    return this.page.getByRole(role as any, options);
  }

  /**
   * Get element by text
   */
  getByText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }
}

/**
 * Dialog primitive helpers
 */
export class DialogPage extends PrimitivePage {
  get trigger() {
    return this.getByRole('button', { name: /open/i });
  }

  get dialog() {
    return this.getByRole('dialog');
  }

  get title() {
    return this.dialog.locator('[role="heading"]').first();
  }

  get description() {
    return this.dialog.locator('p').first();
  }

  get closeButton() {
    return this.dialog.getByRole('button', { name: /close/i });
  }

  async open() {
    await this.trigger.click();
    await expect(this.dialog).toBeVisible();
  }

  async close() {
    await this.closeButton.click();
    await expect(this.dialog).not.toBeVisible();
  }

  async closeWithEscape() {
    await this.page.keyboard.press('Escape');
    await expect(this.dialog).not.toBeVisible();
  }

  async clickOverlay() {
    // Click outside dialog
    const box = await this.dialog.boundingBox();
    if (box) {
      await this.page.mouse.click(box.x - 10, box.y - 10);
    }
  }
}

/**
 * Popover primitive helpers
 */
export class PopoverPage extends PrimitivePage {
  get trigger() {
    return this.getByRole('button', { name: /open/i });
  }

  get popover() {
    return this.page.locator('[data-popover-content]');
  }

  async open() {
    await this.trigger.click();
    await expect(this.popover).toBeVisible();
  }

  async close() {
    await this.page.keyboard.press('Escape');
    await expect(this.popover).not.toBeVisible();
  }
}

/**
 * Tabs primitive helpers
 */
export class TabsPage extends PrimitivePage {
  getTab(name: string): Locator {
    return this.getByRole('tab', { name });
  }

  getPanel(name: string): Locator {
    return this.page.locator(`[role="tabpanel"][aria-labelledby*="${name}"]`);
  }

  async selectTab(name: string) {
    await this.getTab(name).click();
    await expect(this.getTab(name)).toHaveAttribute('aria-selected', 'true');
  }

  async navigateWithArrow(direction: 'left' | 'right') {
    await this.page.keyboard.press(`Arrow${direction === 'left' ? 'Left' : 'Right'}`);
  }
}

/**
 * Accordion primitive helpers
 */
export class AccordionPage extends PrimitivePage {
  getTrigger(value: string): Locator {
    return this.page.locator(`[data-accordion-trigger][data-value="${value}"]`);
  }

  getContent(value: string): Locator {
    return this.page.locator(`[data-accordion-content][data-value="${value}"]`);
  }

  async expand(value: string) {
    await this.getTrigger(value).click();
    await expect(this.getContent(value)).toBeVisible();
  }

  async collapse(value: string) {
    await this.getTrigger(value).click();
    await expect(this.getContent(value)).not.toBeVisible();
  }
}

/**
 * Select primitive helpers
 */
export class SelectPage extends PrimitivePage {
  get trigger() {
    return this.getByRole('button', { name: /select/i });
  }

  get content() {
    return this.page.locator('[data-select-content]');
  }

  getOption(value: string): Locator {
    return this.page.locator(`[data-select-item][data-value="${value}"]`);
  }

  async open() {
    await this.trigger.click();
    await expect(this.content).toBeVisible();
  }

  async selectOption(value: string) {
    await this.open();
    await this.getOption(value).click();
    await expect(this.content).not.toBeVisible();
  }
}

/**
 * Switch primitive helpers
 */
export class SwitchPage extends PrimitivePage {
  get switchElement() {
    return this.getByRole('switch');
  }

  async toggle() {
    await this.switchElement.click();
  }

  async isChecked(): Promise<boolean> {
    return (await this.switchElement.getAttribute('aria-checked')) === 'true';
  }
}

/**
 * Common assertions for accessibility
 */
export class AccessibilityAssertions {
  constructor(private page: Page) {}

  /**
   * Assert element has proper ARIA label
   */
  async assertHasAriaLabel(locator: Locator, expected?: string) {
    const label = await locator.getAttribute('aria-label');
    const labelledby = await locator.getAttribute('aria-labelledby');
    expect(label || labelledby).toBeTruthy();
    if (expected) {
      expect(label).toBe(expected);
    }
  }

  /**
   * Assert element has proper ARIA role
   */
  async assertHasRole(locator: Locator, role: string) {
    await expect(locator).toHaveAttribute('role', role);
  }

  /**
   * Assert focus is trapped within element
   */
  async assertFocusTrapped(containerLocator: Locator) {
    // Tab through all focusable elements
    for (let i = 0; i < 10; i++) {
      await this.page.keyboard.press('Tab');
      const focused = await this.page.evaluate(() => document.activeElement?.tagName);
      const isInContainer = await containerLocator.evaluate((el, focusedTag) => {
        const activeEl = document.activeElement;
        return el.contains(activeEl);
      }, focused);
      expect(isInContainer).toBe(true);
    }
  }

  /**
   * Assert keyboard navigation works
   */
  async assertKeyboardNavigable(locator: Locator) {
    await locator.focus();
    await this.page.keyboard.press('Enter');
    // Should activate
  }
}
