/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../src/primitives/Tabs.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render tabs with default value', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      // Check that tab list exists
      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toBeTruthy();

      // Check that triggers exist
      const triggers = container.querySelectorAll('[role="tab"]');
      expect(triggers.length).toBe(2);

      // Check that first tab is selected
      expect(triggers[0]?.getAttribute('aria-selected')).toBe('true');
      expect(triggers[0]?.getAttribute('data-state')).toBe('active');
      expect(triggers[1]?.getAttribute('aria-selected')).toBe('false');

      // Check that first content is visible
      // Note: All tabpanels are now in DOM (framework limitation), but inactive ones are hidden
      const contents = container.querySelectorAll('[role="tabpanel"]');
      expect(contents.length).toBe(2); // All content is rendered

      // Find the visible content (not display:none)
      const visibleContent = Array.from(contents).find(
        (el) => (el as HTMLElement).style.display !== 'none'
      );
      expect(visibleContent?.textContent).toBe('Content 1');
    });

    it('should switch tabs when trigger is clicked', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      // Click second tab
      triggers[1]?.click();

      // Check that second tab is now selected
      expect(triggers[1]?.getAttribute('aria-selected')).toBe('true');
      expect(triggers[1]?.getAttribute('data-state')).toBe('active');

      // Check that second content is visible
      // Find the visible content (not display:none)
      const contents = container.querySelectorAll('[role="tabpanel"]');
      const visibleContent = Array.from(contents).find(
        (el) => (el as HTMLElement).style.display !== 'none'
      );
      expect(visibleContent?.textContent).toBe('Content 2');
    });

    it('should support controlled value', () => {
      const activeTab = signal('tab1');

      const component = () =>
        Tabs({
          value: activeTab,
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      // Initially tab1 is active
      let contents = container.querySelectorAll('[role="tabpanel"]');
      let visibleContent = Array.from(contents).find(
        (el) => (el as HTMLElement).style.display !== 'none'
      );
      expect(visibleContent?.textContent).toBe('Content 1');

      // Change controlled value
      activeTab.set('tab2');

      // Check that tab2 is now active
      contents = container.querySelectorAll('[role="tabpanel"]');
      visibleContent = Array.from(contents).find(
        (el) => (el as HTMLElement).style.display !== 'none'
      );
      expect(visibleContent?.textContent).toBe('Content 2');
    });
  });

  describe('Orientation', () => {
    it('should support horizontal orientation (default)', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should support vertical orientation', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          orientation: 'vertical',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist?.getAttribute('aria-orientation')).toBe('vertical');
    });
  });

  describe('Keyboard navigation', () => {
    // SKIP: Requires real browser focus support - happy-dom cannot track focus during keyboard navigation
    it.skip('should navigate with arrow keys (horizontal)', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          activationMode: 'manual',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
                TabsTrigger({ value: 'tab3', children: 'Tab 3' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
            TabsContent({ value: 'tab3', children: 'Content 3' }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;
      const tablist = container.querySelector('[role="tablist"]') as HTMLElement;

      // Focus first tab
      triggers[0]?.focus();
      expect(document.activeElement).toBe(triggers[0]);

      // Press ArrowRight
      const arrowRightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      tablist.dispatchEvent(arrowRightEvent);

      // Second tab should be focused (not necessarily active in manual mode)
      expect(document.activeElement).toBe(triggers[1]);

      // Press ArrowRight again
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      // Third tab should be focused
      expect(document.activeElement).toBe(triggers[2]);
    });

    // SKIP: Requires real browser focus support - happy-dom limitation
    it.skip('should navigate with Home/End keys', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab2',
          activationMode: 'manual',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
                TabsTrigger({ value: 'tab3', children: 'Tab 3' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
            TabsContent({ value: 'tab3', children: 'Content 3' }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;
      const tablist = container.querySelector('[role="tablist"]') as HTMLElement;

      // Focus second tab
      triggers[1]?.focus();

      // Press End
      const endEvent = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      tablist.dispatchEvent(endEvent);

      // Last tab should be focused
      expect(document.activeElement).toBe(triggers[2]);

      // Press Home
      const homeEvent = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      tablist.dispatchEvent(homeEvent);

      // First tab should be focused
      expect(document.activeElement).toBe(triggers[0]);
    });
  });

  describe('Disabled state', () => {
    it('should disable individual tabs', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', disabled: true, children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      // Second trigger should be disabled
      expect(triggers[1]?.hasAttribute('disabled')).toBe(true);
      expect(triggers[1]?.getAttribute('data-disabled')).toBe('');

      // Clicking disabled trigger should not change active tab
      triggers[1]?.click();

      // Find the visible content (not display:none)
      const contents = container.querySelectorAll('[role="tabpanel"]');
      const visibleContent = Array.from(contents).find(
        (el) => (el as HTMLElement).style.display !== 'none'
      );
      expect(visibleContent?.textContent).toBe('Content 1'); // Still showing first content
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toBeTruthy();

      const triggers = container.querySelectorAll('[role="tab"]');
      expect(triggers.length).toBe(2);

      const trigger = triggers[0] as HTMLElement;
      expect(trigger.getAttribute('role')).toBe('tab');
      expect(trigger.getAttribute('type')).toBe('button');
      expect(trigger.hasAttribute('aria-selected')).toBe(true);
      expect(trigger.hasAttribute('aria-controls')).toBe(true);

      const content = container.querySelector('[role="tabpanel"]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.hasAttribute('aria-labelledby')).toBe(true);
    });

    it('should manage tabindex correctly', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
                TabsTrigger({ value: 'tab3', children: 'Tab 3' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      // Active tab should have tabindex 0
      expect(triggers[0]?.getAttribute('tabindex')).toBe('0');

      // Inactive tabs should have tabindex -1
      expect(triggers[1]?.getAttribute('tabindex')).toBe('-1');
      expect(triggers[2]?.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('forceMount', () => {
    it('should keep content mounted when forceMount is true', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', forceMount: true, children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      // Both contents should be in the DOM (all content is always rendered due to framework limitation)
      const contents = container.querySelectorAll('[role="tabpanel"]');
      expect(contents.length).toBe(2);

      // First content should be visible (display: '' or not 'none')
      expect((contents[0] as HTMLElement).style.display).not.toBe('none');
      // Second content should be hidden (display: 'none')
      expect((contents[1] as HTMLElement).style.display).toBe('none');
    });
  });
});
