/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Skeleton } from '../../../src/primitives/Skeleton.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Skeleton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('div[data-skeleton]');
      expect(skeletonEl).toBeTruthy();
    });

    it('should have data-skeleton attribute', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('div') as HTMLElement;
      expect(skeletonEl.hasAttribute('data-skeleton')).toBe(true);
      expect(skeletonEl.getAttribute('data-skeleton')).toBe('');
    });

    it('should render empty skeleton by default', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]');
      expect(skeletonEl).toBeTruthy();
      expect(skeletonEl?.textContent).toBe('');
    });

    it('should render with children if provided', () => {
      const component = () => Skeleton({ children: 'Loading...' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]');
      expect(skeletonEl?.textContent).toBe('Loading...');
    });
  });

  describe('Width and Height', () => {
    it('should apply width as string', () => {
      const component = () => Skeleton({ width: '200px' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('200px');
    });

    it('should apply width as number (converted to px)', () => {
      const component = () => Skeleton({ width: 150 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('150px');
    });

    it('should apply width with percentage', () => {
      const component = () => Skeleton({ width: '100%' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('100%');
    });

    it('should apply width with em units', () => {
      const component = () => Skeleton({ width: '20em' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('20em');
    });

    it('should apply height as string', () => {
      const component = () => Skeleton({ height: '100px' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.height).toBe('100px');
    });

    it('should apply height as number (converted to px)', () => {
      const component = () => Skeleton({ height: 80 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.height).toBe('80px');
    });

    it('should apply both width and height', () => {
      const component = () => Skeleton({ width: 200, height: 150 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('200px');
      expect(skeletonEl.style.height).toBe('150px');
    });

    it('should work without width or height', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBeFalsy();
      expect(skeletonEl.style.height).toBeFalsy();
    });
  });

  describe('Border Radius', () => {
    it('should have default border radius of 4px', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.borderRadius).toBe('4px');
    });

    it('should apply custom radius as string', () => {
      const component = () => Skeleton({ radius: '8px' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.borderRadius).toBe('8px');
    });

    it('should apply custom radius as number (converted to px)', () => {
      const component = () => Skeleton({ radius: 12 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.borderRadius).toBe('12px');
    });

    it('should support 50% for circle', () => {
      const component = () => Skeleton({ radius: '50%', width: 40, height: 40 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.borderRadius).toBe('50%');
    });

    it('should support 0 for no radius', () => {
      const component = () => Skeleton({ radius: 0 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.borderRadius).toBe('0px');
    });

    it('should support em units for radius', () => {
      const component = () => Skeleton({ radius: '1em' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.borderRadius).toBe('1em');
    });
  });

  describe('Animation', () => {
    it('should be animated by default', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.hasAttribute('data-animate')).toBe(true);
      expect(skeletonEl.getAttribute('data-animate')).toBe('');
    });

    it('should support animate=true', () => {
      const component = () => Skeleton({ animate: true });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.hasAttribute('data-animate')).toBe(true);
    });

    it('should support animate=false to disable animation', () => {
      const component = () => Skeleton({ animate: false });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.hasAttribute('data-animate')).toBe(false);
    });

    it('should not have data-animate when animation is disabled', () => {
      const component = () => Skeleton({ animate: false });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.getAttribute('data-animate')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have aria-busy="true"', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.getAttribute('aria-busy')).toBe('true');
    });

    it('should have aria-live="polite"', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.getAttribute('aria-live')).toBe('polite');
    });

    it('should announce loading state to screen readers', () => {
      const component = () => Skeleton({});

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.getAttribute('aria-busy')).toBe('true');
      expect(skeletonEl.getAttribute('aria-live')).toBe('polite');
    });

    it('should support custom aria-label', () => {
      const component = () => Skeleton({ 'aria-label': 'Loading content' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.getAttribute('aria-label')).toBe('Loading content');
    });
  });

  describe('Styling', () => {
    it('should apply class name', () => {
      const component = () => Skeleton({ class: 'skeleton-loader' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('.skeleton-loader');
      expect(skeletonEl).toBeTruthy();
    });

    it('should apply multiple class names', () => {
      const component = () => Skeleton({ class: 'skeleton shimmer rounded' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.classList.contains('skeleton')).toBe(true);
      expect(skeletonEl.classList.contains('shimmer')).toBe(true);
      expect(skeletonEl.classList.contains('rounded')).toBe(true);
    });

    it('should apply custom inline styles', () => {
      const component = () =>
        Skeleton({
          style: {
            backgroundColor: '#e0e0e0',
            opacity: '0.5',
          },
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.backgroundColor).toBe('#e0e0e0');
      expect(skeletonEl.style.opacity).toBe('0.5');
    });

    it('should merge dimension styles with custom styles', () => {
      const component = () =>
        Skeleton({
          width: 200,
          height: 100,
          style: {
            margin: '10px',
            padding: '5px',
          },
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('200px');
      expect(skeletonEl.style.height).toBe('100px');
      expect(skeletonEl.style.margin).toBe('10px');
      expect(skeletonEl.style.padding).toBe('5px');
    });

    it('should apply border radius with other styles', () => {
      const component = () =>
        Skeleton({
          radius: '12px',
          style: {
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          },
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.borderRadius).toBe('12px');
      expect(skeletonEl.style.boxShadow).toBe('0 2px 4px rgba(0,0,0,0.1)');
    });
  });

  describe('Props Forwarding', () => {
    it('should forward id attribute', () => {
      const component = () => Skeleton({ id: 'skeleton-1' });

      const { container } = renderComponent(component);

      expect(container.querySelector('#skeleton-1')).toBeTruthy();
    });

    it('should forward data attributes', () => {
      const component = () =>
        Skeleton({
          'data-testid': 'skeleton-loader',
          'data-type': 'text',
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-testid="skeleton-loader"]') as HTMLElement;
      expect(skeletonEl).toBeTruthy();
      expect(skeletonEl.getAttribute('data-type')).toBe('text');
    });

    it('should forward title attribute', () => {
      const component = () => Skeleton({ title: 'Loading content' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.title).toBe('Loading content');
    });

    it('should forward role attribute', () => {
      const component = () => Skeleton({ role: 'progressbar' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[role="progressbar"]');
      expect(skeletonEl).toBeTruthy();
    });
  });

  describe('Use Cases - Shapes', () => {
    it('should work as text line skeleton', () => {
      const component = () => Skeleton({ width: '100%', height: '1em', radius: '4px' });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('100%');
      expect(skeletonEl.style.height).toBe('1em');
      expect(skeletonEl.style.borderRadius).toBe('4px');
    });

    it('should work as circular avatar skeleton', () => {
      const component = () =>
        Skeleton({
          width: 40,
          height: 40,
          radius: '50%',
          class: 'avatar-skeleton',
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('.avatar-skeleton') as HTMLElement;
      expect(skeletonEl.style.width).toBe('40px');
      expect(skeletonEl.style.height).toBe('40px');
      expect(skeletonEl.style.borderRadius).toBe('50%');
    });

    it('should work as rectangular image skeleton', () => {
      const component = () =>
        Skeleton({
          width: '300px',
          height: '200px',
          radius: '8px',
          class: 'image-skeleton',
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('.image-skeleton') as HTMLElement;
      expect(skeletonEl.style.width).toBe('300px');
      expect(skeletonEl.style.height).toBe('200px');
      expect(skeletonEl.style.borderRadius).toBe('8px');
    });

    it('should work as button skeleton', () => {
      const component = () =>
        Skeleton({
          width: '120px',
          height: '40px',
          radius: '20px',
          class: 'button-skeleton',
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('.button-skeleton') as HTMLElement;
      expect(skeletonEl.style.width).toBe('120px');
      expect(skeletonEl.style.height).toBe('40px');
      expect(skeletonEl.style.borderRadius).toBe('20px');
    });

    it('should work as card skeleton', () => {
      const component = () =>
        Skeleton({
          width: '100%',
          height: '200px',
          radius: '12px',
          class: 'card-skeleton',
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('.card-skeleton') as HTMLElement;
      expect(skeletonEl.style.width).toBe('100%');
      expect(skeletonEl.style.height).toBe('200px');
      expect(skeletonEl.style.borderRadius).toBe('12px');
    });
  });

  describe('Use Cases - Multiple Lines', () => {
    it('should work with multiple text line skeletons', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        wrapper.appendChild(Skeleton({ width: '100%', height: '20px' }));
        wrapper.appendChild(Skeleton({ width: '80%', height: '20px' }));
        wrapper.appendChild(Skeleton({ width: '60%', height: '20px' }));
        return wrapper;
      };

      const { container } = renderComponent(component);

      const skeletons = container.querySelectorAll('[data-skeleton]');
      expect(skeletons.length).toBe(3);

      const widths = Array.from(skeletons).map((el) => (el as HTMLElement).style.width);
      expect(widths).toEqual(['100%', '80%', '60%']);
    });

    it('should work with paragraph skeleton (multiple lines)', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        wrapper.className = 'paragraph-skeleton';
        for (let i = 0; i < 4; i++) {
          wrapper.appendChild(
            Skeleton({
              width: i === 3 ? '70%' : '100%',
              height: '16px',
              style: { marginBottom: '8px' },
            })
          );
        }
        return wrapper;
      };

      const { container } = renderComponent(component);

      const skeletons = container.querySelectorAll('[data-skeleton]');
      expect(skeletons.length).toBe(4);
      expect((skeletons[3] as HTMLElement).style.width).toBe('70%');
    });
  });

  describe('Use Cases - Complex Layouts', () => {
    it('should work in a card layout with avatar and text', () => {
      const component = () => {
        const card = document.createElement('div');
        card.className = 'card-loading';

        // Avatar
        card.appendChild(Skeleton({ width: 48, height: 48, radius: '50%' }));

        // Title
        card.appendChild(Skeleton({ width: '60%', height: '24px', style: { marginTop: '12px' } }));

        // Description lines
        card.appendChild(Skeleton({ width: '100%', height: '16px', style: { marginTop: '8px' } }));
        card.appendChild(Skeleton({ width: '80%', height: '16px', style: { marginTop: '4px' } }));

        return card;
      };

      const { container } = renderComponent(component);

      const skeletons = container.querySelectorAll('[data-skeleton]');
      expect(skeletons.length).toBe(4);

      // Check avatar is circular
      expect((skeletons[0] as HTMLElement).style.borderRadius).toBe('50%');
    });

    it('should work in a list item layout', () => {
      const component = () => {
        const listItem = document.createElement('div');
        listItem.className = 'list-item-loading';

        const left = document.createElement('div');
        left.appendChild(Skeleton({ width: 40, height: 40, radius: '8px' }));

        const right = document.createElement('div');
        right.appendChild(Skeleton({ width: '200px', height: '16px' }));
        right.appendChild(Skeleton({ width: '150px', height: '14px', style: { marginTop: '4px' } }));

        listItem.appendChild(left);
        listItem.appendChild(right);

        return listItem;
      };

      const { container } = renderComponent(component);

      const skeletons = container.querySelectorAll('[data-skeleton]');
      expect(skeletons.length).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle width of 0', () => {
      const component = () => Skeleton({ width: 0 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('0px');
    });

    it('should handle height of 0', () => {
      const component = () => Skeleton({ height: 0 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.height).toBe('0px');
    });

    it('should handle very large dimensions', () => {
      const component = () => Skeleton({ width: 9999, height: 9999 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('9999px');
      expect(skeletonEl.style.height).toBe('9999px');
    });

    it('should handle decimal dimensions', () => {
      const component = () => Skeleton({ width: 100.5, height: 50.7 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('100.5px');
      expect(skeletonEl.style.height).toBe('50.7px');
    });

    it('should handle negative dimensions gracefully', () => {
      const component = () => Skeleton({ width: -100, height: -50 });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBe('-100px');
      expect(skeletonEl.style.height).toBe('-50px');
    });

    it('should handle undefined dimensions', () => {
      const component = () => Skeleton({ width: undefined, height: undefined });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.width).toBeFalsy();
      expect(skeletonEl.style.height).toBeFalsy();
    });
  });

  describe('Performance', () => {
    it('should render many skeletons efficiently', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        for (let i = 0; i < 50; i++) {
          wrapper.appendChild(
            Skeleton({
              width: '100%',
              height: '20px',
              class: `skeleton-${i}`,
            })
          );
        }
        return wrapper;
      };

      const { container } = renderComponent(component);

      const skeletons = container.querySelectorAll('[data-skeleton]');
      expect(skeletons.length).toBe(50);
    });

    it('should handle conditional rendering', () => {
      const showSkeleton = true;
      const component = () =>
        Skeleton({
          style: { display: showSkeleton ? 'block' : 'none' },
          width: '100%',
          height: '20px',
        });

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.display).toBe('block');
    });
  });

  describe('Integration Scenarios', () => {
    it('should work as placeholder for content', () => {
      const isLoading = true;
      const component = () => {
        const wrapper = document.createElement('div');
        if (isLoading) {
          wrapper.appendChild(Skeleton({ width: '100%', height: '200px' }));
        } else {
          const content = document.createElement('div');
          content.textContent = 'Actual content';
          wrapper.appendChild(content);
        }
        return wrapper;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-skeleton]')).toBeTruthy();
    });

    it('should maintain consistent spacing with actual content', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        wrapper.appendChild(
          Skeleton({
            width: '200px',
            height: '48px',
            style: { margin: '16px' },
          })
        );
        return wrapper;
      };

      const { container } = renderComponent(component);

      const skeletonEl = container.querySelector('[data-skeleton]') as HTMLElement;
      expect(skeletonEl.style.margin).toBe('16px');
    });
  });
});
