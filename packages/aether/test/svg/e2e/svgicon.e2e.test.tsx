/**
 * End-to-End Tests for SVGIcon Component
 *
 * Tests user-facing behavior including:
 * - Icon loading from multiple sources
 * - User interactions (click, hover)
 * - Visual rendering
 * - Accessibility features
 * - Error states
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SVGIcon } from '../../../src/svg/components/SVGIcon';
import { createSignal } from '../../../src/core/reactivity/signal';
import { getIconRegistry, resetIconRegistry } from '../../../src/svg/icons/IconRegistry';
import { render, cleanup, waitFor, fireEvent } from '../../test-utils';

describe('SVGIcon E2E Tests', () => {
  beforeEach(() => {
    resetIconRegistry();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    resetIconRegistry();
  });

  describe('Icon Loading and Rendering', () => {
    it('should load and render icon from path immediately', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 L10 30 Z" aria-label="Arrow icon" />
      ));

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-label')).toBe('Arrow icon');

      const path = svg?.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M10 10 L20 20 L10 30 Z');
    });

    it('should load icon from registry and update UI', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z',
      });

      const onLoad = vi.fn();
      const { container } = render(() => (
        <SVGIcon name="home" onLoad={onLoad} aria-label="Home" />
      ));

      // Wait for icon to load
      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-label')).toBe('Home');
    });

    it('should handle switching between different icons', async () => {
      const registry = getIconRegistry();
      registry.registerSet('icons', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        user: 'M50 50 m-40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0',
      });

      const [iconName, setIconName] = createSignal('home');
      const { container } = render(() => <SVGIcon name={iconName()} />);

      // Wait for first icon to load
      await waitFor(() => {
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
      });

      // Switch to different icon
      setIconName('user');

      // Wait for icon to update
      await waitFor(
        () => {
          const svg = container.querySelector('svg');
          expect(svg).toBeTruthy();
        },
        { timeout: 2000 }
      );
    });

    it('should display error state when icon not found', async () => {
      const onError = vi.fn();

      const { container } = render(() => <SVGIcon name="nonexistent-icon" onError={onError} />);

      // Wait for error callback
      await waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      // Check for error visual indicator
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      const errorLine = svg?.querySelector('line[stroke="red"]');
      expect(errorLine).toBeTruthy();
    });

    it('should load inline SVG content', async () => {
      const svgContent = '<svg><circle cx="50" cy="50" r="40"/></svg>';
      const onLoad = vi.fn();

      const { container } = render(() => <SVGIcon src={svgContent} onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      expect(container.innerHTML).toContain('circle');
    });
  });

  describe('User Interactions', () => {
    it('should handle click events', () => {
      const onClick = vi.fn();
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" onClick={onClick} aria-label="Clickable icon" />
      ));

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // Simulate click
      svg?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should respond to hover state with animations', async () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" spin aria-label="Spinning icon" />
      ));

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // Check animation is applied
      const style = window.getComputedStyle(svg as Element);
      expect(svg?.style.animation).toContain('aether-spin');
    });

    it('should handle multiple rapid clicks', () => {
      const onClick = vi.fn();
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" onClick={onClick} />);

      const svg = container.querySelector('svg');

      // Rapid clicks
      for (let i = 0; i < 5; i++) {
        svg?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }

      expect(onClick).toHaveBeenCalledTimes(5);
    });
  });

  describe('Dynamic Property Updates', () => {
    it('should update size reactively', () => {
      const [size, setSize] = createSignal(24);
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" size={size} />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('24');
      expect(svg?.getAttribute('height')).toBe('24');

      setSize(48);
      expect(svg?.getAttribute('width')).toBe('48');
      expect(svg?.getAttribute('height')).toBe('48');
    });

    it('should update color reactively', () => {
      const [color, setColor] = createSignal('red');
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" color={color} />);

      const path = container.querySelector('path');
      expect(path?.getAttribute('fill')).toBe('red');

      setColor('blue');
      expect(path?.getAttribute('fill')).toBe('blue');
    });

    it('should update rotation reactively', () => {
      const [rotate, setRotate] = createSignal(0);
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" rotate={rotate} />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('transform')).toBeFalsy();

      setRotate(90);
      expect(svg?.getAttribute('transform')).toContain('rotate(90');

      setRotate(180);
      expect(svg?.getAttribute('transform')).toContain('rotate(180');
    });

    it('should update path data reactively', () => {
      const [path, setPath] = createSignal('M10 10 L20 20 Z');
      const { container } = render(() => <SVGIcon path={path} />);

      const pathEl = container.querySelector('path');
      expect(pathEl?.getAttribute('d')).toBe('M10 10 L20 20 Z');

      setPath('M30 30 L40 40 Z');
      expect(pathEl?.getAttribute('d')).toBe('M30 30 L40 40 Z');
    });
  });

  describe('Accessibility Features', () => {
    it('should have proper ARIA attributes for non-decorative icons', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" aria-label="Settings" role="img" />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-label')).toBe('Settings');
      expect(svg?.getAttribute('role')).toBe('img');
    });

    it('should mark decorative icons properly', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" decorative />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('role')).toBe('presentation');
    });

    it('should support title and description', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" title="Home Icon" desc="Navigate to home page" />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('title')).toBe('Home Icon');
      expect(svg?.getAttribute('desc')).toBe('Navigate to home page');
    });

    it('should support aria-labelledby and aria-describedby', () => {
      const { container } = render(() => (
        <SVGIcon
          path="M10 10 L20 20 Z"
          aria-labelledby="icon-title"
          aria-describedby="icon-desc"
        />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-labelledby')).toBe('icon-title');
      expect(svg?.getAttribute('aria-describedby')).toBe('icon-desc');
    });
  });

  describe('Visual Transformations', () => {
    it('should apply horizontal flip', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" flip="horizontal" />);

      const svg = container.querySelector('svg');
      const transform = svg?.getAttribute('transform');
      expect(transform).toContain('scale(-1 1)');
    });

    it('should apply vertical flip', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" flip="vertical" />);

      const svg = container.querySelector('svg');
      const transform = svg?.getAttribute('transform');
      expect(transform).toContain('scale(1 -1)');
    });

    it('should apply both flips', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" flip="both" />);

      const svg = container.querySelector('svg');
      const transform = svg?.getAttribute('transform');
      expect(transform).toContain('scale(-1 -1)');
    });

    it('should combine rotation and flip', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" rotate={45} flip="horizontal" />
      ));

      const svg = container.querySelector('svg');
      const transform = svg?.getAttribute('transform');
      expect(transform).toContain('rotate(45');
      expect(transform).toContain('scale(-1 1)');
    });
  });

  describe('Size Presets', () => {
    it('should handle all size presets correctly', () => {
      const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
      const expectedSizes = [16, 20, 24, 32, 48];

      sizes.forEach((size, index) => {
        const { container } = render(() => <SVGIcon size={size} path="M10 10 L20 20 Z" />);

        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('width')).toBe(String(expectedSizes[index]));
        expect(svg?.getAttribute('height')).toBe(String(expectedSizes[index]));
        cleanup();
      });
    });

    it('should allow custom numeric sizes', () => {
      const { container } = render(() => <SVGIcon size={128} path="M10 10 L20 20 Z" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('128');
      expect(svg?.getAttribute('height')).toBe('128');
    });

    it('should allow separate width and height', () => {
      const { container } = render(() => (
        <SVGIcon width={100} height={50} path="M10 10 L20 20 Z" />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('100');
      expect(svg?.getAttribute('height')).toBe('50');
    });
  });

  describe('Animation States', () => {
    it('should apply spin animation', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" spin />);

      const svg = container.querySelector('svg');
      expect(svg?.style.animation).toContain('aether-spin');
      expect(svg?.style.animation).toContain('2s');
    });

    it('should apply spin with custom duration', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" spin={5} />);

      const svg = container.querySelector('svg');
      expect(svg?.style.animation).toContain('aether-spin');
      expect(svg?.style.animation).toContain('5s');
    });

    it('should apply pulse animation', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" pulse />);

      const svg = container.querySelector('svg');
      expect(svg?.style.animation).toContain('aether-pulse');
    });
  });

  describe('Error Recovery', () => {
    it('should handle invalid path data gracefully', () => {
      const { container } = render(() => <SVGIcon path="" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should recover from failed network fetch', async () => {
      const onError = vi.fn();
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const { container } = render(() => (
        <SVGIcon src="https://example.com/missing.svg" onError={onError} />
      ));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      });

      // Error state should be visible
      const svg = container.querySelector('svg');
      const errorIndicator = svg?.querySelector('line[stroke="red"]');
      expect(errorIndicator).toBeTruthy();
    });

    it('should handle registry lookup failures', async () => {
      const onError = vi.fn();

      render(() => <SVGIcon name="nonexistent" onError={onError} />);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('not found'),
          })
        );
      });
    });
  });

  describe('Performance and Loading', () => {
    it('should show loading state initially', () => {
      const { container } = render(() => <SVGIcon name="loading-test" />);

      const svg = container.querySelector('svg');
      expect(svg?.style.opacity).toBe('0.3');
    });

    it('should complete loading cycle', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        complete: 'M10 10 L20 20 Z',
      });

      const onLoad = vi.fn();
      const { container } = render(() => <SVGIcon name="complete" onLoad={onLoad} />);

      // Initially loading
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // Wait for load
      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });
    });

    it('should handle rapid icon changes', async () => {
      const registry = getIconRegistry();
      registry.registerSet('icons', {
        icon1: 'M10 10 L20 20 Z',
        icon2: 'M30 30 L40 40 Z',
        icon3: 'M50 50 L60 60 Z',
      });

      const [iconName, setIconName] = createSignal('icon1');
      const { container } = render(() => <SVGIcon name={iconName()} />);

      await waitFor(() => {
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
      });

      // Rapid changes
      setIconName('icon2');
      setIconName('icon3');

      await waitFor(
        () => {
          const svg = container.querySelector('svg');
          expect(svg).toBeTruthy();
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined props gracefully', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" color={undefined} size={undefined} />
      ));

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should handle empty children', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z">{null}</SVGIcon>
      ));

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should apply custom className', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" className="custom-icon-class" />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.classList.contains('custom-icon-class')).toBe(true);
    });

    it('should apply custom styles', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" style={{ border: '1px solid red', opacity: 0.5 }} />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.style.border).toBe('1px solid red');
      expect(svg?.style.opacity).toBe('0.5');
    });

    it('should handle viewBox overrides', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" viewBox="0 0 100 100" />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100');
    });
  });
});
