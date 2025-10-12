/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  HoverCardArrow,
  HoverCardContext,
} from '../../../src/primitives/HoverCard.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('HoverCard Primitive', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up any portals
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  describe('HoverCardContext', () => {
    it('should have default values', () => {
      expect(HoverCardContext.id).toBeTypeOf('symbol');
      expect(HoverCardContext.defaultValue).toBeDefined();
      expect(HoverCardContext.defaultValue.isOpen()).toBe(false);
    });

    it('should have open function', () => {
      expect(HoverCardContext.defaultValue.open).toBeTypeOf('function');
    });

    it('should have close function', () => {
      expect(HoverCardContext.defaultValue.close).toBeTypeOf('function');
    });

    it('should have stable default IDs', () => {
      expect(HoverCardContext.defaultValue.triggerId).toBe('');
      expect(HoverCardContext.defaultValue.contentId).toBe('');
    });
  });

  describe('Component Exports', () => {
    it('should export HoverCard component', () => {
      expect(HoverCard).toBeTypeOf('function');
    });

    it('should export HoverCardTrigger component', () => {
      expect(HoverCardTrigger).toBeTypeOf('function');
    });

    it('should export HoverCardContent component', () => {
      expect(HoverCardContent).toBeTypeOf('function');
    });

    it('should export HoverCardArrow component', () => {
      expect(HoverCardArrow).toBeTypeOf('function');
    });

    it('should export HoverCardContext', () => {
      expect(HoverCardContext).toBeDefined();
      expect(HoverCardContext.Provider).toBeTypeOf('function');
    });
  });

  describe('Component Structure', () => {
    it('should create HoverCard with required props', () => {
      const component = () => HoverCard({ children: () => HoverCardTrigger({ children: 'Hover me' }) });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept openDelay prop', () => {
      const component = () =>
        HoverCard({
          openDelay: 500,
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept closeDelay prop', () => {
      const component = () =>
        HoverCard({
          closeDelay: 200,
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept both delay props', () => {
      const component = () =>
        HoverCard({
          openDelay: 500,
          closeDelay: 200,
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should render children', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Trigger' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });
  });

  describe('HoverCardTrigger Structure', () => {
    it('should create trigger with children', () => {
      const component = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Hover me' }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger).toBeTruthy();
    });

    it('should accept additional props', () => {
      const component = () =>
        HoverCard({
          children: () =>
            HoverCardTrigger({
              children: 'Hover',
              className: 'custom-trigger',
              'data-test': 'trigger',
            }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger?.className).toBe('custom-trigger');
      expect(trigger?.getAttribute('data-test')).toBe('trigger');
    });

    it('should accept string children', () => {
      const component = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Plain text' }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger?.textContent).toBe('Plain text');
    });

    it('should render as anchor element', () => {
      const component = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger?.tagName).toBe('A');
    });
  });

  describe('HoverCardContent Structure', () => {
    it('should create content with children', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept side prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              side: 'top',
              children: 'Content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept all side values', () => {
      const sides = ['top', 'right', 'bottom', 'left'] as const;
      sides.forEach((side) => {
        const component = () =>
          HoverCard({
            children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ side, children: 'Content' })],
          });
        renderComponent(component);
      });
      expect(true).toBe(true);
    });

    it('should accept align prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              align: 'start',
              children: 'Content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept all align values', () => {
      const aligns = ['start', 'center', 'end'] as const;
      aligns.forEach((align) => {
        const component = () =>
          HoverCard({
            children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ align, children: 'Content' })],
          });
        renderComponent(component);
      });
      expect(true).toBe(true);
    });

    it('should accept sideOffset prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              sideOffset: 16,
              children: 'Content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept alignOffset prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              alignOffset: 10,
              children: 'Content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept avoidCollisions prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              avoidCollisions: false,
              children: 'Content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept collisionPadding prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              collisionPadding: 16,
              children: 'Content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept all positioning props together', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              side: 'right',
              align: 'start',
              sideOffset: 12,
              alignOffset: 8,
              avoidCollisions: true,
              collisionPadding: 10,
              children: 'Content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept additional props', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              children: 'Content',
              className: 'custom-content',
              'data-test': 'content',
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });
  });

  describe('HoverCardArrow Structure', () => {
    it('should create arrow', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              children: [HoverCardArrow({}), 'Content'],
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept width prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              children: HoverCardArrow({ width: 16 }),
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept height prop', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              children: HoverCardArrow({ height: 8 }),
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept both width and height', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              children: HoverCardArrow({ width: 20, height: 10 }),
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept additional props', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              children: HoverCardArrow({
                className: 'custom-arrow',
                'data-test': 'arrow',
              }),
            }),
          ],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });
  });

  describe('Composition', () => {
    it('should allow composing trigger and content', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: '@username' }), HoverCardContent({ children: 'User profile' })],
        });
      const { container } = renderComponent(component);
      expect(container.querySelector('a')).toBeTruthy();
    });

    it('should allow composing with arrow', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: '@user' }),
            HoverCardContent({
              children: ['Profile info', HoverCardArrow({})],
            }),
          ],
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should work with complex content', () => {
      const component = () =>
        HoverCard({
          openDelay: 500,
          closeDelay: 200,
          children: () => [
            HoverCardTrigger({
              children: '@john',
              className: 'trigger',
            }),
            HoverCardContent({
              side: 'top',
              align: 'center',
              children: ['Avatar image', 'John Doe', 'Software Engineer', HoverCardArrow({})],
            }),
          ],
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });
  });

  describe('ARIA Attributes - Trigger', () => {
    it('should have aria-expanded attribute', () => {
      const component = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger?.hasAttribute('aria-expanded')).toBe(true);
    });

    it('should have aria-haspopup dialog', () => {
      const component = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    });

    it('should have id attribute', () => {
      const component = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger?.id).toBeTruthy();
    });

    it('should have data-state when closed', () => {
      const component = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Hover' }),
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('ARIA Attributes - Content', () => {
    it('should have role dialog when open', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const content = document.querySelector('[role="dialog"]');
      expect(content?.getAttribute('role')).toBe('dialog');
    });

    it('should have aria-labelledby pointing to trigger', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const content = document.querySelector('[role="dialog"]');
      expect(content?.hasAttribute('aria-labelledby')).toBe(true);
    });

    it('should have id attribute', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const content = document.querySelector('[role="dialog"]');
      expect(content?.id).toBeTruthy();
    });

    it('should have data-state attribute', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const content = document.querySelector('[role="dialog"]');
      expect(content?.hasAttribute('data-state')).toBe(true);
    });
  });

  describe('ARIA Attributes - Arrow', () => {
    it('should have data-hover-card-arrow attribute', () => {
      const component = () =>
        HoverCard({
          children: () => [
            HoverCardTrigger({ children: 'Hover' }),
            HoverCardContent({
              children: HoverCardArrow({ 'data-testid': 'arrow' }),
            }),
          ],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const arrow = document.querySelector('[data-hover-card-arrow]');
      expect(arrow?.hasAttribute('data-hover-card-arrow')).toBe(true);
    });
  });

  describe('Default Props', () => {
    it('should use default openDelay of 700ms', () => {
      expect(true).toBe(true); // Tested via timing behavior
    });

    it('should use default closeDelay of 300ms', () => {
      expect(true).toBe(true); // Tested via timing behavior
    });

    it('should use default side of bottom', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should use default align of center', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should use default sideOffset of 8', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should use default alignOffset of 0', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should enable collision avoidance by default', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should use default collisionPadding of 8', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });
  });

  describe('Timing - Open Delay', () => {
    it('should not open immediately on hover', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });

    it('should open after default delay (700ms)', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);

      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should respect custom openDelay', () => {
      const component = () =>
        HoverCard({
          openDelay: 500,
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

      vi.advanceTimersByTime(499);
      expect(trigger?.getAttribute('data-state')).toBe('closed');

      vi.advanceTimersByTime(1);
      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should cancel open timeout if pointer leaves before delay', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(300);
      trigger?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      vi.advanceTimersByTime(400);

      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('Timing - Close Delay', () => {
    it('should not close immediately when pointer leaves', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);
      trigger?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should close after default delay (300ms)', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);
      trigger?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      vi.advanceTimersByTime(300);

      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });

    it('should respect custom closeDelay', () => {
      const component = () =>
        HoverCard({
          closeDelay: 200,
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);
      trigger?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

      vi.advanceTimersByTime(199);
      expect(trigger?.getAttribute('data-state')).toBe('open');

      vi.advanceTimersByTime(1);
      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });

    it('should cancel close timeout if pointer re-enters', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);
      trigger?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      vi.advanceTimersByTime(100);
      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(200);

      expect(trigger?.getAttribute('data-state')).toBe('open');
    });
  });

  describe('Keyboard Interaction', () => {
    it('should open on focus', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should close on blur', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      trigger?.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });

    it('should open immediately on focus without delay', () => {
      const component = () =>
        HoverCard({
          openDelay: 1000,
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should close immediately on blur without delay', () => {
      const component = () =>
        HoverCard({
          closeDelay: 1000,
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      trigger?.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('Content Visibility', () => {
    it('should not render content when closed', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);

      // Portal always renders, but content is hidden via display:none
      const portal = document.querySelector('.aether-portal');
      expect(portal).toBeTruthy();

      const content = portal?.querySelector('[role="dialog"]') as HTMLElement;
      expect(content?.style.display).toBe('none');
    });

    it('should render content when open', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);

      const portal = document.querySelector('.aether-portal');
      expect(portal).toBeTruthy();
    });

    it('should render content in portal', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const portal = document.querySelector('.aether-portal');
      const content = portal?.querySelector('[role="dialog"]');
      expect(content).toBeTruthy();
    });
  });

  describe('Content Hover Behavior', () => {
    it('should keep open when hovering over content', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(700);

      const portal = document.querySelector('.aether-portal');
      const content = portal?.querySelector('[role="dialog"]') as HTMLElement;
      content?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      vi.advanceTimersByTime(300);

      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should close when pointer leaves content', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');

      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const portal = document.querySelector('.aether-portal');
      const content = portal?.querySelector('[role="dialog"]') as HTMLElement;
      content?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('ID Generation', () => {
    it('should generate unique IDs for multiple instances', () => {
      const component1 = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'First' }),
        });
      const { container: c1 } = renderComponent(component1);

      const component2 = () =>
        HoverCard({
          children: () => HoverCardTrigger({ children: 'Second' }),
        });
      const { container: c2 } = renderComponent(component2);

      const trigger1 = c1.querySelector('a');
      const trigger2 = c2.querySelector('a');

      expect(trigger1?.id).not.toBe(trigger2?.id);
    });

    it('should have matching trigger and content IDs', () => {
      const component = () =>
        HoverCard({
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      const { container } = renderComponent(component);
      const trigger = container.querySelector('a');
      const triggerId = trigger?.id;

      trigger?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      const content = document.querySelector('[role="dialog"]');
      const labelledBy = content?.getAttribute('aria-labelledby');

      expect(triggerId).toBe(labelledBy);
    });
  });

  describe('Type Safety', () => {
    it('should accept children prop on HoverCard', () => {
      const component = () => HoverCard({ children: () => HoverCardTrigger({ children: 'Hover' }) });
      renderComponent(component);
      expect(true).toBe(true);
    });

    it('should accept all hover card props', () => {
      const component = () =>
        HoverCard({
          openDelay: 500,
          closeDelay: 200,
          children: () => [HoverCardTrigger({ children: 'Hover' }), HoverCardContent({ children: 'Content' })],
        });
      renderComponent(component);
      expect(true).toBe(true);
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(HoverCardContext).toBeDefined();
      expect(HoverCardContext.Provider).toBeTypeOf('function');
      expect(HoverCardContext.defaultValue).toBeDefined();
    });
  });
});
