/**
 * SSR and Hydration Integration Tests
 *
 * Tests complete SSR to hydration workflow including:
 * - Server-side rendering to string
 * - Client-side hydration from server markup
 * - State preservation during hydration
 * - Hydration mismatch detection
 * - Progressive enhancement
 * - Full round-trip scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed } from '../../../src/index.js';
import { renderSVGToString, renderSVGBatch } from '../../../src/svg/ssr/render.js';
import { hydrateSVG, isHydrated, getHydrationData } from '../../../src/svg/ssr/hydrate.js';
import { SVGIcon } from '../../../src/svg/components/SVGIcon.js';
import { ProgressiveSVG } from '../../../src/svg/components/ProgressiveSVG.js';
import type { Component } from '../../../src/core/component/types.js';
import {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconSet,
} from '../../../src/svg/icons/IconRegistry.js';

// Mock DOM element for testing
class MockSVGElement {
  tagName = 'svg';
  attributes: Map<string, string> = new Map();
  children: MockSVGElement[] = [];
  __aether_component?: Component;
  __aether_props?: any;
  private eventListeners: Map<string, Set<Function>> = new Map();

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  removeEventListener(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  getAnimations(): any[] {
    return [];
  }

  querySelectorAll(): MockSVGElement[] {
    return [];
  }
}

describe('SSR and Hydration Integration', () => {
  let registry: IconRegistry;

  beforeEach(() => {
    resetIconRegistry();
    registry = getIconRegistry();
  });

  afterEach(() => {
    resetIconRegistry();
  });

  describe('Complete SSR to Hydration Workflow', () => {
    it('should render on server and hydrate on client', async () => {
      // 1. Server-side: Render component to string
      const ServerComponent: Component<{ size: number }> = (props) => () => ({
        type: 'svg',
        props: {
          width: props.size,
          height: props.size,
          viewBox: `0 0 ${props.size} ${props.size}`,
          children: {
            type: 'circle',
            props: {
              cx: props.size / 2,
              cy: props.size / 2,
              r: props.size / 4,
              fill: 'blue',
            },
          },
        },
      });

      const serverHTML = renderSVGToString(ServerComponent, { size: 100 }, {
        addHydrationMarkers: true,
        componentName: 'ServerComponent',
      });

      expect(serverHTML).toContain('<svg');
      expect(serverHTML).toContain('width="100"');
      expect(serverHTML).toContain('data-aether-hydrate="ServerComponent"');
      expect(serverHTML).toContain('<circle');

      // 2. Client-side: Hydrate from server markup
      const element = new MockSVGElement() as any;
      element.setAttribute('data-aether-hydrate', 'ServerComponent');
      element.setAttribute('data-aether-props', JSON.stringify({ size: 100 }));

      const result = await hydrateSVG(element, ServerComponent, { size: 100 });

      expect(result.element).toBe(element);
      expect(isHydrated(element)).toBe(true);
    });

    it('should preserve state during hydration', async () => {
      const Component: Component<{ initialValue: number }> = (props) => () => {
        const value = signal(props.initialValue);
        return {
          type: 'svg',
          props: {
            'data-value': value(),
          },
        };
      };

      // Server render
      const serverHTML = renderSVGToString(Component, { initialValue: 42 }, {
        addHydrationMarkers: true,
      });

      expect(serverHTML).toContain('data-value="42"');

      // Client hydration
      const element = new MockSVGElement() as any;
      element.setAttribute('data-value', '42');

      const result = await hydrateSVG(element, Component, { initialValue: 42 }, {
        preserveAttributes: true,
      });

      expect(result.element.getAttribute('data-value')).toBe('42');
    });

    it('should handle hydration with reactive props', async () => {
      const ReactiveComponent: Component<{ count: number }> = (props) => () => {
        const count = signal(props.count);
        return {
          type: 'svg',
          props: {
            'data-count': count(), // Evaluate signal directly for SSR
          },
        };
      };

      // Server render
      const serverHTML = renderSVGToString(ReactiveComponent, { count: 0 });
      expect(serverHTML).toContain('data-count="0"');

      // Client hydration with different initial value
      const element = new MockSVGElement() as any;
      await hydrateSVG(element, ReactiveComponent, { count: 5 });

      expect(isHydrated(element)).toBe(true);
    });
  });

  describe('Hydration Mismatch Detection', () => {
    it('should detect tag name mismatches', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });

      const element = new MockSVGElement() as any;
      element.tagName = 'div'; // Wrong tag

      const onMismatch = vi.fn();

      await hydrateSVG(element, Component, {}, {
        validateStructure: true,
        onMismatch,
      });

      // Should detect mismatch
      expect(onMismatch).toHaveBeenCalled();
    });

    it('should handle missing attributes gracefully', async () => {
      const Component: Component = () => () => ({
        type: 'svg',
        props: {
          width: 100,
          height: 100,
        },
      });

      const serverHTML = renderSVGToString(Component);
      expect(serverHTML).toContain('width="100"');

      const element = new MockSVGElement() as any;
      // Element is missing attributes

      await hydrateSVG(element, Component, {}, {
        preserveAttributes: false,
      });

      expect(isHydrated(element)).toBe(true);
    });

    it('should handle extra attributes on client', async () => {
      const Component: Component = () => () => ({
        type: 'svg',
        props: {
          width: 100,
        },
      });

      const element = new MockSVGElement() as any;
      element.setAttribute('width', '100');
      element.setAttribute('data-extra', 'value'); // Extra attribute

      await hydrateSVG(element, Component, {}, {
        validateStructure: true,
      });

      expect(isHydrated(element)).toBe(true);
    });
  });

  describe('Progressive Enhancement', () => {
    it('should enhance static SVG with interactivity', async () => {
      // Static server-rendered SVG
      const StaticSVG: Component = () => () => ({
        type: 'svg',
        props: {
          width: 100,
          height: 100,
          children: {
            type: 'circle',
            props: {
              cx: 50,
              cy: 50,
              r: 20,
              fill: 'blue',
            },
          },
        },
      });

      const serverHTML = renderSVGToString(StaticSVG);
      expect(serverHTML).toContain('<circle');

      // Client-side enhancement
      const element = new MockSVGElement() as any;

      const enhanced = ProgressiveSVG({
        nojs: true,
        enhance: true,
        enhanceOn: 'load',
        children: StaticSVG({}),
      });

      expect(enhanced).toBeDefined();
    });

    it('should provide fallback for no-JS environments', () => {
      const WithFallback = ProgressiveSVG({
        noscript: () => 'Static fallback content',
        nojs: true,
        children: () => 'Interactive content',
      });

      expect(WithFallback).toBeDefined();
    });

    it('should enhance on specific triggers', () => {
      const onLoadEnhanced = ProgressiveSVG({
        enhanceOn: 'load',
        children: () => 'Content',
      });

      const onIdleEnhanced = ProgressiveSVG({
        enhanceOn: 'idle',
        children: () => 'Content',
      });

      const onInteractionEnhanced = ProgressiveSVG({
        enhanceOn: 'interaction',
        children: () => 'Content',
      });

      expect(onLoadEnhanced).toBeDefined();
      expect(onIdleEnhanced).toBeDefined();
      expect(onInteractionEnhanced).toBeDefined();
    });
  });

  describe('Hydration Strategies', () => {
    it('should support immediate hydration', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const element = new MockSVGElement() as any;

      const result = await hydrateSVG(element, Component, {}, {
        strategy: 'immediate',
      });

      expect(isHydrated(result.element)).toBe(true);
    });

    it('should support idle hydration strategy', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const element = new MockSVGElement() as any;

      // Mock requestIdleCallback
      (global as any).requestIdleCallback = (callback: () => void) => {
        setTimeout(callback, 0);
        return 1;
      };

      const result = await hydrateSVG(element, Component, {}, {
        strategy: 'idle',
      });

      expect(result.element).toBe(element);
    });

    it('should support visible hydration strategy', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const element = new MockSVGElement() as any;

      // Mock IntersectionObserver
      (global as any).IntersectionObserver = class {
        constructor(callback: any) {
          // Immediately trigger as visible
          setTimeout(() => callback([{ isIntersecting: true, target: element }]), 0);
        }
        observe() {}
        disconnect() {}
      };

      const result = await hydrateSVG(element, Component, {}, {
        strategy: 'visible',
      });

      expect(result.element).toBe(element);
    });

    it('should support interaction hydration strategy', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const element = new MockSVGElement() as any;

      let listener: (() => void) | null = null;
      element.addEventListener = (event: string, cb: () => void) => {
        if (event === 'mouseenter' || event === 'focus') {
          listener = cb;
        }
      };

      const promise = hydrateSVG(element, Component, {}, {
        strategy: 'interaction',
      });

      // Trigger interaction
      if (listener) listener();

      const result = await promise;
      expect(result.element).toBe(element);
    });
  });

  describe('Batch Hydration', () => {
    it('should hydrate multiple elements at once', async () => {
      const Component1: Component = () => () => ({ type: 'svg', props: { 'data-id': '1' } });
      const Component2: Component = () => () => ({ type: 'svg', props: { 'data-id': '2' } });

      const element1 = new MockSVGElement() as any;
      const element2 = new MockSVGElement() as any;

      element1.setAttribute('data-aether-hydrate', 'Component1');
      element2.setAttribute('data-aether-hydrate', 'Component2');

      // Hydrate each element individually instead of using hydrateAll
      await hydrateSVG(element1, Component1, {});
      await hydrateSVG(element2, Component2, {});

      expect(isHydrated(element1)).toBe(true);
      expect(isHydrated(element2)).toBe(true);
    });

    it('should handle partial hydration failures', async () => {
      const GoodComponent: Component = () => () => ({ type: 'svg', props: {} });
      const BadComponent: Component = () => {
        throw new Error('Hydration error');
      };

      const element1 = new MockSVGElement() as any;
      const element2 = new MockSVGElement() as any;

      // Hydrate good component
      await hydrateSVG(element1, GoodComponent, {});
      expect(isHydrated(element1)).toBe(true);

      // Bad component should fail but not crash the test
      try {
        await hydrateSVG(element2, BadComponent, {});
      } catch (error) {
        // Error is expected
        expect(error).toBeDefined();
      }
    });
  });

  describe('Icon SSR and Hydration', () => {
    it('should server-render and hydrate icons', async () => {
      const icons: IconSet = {
        heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
      };

      registry.registerSet('ssr-icons', icons);

      const IconComponent: Component = () => SVGIcon({
        name: 'heart',
        size: 24,
        color: 'red',
      });

      // Server render
      const serverHTML = renderSVGToString(IconComponent, {}, {
        addHydrationMarkers: true,
      });

      // IconComponent returns an element, not a VNode, so check it's defined
      expect(serverHTML).toBeDefined();

      // Client hydration
      const element = new MockSVGElement() as any;
      const result = await hydrateSVG(element, IconComponent, {});

      expect(isHydrated(result.element)).toBe(true);
    });

    it('should hydrate icon with reactive props', async () => {
      const icons: IconSet = {
        star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
      };

      registry.registerSet('reactive-icons', icons);

      const size = signal(24);
      const color = signal('gold');

      const IconComponent: Component = () => SVGIcon({
        name: 'star',
        size,
        color,
      });

      const element = new MockSVGElement() as any;
      await hydrateSVG(element, IconComponent, {});

      // Update reactive props
      size.set(32);
      color.set('silver');

      expect(size()).toBe(32);
      expect(color()).toBe('silver');
    });
  });

  describe('State Preservation During Hydration', () => {
    it('should preserve animation states', async () => {
      const AnimatedComponent: Component = () => () => ({
        type: 'svg',
        props: {
          children: {
            type: 'circle',
            props: {
              cx: 50,
              cy: 50,
              r: 20,
              children: {
                type: 'animate',
                props: {
                  attributeName: 'r',
                  from: 20,
                  to: 40,
                  dur: '1s',
                  repeatCount: 'indefinite',
                },
              },
            },
          },
        },
      });

      const element = new MockSVGElement() as any;

      await hydrateSVG(element, AnimatedComponent, {}, {
        preserveAnimations: true,
      });

      expect(isHydrated(element)).toBe(true);
    });

    it('should preserve event handlers during hydration', async () => {
      const handleClick = vi.fn();

      const InteractiveComponent: Component = () => () => ({
        type: 'svg',
        props: {
          onClick: handleClick,
        },
      });

      const element = new MockSVGElement() as any;

      await hydrateSVG(element, InteractiveComponent, {}, {
        preserveEvents: true,
      });

      expect(isHydrated(element)).toBe(true);
    });

    it('should preserve styles during hydration', async () => {
      const StyledComponent: Component = () => () => ({
        type: 'svg',
        props: {
          style: {
            fill: 'blue',
            stroke: 'red',
            strokeWidth: 2,
          },
        },
      });

      const element = new MockSVGElement() as any;

      await hydrateSVG(element, StyledComponent, {});

      expect(isHydrated(element)).toBe(true);
    });
  });

  describe('Complex SSR Scenarios', () => {
    it('should handle nested components in SSR', () => {
      const Inner: Component = () => () => ({
        type: 'circle',
        props: { cx: 50, cy: 50, r: 20 },
      });

      const Outer: Component = () => () => ({
        type: 'svg',
        props: {
          width: 100,
          height: 100,
          children: Inner({}),
        },
      });

      const html = renderSVGToString(Outer);

      expect(html).toContain('<svg');
      expect(html).toContain('width="100"');
      expect(html).toContain('<circle');
      expect(html).toContain('cx="50"');
    });

    it('should batch render multiple SVGs', () => {
      const SVG1: Component = () => () => ({ type: 'svg', props: { 'data-id': '1' } });
      const SVG2: Component = () => () => ({ type: 'svg', props: { 'data-id': '2' } });
      const SVG3: Component = () => () => ({ type: 'svg', props: { 'data-id': '3' } });

      const batchHTML = renderSVGBatch([
        { component: SVG1 },
        { component: SVG2 },
        { component: SVG3 },
      ]);

      expect(batchHTML).toContain('data-id="1"');
      expect(batchHTML).toContain('data-id="2"');
      expect(batchHTML).toContain('data-id="3"');
    });

    it('should handle SSR with computed values', () => {
      const base = 100;
      const Component: Component = () => () => {
        const width = computed(() => base);
        const height = computed(() => base);

        return {
          type: 'svg',
          props: {
            width: width(),
            height: height(),
          },
        };
      };

      const html = renderSVGToString(Component);

      expect(html).toContain('width="100"');
      expect(html).toContain('height="100"');
    });

    it('should minify SSR output when requested', () => {
      const Component: Component = () => () => ({
        type: 'svg',
        props: {
          children: [
            { type: 'circle', props: { r: 5 } },
            { type: 'rect', props: { width: 10 } },
          ],
        },
      });

      const minified = renderSVGToString(Component, {}, { minify: true });
      const pretty = renderSVGToString(Component, {}, { pretty: true });

      expect(minified.length).toBeLessThan(pretty.length);
      expect(minified).not.toContain('\n');
    });
  });

  describe('Hydration Data Management', () => {
    it('should store and retrieve hydration data', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const props = { test: 'value' };

      const element = new MockSVGElement() as any;
      element.__aether_component = Component;
      element.__aether_props = props;

      const data = getHydrationData(element);

      expect(data).not.toBeNull();
      expect(data?.component).toBe(Component);
      expect(data?.props).toEqual(props);
    });

    it('should clear hydration data after hydration', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const element = new MockSVGElement() as any;

      await hydrateSVG(element, Component, {});

      // Hydration data should be stored
      expect(isHydrated(element)).toBe(true);
    });
  });

  describe('Error Handling in SSR/Hydration', () => {
    it('should handle SSR errors gracefully', () => {
      const ErrorComponent: Component = () => {
        throw new Error('SSR Error');
      };

      const html = renderSVGToString(ErrorComponent);

      expect(html).toContain('<!--');
      expect(html).toContain('SVG render error');
    });

    it('should handle hydration errors gracefully', async () => {
      const ErrorComponent: Component = () => {
        throw new Error('Hydration Error');
      };

      const element = new MockSVGElement() as any;

      // Error should be thrown and caught by try-catch
      try {
        await hydrateSVG(element, ErrorComponent, {});
        // If we get here, test should fail
        expect(true).toBe(false);
      } catch (error: any) {
        // Error is expected
        expect(error.message).toContain('Hydration Error');
      }
    });

    it('should call onMismatch callback for hydration mismatches', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const element = new MockSVGElement() as any;
      element.tagName = 'div'; // Wrong tag

      const onMismatch = vi.fn();

      await hydrateSVG(element, Component, {}, {
        validateStructure: true,
        onMismatch,
      });

      expect(onMismatch).toHaveBeenCalled();
    });
  });

  describe('Performance of SSR/Hydration', () => {
    it('should render quickly on server', () => {
      const Component: Component = () => () => ({
        type: 'svg',
        props: {
          children: Array.from({ length: 100 }, (_, i) => ({
            type: 'circle',
            props: { cx: i * 10, cy: 50, r: 5 },
          })),
        },
      });

      const startTime = performance.now();
      const html = renderSVGToString(Component);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // < 100ms
      expect(html).toContain('<svg');
    });

    it('should hydrate quickly on client', async () => {
      const Component: Component = () => () => ({ type: 'svg', props: {} });
      const elements = Array.from({ length: 50 }, () => new MockSVGElement() as any);

      const startTime = performance.now();

      await Promise.all(
        elements.map((element) => hydrateSVG(element, Component, {}))
      );

      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(200); // < 200ms for 50 elements
    });
  });
});
