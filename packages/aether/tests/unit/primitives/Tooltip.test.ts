/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipArrow,
} from '../../../src/primitives/Tooltip.js';
import { renderComponent, nextTick, createSpy } from '../../helpers/test-utils.js';

describe('Tooltip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tooltip Root - Basic Rendering', () => {
    it('should render tooltip root with children', () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Hover me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('button')).toBeTruthy();
    });

    it('should render trigger button', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button');
      expect(trigger).toBeTruthy();
      expect(trigger?.textContent).toBe('Trigger');
    });

    it('should render with default delay duration', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button');
      expect(trigger).toBeTruthy();
    });

    it('should render with custom delay duration', () => {
      const component = () =>
        Tooltip({
          delayDuration: 500,
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button');
      expect(trigger).toBeTruthy();
    });

    it('should render with close delay', () => {
      const component = () =>
        Tooltip({
          closeDelay: 200,
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button');
      expect(trigger).toBeTruthy();
    });

    it('should render when disabled', () => {
      const component = () =>
        Tooltip({
          disabled: true,
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button');
      expect(trigger).toBeTruthy();
    });
  });

  describe('TooltipTrigger - Rendering', () => {
    it('should render as button element', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Hover me' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button');
      expect(trigger).toBeTruthy();
      expect(trigger?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;
      expect(trigger.type).toBe('button');
    });

    it('should have unique id', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;
      expect(trigger.id).toContain('tooltip');
      expect(trigger.id).toContain('-trigger');
    });

    it('should have data-state="closed" initially', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;
      expect(trigger.getAttribute('data-state')).toBe('closed');
    });

    it('should render text children', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Click me' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button');
      expect(trigger?.textContent).toBe('Click me');
    });

    it('should forward custom props', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({
            children: 'Trigger',
            'data-testid': 'custom-trigger',
          }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('[data-testid="custom-trigger"]');
      expect(trigger).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({
            children: 'Trigger',
            class: 'custom-trigger',
          }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('.custom-trigger');
      expect(trigger).toBeTruthy();
    });
  });

  describe('TooltipTrigger - Interactions', () => {
    it('should show tooltip after delay on pointer enter', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Hover me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

      // Before delay
      expect(container.querySelector('[role="tooltip"]')).toBeNull();

      // After delay
      vi.advanceTimersByTime(700);
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should hide tooltip on pointer leave', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Hover me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      // Show tooltip
      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);
      await nextTick();
      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();

      // Hide tooltip
      trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      await nextTick();
      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('should show tooltip immediately on focus', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Focus me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should hide tooltip on blur', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Focus me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      // Show tooltip
      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();
      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();

      // Hide tooltip
      trigger.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      await nextTick();
      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('should cancel open timeout on pointer leave before delay', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Hover me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(300); // Before 700ms delay

      trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      vi.advanceTimersByTime(700);
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('should not show tooltip when disabled', async () => {
      const component = () =>
        Tooltip({
          disabled: true,
          children: () => [
            TooltipTrigger({ children: 'Hover me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('should not show tooltip on focus when disabled', async () => {
      const component = () =>
        Tooltip({
          disabled: true,
          children: () => [
            TooltipTrigger({ children: 'Focus me' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });
  });

  describe('TooltipTrigger - ARIA Attributes', () => {
    it('should not have aria-describedby when closed', () => {
      const component = () =>
        Tooltip({
          children: () => TooltipTrigger({ children: 'Trigger' }),
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;
      expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    });

    it('should have aria-describedby when open', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(trigger.getAttribute('aria-describedby')).toContain('tooltip');
      expect(trigger.getAttribute('aria-describedby')).toContain('-content');
    });

    it('should update data-state to open when tooltip shows', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      expect(trigger.getAttribute('data-state')).toBe('closed');

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(trigger.getAttribute('data-state')).toBe('open');
    });
  });

  describe('TooltipContent - Rendering', () => {
    it('should not render when tooltip is closed', () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('should render when tooltip is open', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]');
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Tooltip text');
    });

    it('should render with forceMount even when closed', () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ forceMount: true, children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should have role="tooltip"', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]');
      expect(content?.getAttribute('role')).toBe('tooltip');
    });

    it('should have unique id', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]') as HTMLElement;
      expect(content.id).toContain('tooltip');
      expect(content.id).toContain('-content');
    });

    it('should have data-state="open" when visible', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]') as HTMLElement;
      expect(content.getAttribute('data-state')).toBe('open');
    });

    it('should have data-state="closed" with forceMount when not open', () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ forceMount: true, children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const content = container.querySelector('[role="tooltip"]') as HTMLElement;
      expect(content.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('TooltipContent - Positioning Props', () => {
    it('should accept side prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ side: 'bottom', children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should accept align prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ align: 'start', children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should accept sideOffset prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ sideOffset: 8, children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should accept alignOffset prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ alignOffset: 10, children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should accept avoidCollisions prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ avoidCollisions: false, children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should accept collisionPadding prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ collisionPadding: 16, children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });
  });

  describe('TooltipContent - Interactions', () => {
    it('should stay open when hovering over content', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]') as HTMLElement;
      expect(content).toBeTruthy();

      content.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should close when pointer leaves content', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]') as HTMLElement;
      content.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });
  });

  describe('TooltipContent - Custom Props', () => {
    it('should forward custom class names', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({
              class: 'custom-tooltip',
              children: 'Tooltip text',
            }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('.custom-tooltip')).toBeTruthy();
    });

    it('should forward custom data attributes', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({
              'data-testid': 'custom-content',
              children: 'Tooltip text',
            }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[data-testid="custom-content"]')).toBeTruthy();
    });

    it('should forward style prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({
              style: { background: 'black', color: 'white' },
              children: 'Tooltip text',
            }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]') as HTMLElement;
      expect(content.style.background).toBe('black');
      expect(content.style.color).toBe('white');
    });
  });

  describe('TooltipArrow - Rendering', () => {
    it('should render arrow', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({
              children: () => [
                'Tooltip text',
                TooltipArrow({}),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[data-tooltip-arrow]')).toBeTruthy();
    });

    it('should accept width prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({
              children: () => [
                'Tooltip text',
                TooltipArrow({ width: 12 }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[data-tooltip-arrow]')).toBeTruthy();
    });

    it('should accept height prop', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({
              children: () => [
                'Tooltip text',
                TooltipArrow({ height: 6 }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[data-tooltip-arrow]')).toBeTruthy();
    });

    it('should forward custom class names', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({
              children: () => [
                'Tooltip text',
                TooltipArrow({ class: 'custom-arrow' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('.custom-arrow')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple tooltips on same page', async () => {
      const component = () => {
        const wrapper = document.createElement('div');
        wrapper.appendChild(
          Tooltip({
            children: () => [
              TooltipTrigger({ children: 'Trigger 1' }),
              TooltipContent({ children: 'Tooltip 1' }),
            ],
          })
        );
        wrapper.appendChild(
          Tooltip({
            children: () => [
              TooltipTrigger({ children: 'Trigger 2' }),
              TooltipContent({ children: 'Tooltip 2' }),
            ],
          })
        );
        return wrapper;
      };

      const { container } = renderComponent(component);
      const triggers = container.querySelectorAll('button');
      expect(triggers.length).toBe(2);

      triggers[0].dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelectorAll('[role="tooltip"]').length).toBe(1);
    });

    it('should handle empty tooltip content', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: '' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]');
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('');
    });

    it('should handle long tooltip content', async () => {
      const longContent = 'This is a very long tooltip content that might overflow and needs proper handling';
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: longContent }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]');
      expect(content?.textContent).toBe(longContent);
    });

    it('should handle special characters in content', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: '<script>alert("xss")</script>' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]');
      expect(content?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });

    it('should handle rapid hover events', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Tooltip text' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      // Rapid enter/leave
      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

      vi.advanceTimersByTime(700);
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should handle tooltip with null children', () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: null }),
          ],
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('button')).toBeTruthy();
    });

    it('should handle tooltip with undefined children', () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: undefined }),
          ],
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('button')).toBeTruthy();
    });

    it('should handle different side values', async () => {
      const sides: Array<'top' | 'right' | 'bottom' | 'left'> = ['top', 'right', 'bottom', 'left'];

      for (const side of sides) {
        document.body.innerHTML = '';

        const component = () =>
          Tooltip({
            children: () => [
              TooltipTrigger({ children: 'Trigger' }),
              TooltipContent({ side, children: 'Tooltip text' }),
            ],
          });

        const { container } = renderComponent(component);
        const trigger = container.querySelector('button') as HTMLButtonElement;

        trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        await nextTick();

        expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
      }
    });

    it('should handle different align values', async () => {
      const aligns: Array<'start' | 'center' | 'end'> = ['start', 'center', 'end'];

      for (const align of aligns) {
        document.body.innerHTML = '';

        const component = () =>
          Tooltip({
            children: () => [
              TooltipTrigger({ children: 'Trigger' }),
              TooltipContent({ align, children: 'Tooltip text' }),
            ],
          });

        const { container } = renderComponent(component);
        const trigger = container.querySelector('button') as HTMLButtonElement;

        trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        await nextTick();

        expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
      }
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with icon triggers', async () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({
              'aria-label': 'Help',
              children: '?',
            }),
            TooltipContent({ children: 'Help information' }),
          ],
        });

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;
      expect(trigger.getAttribute('aria-label')).toBe('Help');

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should work in forms', async () => {
      const component = () => {
        const form = document.createElement('form');
        form.appendChild(
          Tooltip({
            children: () => [
              TooltipTrigger({ children: 'Info' }),
              TooltipContent({ children: 'Field help text' }),
            ],
          })
        );
        return form;
      };

      const { container } = renderComponent(component);
      const form = container.querySelector('form');
      expect(form).toBeTruthy();

      const trigger = form?.querySelector('button') as HTMLButtonElement;
      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    });

    it('should maintain accessibility when nested in complex layouts', async () => {
      const component = () => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('role', 'navigation');
        wrapper.appendChild(
          Tooltip({
            children: () => [
              TooltipTrigger({ children: 'Nav item' }),
              TooltipContent({ children: 'Navigation help' }),
            ],
          })
        );
        return wrapper;
      };

      const { container } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      await nextTick();

      const content = container.querySelector('[role="tooltip"]');
      expect(content).toBeTruthy();
      expect(trigger.getAttribute('aria-describedby')).toBe(content?.id);
    });
  });

  describe('Performance', () => {
    it('should render multiple tooltips efficiently', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        for (let i = 0; i < 20; i++) {
          wrapper.appendChild(
            Tooltip({
              children: () => [
                TooltipTrigger({ children: `Trigger ${i}` }),
                TooltipContent({ children: `Content ${i}` }),
              ],
            })
          );
        }
        return wrapper;
      };

      const { container } = renderComponent(component);
      const triggers = container.querySelectorAll('button');
      expect(triggers.length).toBe(20);
    });

    it('should cleanup timers on unmount', () => {
      const component = () =>
        Tooltip({
          children: () => [
            TooltipTrigger({ children: 'Trigger' }),
            TooltipContent({ children: 'Content' }),
          ],
        });

      const { container, cleanup } = renderComponent(component);
      const trigger = container.querySelector('button') as HTMLButtonElement;

      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

      cleanup();

      // Should not throw or cause memory leaks
      vi.advanceTimersByTime(700);
    });
  });
});
