/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../src/primitives/Collapsible.js';
import { renderComponent, nextTick, createSpy } from '../../helpers/test-utils.js';

describe('Collapsible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render collapsible with default closed state', () => {
      const component = () =>
        Collapsible({
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;
      expect(root).toBeTruthy();
      expect(root.getAttribute('data-state')).toBe('closed');
    });

    it('should render collapsible with default open state', () => {
      const component = () =>
        Collapsible({
          defaultOpen: true,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;
      expect(root.getAttribute('data-state')).toBe('open');
    });

    it('should render trigger and content components', () => {
      const component = () =>
        Collapsible({
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({ children: 'Hidden content' }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]');
      expect(trigger).toBeTruthy();
      expect(trigger?.textContent).toBe('Toggle');

      // Content should be in DOM but hidden (Aether reactivity pattern)
      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.hidden).toBe(true);
      expect(content.style.display).toBe('none');
    });

    it('should toggle open state on trigger click', async () => {
      const component = () =>
        Collapsible({
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      const root = container.querySelector('[data-collapsible]') as HTMLElement;

      // Initially closed
      expect(root.getAttribute('data-state')).toBe('closed');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      // Click to open
      trigger.click();
      await nextTick();

      expect(root.getAttribute('data-state')).toBe('open');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      const content = container.querySelector('[data-collapsible-content]');
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Content');

      // Click to close
      trigger.click();
      await nextTick();

      expect(root.getAttribute('data-state')).toBe('closed');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('should show content when open', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: true,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({ children: 'Visible content' }),
          ],
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-collapsible-content]');
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Visible content');
      expect(content?.getAttribute('data-state')).toBe('open');
      expect(content?.hasAttribute('hidden')).toBe(false);
    });

    it('should hide content when closed', () => {
      const component = () =>
        Collapsible({
          defaultOpen: false,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({ children: 'Hidden content' }),
          ],
        });

      const { container } = renderComponent(component);

      // Content should be in DOM but hidden (Aether reactivity pattern)
      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.hidden).toBe(true);
      expect(content.style.display).toBe('none');
      expect(content.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('Controlled mode', () => {
    it('should support controlled open state', async () => {
      const open = signal(false);

      const component = () =>
        Collapsible({
          open,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;

      // Initially closed
      expect(root.getAttribute('data-state')).toBe('closed');

      // Change controlled value to open
      open.set(true);
      await nextTick();

      expect(root.getAttribute('data-state')).toBe('open');
      const content = container.querySelector('[data-collapsible-content]');
      expect(content).toBeTruthy();

      // Change back to closed
      open.set(false);
      await nextTick();

      expect(root.getAttribute('data-state')).toBe('closed');
    });

    it('should call onOpenChange callback', async () => {
      const onOpenChange = createSpy();

      const component = () =>
        Collapsible({
          onOpenChange,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;

      // Click to open
      trigger.click();
      await nextTick();

      expect(onOpenChange.callCount).toBe(1);
      expect(onOpenChange.calls[0][0]).toBe(true);

      // Click to close
      trigger.click();
      await nextTick();

      expect(onOpenChange.callCount).toBe(2);
      expect(onOpenChange.calls[1][0]).toBe(false);
    });

    it('should work with both controlled state and callback', async () => {
      const open = signal(false);
      const onOpenChange = createSpy();

      const component = () =>
        Collapsible({
          open,
          onOpenChange: (newValue: boolean) => {
            onOpenChange(newValue);
            open.set(newValue);
          },
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      const root = container.querySelector('[data-collapsible]') as HTMLElement;

      // Click to open
      trigger.click();
      await nextTick();

      expect(onOpenChange.callCount).toBe(1);
      expect(onOpenChange.calls[0][0]).toBe(true);
      expect(root.getAttribute('data-state')).toBe('open');
    });
  });

  describe('Disabled state', () => {
    it('should render disabled state', () => {
      const component = () =>
        Collapsible({
          disabled: true,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;
      expect(root.getAttribute('data-disabled')).toBe('');

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      expect(trigger.hasAttribute('disabled')).toBe(true);
    });

    it('should not toggle when disabled', async () => {
      const component = () =>
        Collapsible({
          disabled: true,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      const root = container.querySelector('[data-collapsible]') as HTMLElement;

      // Try to click
      trigger.click();
      await nextTick();

      // Should still be closed (button disabled attribute prevents click)
      expect(root.getAttribute('data-state')).toBe('closed');
    });

    it('should not call onOpenChange when disabled', async () => {
      const onOpenChange = createSpy();

      const component = () =>
        Collapsible({
          disabled: true,
          onOpenChange,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;

      // Try to click (won't work due to disabled attribute)
      trigger.click();
      await nextTick();

      expect(onOpenChange.callCount).toBe(0);
    });
  });

  describe('forceMount', () => {
    it('should keep content mounted when forceMount is true', () => {
      const component = () =>
        Collapsible({
          defaultOpen: false,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({ forceMount: true, children: 'Content' }),
          ],
        });

      const { container } = renderComponent(component);

      // Content should be in DOM but hidden
      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.getAttribute('data-state')).toBe('closed');
      expect(content.hasAttribute('hidden')).toBe(true);
    });

    it('should show content when opened with forceMount', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: false,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({ forceMount: true, children: 'Content' }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;

      // Initially hidden but mounted
      expect(content.hasAttribute('hidden')).toBe(true);

      // Click to open
      trigger.click();
      await nextTick();

      // Should be visible now
      expect(content.hasAttribute('hidden')).toBe(false);
      expect(content.getAttribute('data-state')).toBe('open');
    });

    it('should apply display none style when closed without forceMount', () => {
      const component = () =>
        Collapsible({
          defaultOpen: false,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      // Content should be in DOM but hidden (Aether always renders elements)
      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('none');
      expect(content.hidden).toBe(true);
      expect(content.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes on trigger', () => {
      const component = () =>
        Collapsible({
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      expect(trigger.getAttribute('type')).toBe('button');
      expect(trigger.hasAttribute('aria-expanded')).toBe(true);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.hasAttribute('aria-controls')).toBe(true);
    });

    it('should update aria-expanded when toggled', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: false,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;

      // Initially collapsed
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      // Click to expand
      trigger.click();
      await nextTick();

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('should link trigger and content with IDs', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: true,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;

      const triggerId = trigger.id;
      const contentId = content.id;

      expect(triggerId).toBeTruthy();
      expect(contentId).toBeTruthy();
      expect(trigger.getAttribute('aria-controls')).toBe(contentId);
    });

    it('should have data-state attributes', async () => {
      const component = () =>
        Collapsible({
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;
      const trigger = container.querySelector('button[type="button"]') as HTMLElement;

      // Initially closed
      expect(root.getAttribute('data-state')).toBe('closed');
      expect(trigger.getAttribute('data-state')).toBe('closed');

      // Click to open
      trigger.click();
      await nextTick();

      expect(root.getAttribute('data-state')).toBe('open');
      expect(trigger.getAttribute('data-state')).toBe('open');

      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;
      expect(content.getAttribute('data-state')).toBe('open');
    });
  });

  describe('Custom props', () => {
    it('should pass through custom props to root', () => {
      const component = () =>
        Collapsible({
          class: 'custom-class',
          'data-testid': 'collapsible-root',
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;
      expect(root.className).toBe('custom-class');
      expect(root.getAttribute('data-testid')).toBe('collapsible-root');
    });

    it('should pass through custom props to trigger', () => {
      const component = () =>
        Collapsible({
          children: () => [
            CollapsibleTrigger({
              class: 'custom-trigger',
              'data-testid': 'trigger',
              children: 'Toggle',
            }),
            CollapsibleContent({ children: 'Content' }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      expect(trigger.className).toBe('custom-trigger');
      expect(trigger.getAttribute('data-testid')).toBe('trigger');
    });

    it('should pass through custom props to content', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: true,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({
              class: 'custom-content',
              'data-testid': 'content',
              children: 'Content',
            }),
          ],
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;
      expect(content.className).toBe('custom-content');
      expect(content.getAttribute('data-testid')).toBe('content');
    });

    it('should merge custom styles with content styles', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: false,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({
              forceMount: true,
              style: { backgroundColor: 'red' },
              children: 'Content',
            }),
          ],
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;
      expect(content.style.backgroundColor).toBe('red');
    });
  });

  describe('Edge cases', () => {
    it('should handle rapid toggling', async () => {
      const component = () =>
        Collapsible({
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      const root = container.querySelector('[data-collapsible]') as HTMLElement;

      // Rapid clicks
      trigger.click();
      trigger.click();
      trigger.click();
      await nextTick();

      // Should end up in open state (3 clicks = closed -> open -> closed -> open)
      expect(root.getAttribute('data-state')).toBe('open');
    });

    it('should handle no content', () => {
      const component = () =>
        Collapsible({
          children: CollapsibleTrigger({ children: 'Toggle' }),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]');
      expect(root).toBeTruthy();

      const trigger = container.querySelector('button[type="button"]');
      expect(trigger).toBeTruthy();
    });

    it('should handle empty children in content', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: true,
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({})],
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-collapsible-content]');
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('');
    });

    it('should handle switching from uncontrolled to controlled', async () => {
      const open = signal(false);

      const component = () =>
        Collapsible({
          open,
          defaultOpen: true, // Should be ignored when open is provided
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;

      // Should use controlled value, not defaultOpen
      expect(root.getAttribute('data-state')).toBe('closed');

      open.set(true);
      await nextTick();

      expect(root.getAttribute('data-state')).toBe('open');
    });

    it('should handle multiple content sections', async () => {
      const component = () =>
        Collapsible({
          defaultOpen: true,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({ children: 'Content 1' }),
            CollapsibleContent({ children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      const contents = container.querySelectorAll('[data-collapsible-content]');
      expect(contents.length).toBe(2);
      expect(contents[0]?.textContent).toBe('Content 1');
      expect(contents[1]?.textContent).toBe('Content 2');
    });
  });

  describe('State synchronization', () => {
    it('should synchronize state between trigger and content', async () => {
      const component = () =>
        Collapsible({
          children: () => [CollapsibleTrigger({ children: 'Toggle' }), CollapsibleContent({ children: 'Content' })],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('button[type="button"]') as HTMLElement;

      trigger.click();
      await nextTick();

      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;

      expect(trigger.getAttribute('data-state')).toBe('open');
      expect(content.getAttribute('data-state')).toBe('open');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('should update all states when controlled value changes', async () => {
      const open = signal(false);

      const component = () =>
        Collapsible({
          open,
          children: () => [
            CollapsibleTrigger({ children: 'Toggle' }),
            CollapsibleContent({ forceMount: true, children: 'Content' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[data-collapsible]') as HTMLElement;
      const trigger = container.querySelector('button[type="button"]') as HTMLElement;
      const content = container.querySelector('[data-collapsible-content]') as HTMLElement;

      open.set(true);
      await nextTick();

      expect(root.getAttribute('data-state')).toBe('open');
      expect(trigger.getAttribute('data-state')).toBe('open');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(content.getAttribute('data-state')).toBe('open');
      expect(content.hasAttribute('hidden')).toBe(false);
    });
  });
});
