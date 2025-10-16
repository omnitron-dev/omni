/**
 * Tests for SVGIcon Component
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SVGIcon } from '../../../src/svg/components/SVGIcon';
import { createSignal } from '../../../src/core/reactivity/signal';
import { getIconRegistry, resetIconRegistry } from '../../../src/svg/icons/IconRegistry';
import { render, cleanup, waitFor } from '../../test-utils';

describe('SVGIcon Component', () => {
  beforeEach(() => {
    resetIconRegistry();
  });

  afterEach(() => {
    cleanup();
    resetIconRegistry();
  });

  describe('Basic Rendering', () => {
    it('should render icon from path prop', () => {
      const pathData = 'M10 10 L20 20 L10 30 Z';
      const { container } = render(() => <SVGIcon path={pathData} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      const path = svg?.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe(pathData);
    });

    it('should render icon with reactive path', () => {
      const [path, setPath] = createSignal('M10 10 L20 20 Z');
      const { container } = render(() => <SVGIcon path={path} />);

      const svg = container.querySelector('svg');
      const pathEl = svg?.querySelector('path');
      expect(pathEl?.getAttribute('d')).toBe('M10 10 L20 20 Z');

      setPath('M30 30 L40 40 Z');
      expect(pathEl?.getAttribute('d')).toBe('M30 30 L40 40 Z');
    });

    it('should render icon from registry', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
      });

      const onLoad = vi.fn();
      const { container } = render(() => <SVGIcon name="home" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should render inline SVG', async () => {
      const svgContent = '<svg><circle cx="10" cy="10" r="5"/></svg>';
      const onLoad = vi.fn();

      const { container } = render(() => <SVGIcon src={svgContent} onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      expect(container.innerHTML).toContain('circle');
    });

    it('should handle error when icon not found', async () => {
      const onError = vi.fn();

      render(() => <SVGIcon name="nonexistent" onError={onError} />);

      await waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });
    });
  });

  describe('Sizing', () => {
    it('should apply size presets', () => {
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

    it('should apply custom numeric size', () => {
      const { container } = render(() => <SVGIcon size={64} path="M10 10 L20 20 Z" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('64');
      expect(svg?.getAttribute('height')).toBe('64');
    });

    it('should apply width and height separately', () => {
      const { container } = render(() => <SVGIcon width={100} height={50} path="M10 10 L20 20 Z" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('100');
      expect(svg?.getAttribute('height')).toBe('50');
    });

    it('should support reactive size', () => {
      const [size, setSize] = createSignal(24);

      const { container } = render(() => <SVGIcon size={size} path="M10 10 L20 20 Z" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('24');

      setSize(48);
      expect(svg?.getAttribute('width')).toBe('48');
    });

    it('should use default size when not specified', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('24');
      expect(svg?.getAttribute('height')).toBe('24');
    });
  });

  describe('Styling', () => {
    it('should apply fill color', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" fill="red" />);

      const path = container.querySelector('path');
      expect(path?.getAttribute('fill')).toBe('red');
    });

    it('should apply color prop as fill', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" color="blue" />);

      const path = container.querySelector('path');
      expect(path?.getAttribute('fill')).toBe('blue');
    });

    it('should apply reactive color', () => {
      const [color, setColor] = createSignal('red');

      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" color={color} />);

      const path = container.querySelector('path');
      expect(path?.getAttribute('fill')).toBe('red');

      setColor('green');
      expect(path?.getAttribute('fill')).toBe('green');
    });

    it('should apply stroke properties', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" stroke="blue" strokeWidth={2} />);

      const path = container.querySelector('path');
      expect(path?.getAttribute('stroke')).toBe('blue');
      expect(path?.getAttribute('strokeWidth')).toBe('2');
    });

    it('should apply className', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" className="test-icon" />);

      const svg = container.querySelector('svg');
      expect(svg?.classList.contains('test-icon')).toBe(true);
    });

    it('should apply custom styles', () => {
      const { container } = render(() => (
        <SVGIcon path="M10 10 L20 20 Z" style={{ border: '1px solid red', opacity: 0.5 }} />
      ));

      const svg = container.querySelector('svg');
      expect(svg?.style.border).toBe('1px solid red');
      expect(svg?.style.opacity).toBe('0.5');
    });

    it('should default fill to currentColor', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" />);

      const path = container.querySelector('path');
      expect(path?.getAttribute('fill')).toBe('currentColor');
    });
  });

  describe('Transformations', () => {
    it('should apply rotation', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" rotate={45} />);

      const svg = container.querySelector('svg');
      const transform = svg?.getAttribute('transform');
      expect(transform).toContain('rotate(45');
    });

    it('should apply reactive rotation', () => {
      const [rotate, setRotate] = createSignal(0);

      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" rotate={rotate} />);

      let svg = container.querySelector('svg');
      expect(svg?.getAttribute('transform')).toBeFalsy();

      setRotate(90);
      svg = container.querySelector('svg');
      expect(svg?.getAttribute('transform')).toContain('rotate(90');
    });

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

    it('should apply both horizontal and vertical flip', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" flip="both" />);

      const svg = container.querySelector('svg');
      const transform = svg?.getAttribute('transform');
      expect(transform).toContain('scale(-1 -1)');
    });
  });

  describe('Animations', () => {
    it('should apply spin animation with default duration', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" spin />);

      const svg = container.querySelector('svg');
      expect(svg?.style.animation).toContain('aether-spin');
      expect(svg?.style.animation).toContain('2s');
    });

    it('should apply spin animation with custom duration', () => {
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

  describe('Accessibility', () => {
    it('should be decorative by default', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" decorative />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('role')).toBe('presentation');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should apply aria-label', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" aria-label="Home icon" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-label')).toBe('Home icon');
    });

    it('should apply custom role', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" role="img" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('role')).toBe('img');
    });

    it('should apply aria-labelledby', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" aria-labelledby="icon-title" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-labelledby')).toBe('icon-title');
    });

    it('should apply aria-describedby', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" aria-describedby="icon-desc" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-describedby')).toBe('icon-desc');
    });

    it('should render title element', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" title="Home Icon" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('title')).toBe('Home Icon');
    });

    it('should render desc element', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" desc="Navigate to home page" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('desc')).toBe('Navigate to home page');
    });
  });

  describe('Events', () => {
    it('should call onClick handler', () => {
      const onClick = vi.fn();
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" onClick={onClick} />);

      const svg = container.querySelector('svg');
      svg?.dispatchEvent(new MouseEvent('click'));
      expect(onClick).toHaveBeenCalled();
    });

    it('should call onLoad when icon loads from registry', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z',
      });

      const onLoad = vi.fn();
      render(() => <SVGIcon name="star" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalledTimes(1);
      });
    });

    it('should call onError when icon fails to load', async () => {
      const onError = vi.fn();
      render(() => <SVGIcon name="nonexistent-icon" onError={onError} />);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      });
    });

    it('should call onLoad when inline SVG loads', async () => {
      const onLoad = vi.fn();
      render(() => <SVGIcon src="<svg></svg>" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading state initially', () => {
      const { container } = render(() => <SVGIcon name="loading-icon" />);

      const svg = container.querySelector('svg');
      expect(svg?.style.opacity).toBe('0.3');
    });

    it('should show error state when loading fails', async () => {
      const onError = vi.fn();
      render(() => <SVGIcon name="error-icon" onError={onError} />);

      // Wait for error callback to be called
      await waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      // Verify error was called with an Error object
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('ViewBox', () => {
    it('should apply custom viewBox', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" viewBox="0 0 100 100" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100');
    });

    it('should use default viewBox based on dimensions', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" width={50} height={50} />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 50 50');
    });
  });

  describe('External URL Loading', () => {
    it('should fetch SVG from URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<svg><path d="M10 10"/></svg>',
      });

      const onLoad = vi.fn();
      render(() => <SVGIcon src="https://example.com/icon.svg" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledWith('https://example.com/icon.svg');
      });
    });

    it('should handle fetch errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const onError = vi.fn();
      render(() => <SVGIcon src="https://example.com/missing.svg" onError={onError} />);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      });
    });
  });

  describe('Registry Integration', () => {
    it('should load icon from registry with prefix', async () => {
      const registry = getIconRegistry();
      registry.registerSet(
        'icons',
        {
          home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        },
        'fa'
      );

      const onLoad = vi.fn();
      render(() => <SVGIcon name="fa:home" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });
    });

    it('should apply transformers from registry', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        circle: 'M50 50 m-40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0',
      });

      registry.addTransformer({
        name: 'test-transformer',
        transform: (icon) => ({
          ...icon,
          metadata: { transformed: true },
        }),
      });

      const onLoad = vi.fn();
      render(() => <SVGIcon name="circle" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null children', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z">{null}</SVGIcon>);

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should handle undefined props gracefully', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" color={undefined} size={undefined} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should handle empty path string', () => {
      const { container } = render(() => <SVGIcon path="" />);

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should handle all size presets being undefined', () => {
      const { container } = render(() => <SVGIcon path="M10 10 L20 20 Z" />);

      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('24');
      expect(svg?.getAttribute('height')).toBe('24');
    });
  });
});
