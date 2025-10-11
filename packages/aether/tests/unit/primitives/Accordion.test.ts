/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../../../src/primitives/Accordion.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Accordion', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Single type', () => {
    it('should render accordion with single type', () => {
      const component = () =>
        Accordion({
          type: 'single',
          defaultValue: 'item1',
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
            AccordionItem({
              value: 'item2', children: () => [
                AccordionTrigger({ children: 'Item 2' }),
                AccordionContent({ children: 'Content 2' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="button"]');
      expect(triggers.length).toBe(2);

      // First item should be open
      expect(triggers[0]?.getAttribute('aria-expanded')).toBe('true');
      expect(triggers[0]?.getAttribute('data-state')).toBe('open');

      // Content should be visible
      const content = container.querySelector('[role="region"]');
      expect(content?.textContent).toBe('Content 1');
    });

    it('should toggle items in single mode', () => {
      const component = () =>
        Accordion({
          type: 'single',
          defaultValue: 'item1',
          collapsible: true,
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
            AccordionItem({
              value: 'item2', children: () => [
                AccordionTrigger({ children: 'Item 2' }),
                AccordionContent({ children: 'Content 2' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="button"]') as NodeListOf<HTMLElement>;

      // Click second trigger
      triggers[1]?.click();

      // Second item should be open, first should be closed
      expect(triggers[1]?.getAttribute('aria-expanded')).toBe('true');
      expect(triggers[0]?.getAttribute('aria-expanded')).toBe('false');

      // Find visible content (not hidden)
      const contents = container.querySelectorAll('[role="region"]') as NodeListOf<HTMLElement>;
      const visibleContent = Array.from(contents).find(el => !el.hasAttribute('hidden') && el.style.display !== 'none');
      expect(visibleContent?.textContent).toBe('Content 2');
    });

    it('should support collapsible mode', () => {
      const component = () =>
        Accordion({
          type: 'single',
          defaultValue: 'item1',
          collapsible: true,
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="button"]') as HTMLElement;

      // Click to close
      trigger.click();

      // Item should be closed
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      // Content should be hidden (in DOM but not visible)
      const content = container.querySelector('[role="region"]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.hasAttribute('hidden')).toBe(true);
      expect(content.style.display).toBe('none');
    });

    it('should not collapse when collapsible is false', () => {
      const component = () =>
        Accordion({
          type: 'single',
          defaultValue: 'item1',
          collapsible: false,
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="button"]') as HTMLElement;

      // Try to close
      trigger.click();

      // Item should still be open
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      // Content should still be visible
      const content = container.querySelector('[role="region"]');
      expect(content?.textContent).toBe('Content 1');
    });
  });

  describe('Multiple type', () => {
    it('should allow multiple items open', () => {
      const component = () =>
        Accordion({
          type: 'multiple',
          defaultValue: ['item1', 'item2'],
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
            AccordionItem({
              value: 'item2', children: () => [
                AccordionTrigger({ children: 'Item 2' }),
                AccordionContent({ children: 'Content 2' }),
              ],
            }),
            AccordionItem({
              value: 'item3', children: () => [
                AccordionTrigger({ children: 'Item 3' }),
                AccordionContent({ children: 'Content 3' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="button"]');

      // First two items should be open
      expect(triggers[0]?.getAttribute('aria-expanded')).toBe('true');
      expect(triggers[1]?.getAttribute('aria-expanded')).toBe('true');
      expect(triggers[2]?.getAttribute('aria-expanded')).toBe('false');

      // Two contents should be visible (not hidden)
      const allContents = container.querySelectorAll('[role="region"]') as NodeListOf<HTMLElement>;
      const visibleContents = Array.from(allContents).filter(el => !el.hasAttribute('hidden') && el.style.display !== 'none');
      expect(visibleContents.length).toBe(2);
    });

    it('should toggle items independently in multiple mode', () => {
      const component = () =>
        Accordion({
          type: 'multiple',
          defaultValue: ['item1'],
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
            AccordionItem({
              value: 'item2', children: () => [
                AccordionTrigger({ children: 'Item 2' }),
                AccordionContent({ children: 'Content 2' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="button"]') as NodeListOf<HTMLElement>;

      // Click second trigger
      triggers[1]?.click();

      // Both items should be open
      expect(triggers[0]?.getAttribute('aria-expanded')).toBe('true');
      expect(triggers[1]?.getAttribute('aria-expanded')).toBe('true');

      // Both contents should be visible (not hidden)
      const allContents = container.querySelectorAll('[role="region"]') as NodeListOf<HTMLElement>;
      const visibleContents = Array.from(allContents).filter(el => !el.hasAttribute('hidden') && el.style.display !== 'none');
      expect(visibleContents.length).toBe(2);
    });

    it('should support controlled value in multiple mode', () => {
      const openItems = signal<string[]>(['item1']);

      const component = () =>
        Accordion({
          type: 'multiple',
          value: openItems,
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
            AccordionItem({
              value: 'item2', children: () => [
                AccordionTrigger({ children: 'Item 2' }),
                AccordionContent({ children: 'Content 2' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      // Initially only item1 is open (visible)
      let allContents = container.querySelectorAll('[role="region"]') as NodeListOf<HTMLElement>;
      let visibleContents = Array.from(allContents).filter(el => !el.hasAttribute('hidden') && el.style.display !== 'none');
      expect(visibleContents.length).toBe(1);
      expect(visibleContents[0]?.textContent).toBe('Content 1');

      // Change controlled value
      openItems.set(['item2']);

      // Now only item2 should be open (visible)
      allContents = container.querySelectorAll('[role="region"]') as NodeListOf<HTMLElement>;
      visibleContents = Array.from(allContents).filter(el => !el.hasAttribute('hidden') && el.style.display !== 'none');
      expect(visibleContents.length).toBe(1);
      expect(visibleContents[0]?.textContent).toBe('Content 2');
    });
  });

  describe('Disabled state', () => {
    it('should disable entire accordion', () => {
      const component = () =>
        Accordion({
          type: 'single',
          disabled: true,
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="button"]') as HTMLElement;
      expect(trigger.hasAttribute('disabled')).toBe(true);
      expect(trigger.getAttribute('data-disabled')).toBe('');
    });

    it('should disable individual items', () => {
      const component = () =>
        Accordion({
          type: 'single', children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
            AccordionItem({
              value: 'item2',
              disabled: true, children: () => [
                AccordionTrigger({ children: 'Item 2' }),
                AccordionContent({ children: 'Content 2' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="button"]') as NodeListOf<HTMLElement>;

      // First trigger should not be disabled
      expect(triggers[0]?.hasAttribute('disabled')).toBe(false);

      // Second trigger should be disabled
      expect(triggers[1]?.hasAttribute('disabled')).toBe(true);
      expect(triggers[1]?.getAttribute('data-disabled')).toBe('');

      // Clicking disabled trigger should not open it
      triggers[1]?.click();

      expect(triggers[1]?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const component = () =>
        Accordion({
          type: 'single',
          defaultValue: 'item1',
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="button"]') as HTMLElement;
      expect(trigger).toBeTruthy();
      expect(trigger.getAttribute('type')).toBe('button');
      expect(trigger.hasAttribute('aria-expanded')).toBe(true);
      expect(trigger.hasAttribute('aria-controls')).toBe(true);

      const content = container.querySelector('[role="region"]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.hasAttribute('aria-labelledby')).toBe(true);
    });
  });

  describe('forceMount', () => {
    it('should keep content mounted when forceMount is true', () => {
      const component = () =>
        Accordion({
          type: 'single',
          defaultValue: 'item1',
          children: () => [
            AccordionItem({
              value: 'item1', children: () => [
                AccordionTrigger({ children: 'Item 1' }),
                AccordionContent({ children: 'Content 1' }),
              ],
            }),
            AccordionItem({
              value: 'item2',
              children: () => [
                AccordionTrigger({ children: 'Item 2' }),
                AccordionContent({ forceMount: true, children: 'Content 2' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      // Both contents should be in the DOM
      const contents = container.querySelectorAll('[role="region"]');
      expect(contents.length).toBe(2);

      // First content should be visible
      expect(contents[0]?.hasAttribute('hidden')).toBe(false);
      // Second content should be hidden
      expect(contents[1]?.hasAttribute('hidden')).toBe(true);
    });
  });
});
