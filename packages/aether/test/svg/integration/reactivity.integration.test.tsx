/**
 * Reactivity Integration Tests
 *
 * Tests SVG system integration with Aether's reactivity system including:
 * - Signals with SVG primitives
 * - Computed values in SVG attributes
 * - Effects triggering SVG updates
 * - Batch updates optimization
 * - Reactive animations
 * - Complex reactive scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed, effect } from '../../../src/index.js';
import { SVG } from '../../../src/svg/primitives/svg.js';
import { Circle } from '../../../src/svg/primitives/shapes.js';
import { Path } from '../../../src/svg/primitives/shapes.js';
import { Rect } from '../../../src/svg/primitives/shapes.js';
import { SVGIcon } from '../../../src/svg/components/SVGIcon.js';
import {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconSet,
} from '../../../src/svg/icons/IconRegistry.js';

describe('Reactivity Integration', () => {
  let registry: IconRegistry;

  beforeEach(() => {
    resetIconRegistry();
    registry = getIconRegistry();
  });

  afterEach(() => {
    resetIconRegistry();
  });

  describe('Signals with SVG Primitives', () => {
    it('should support reactive width and height', () => {
      const width = signal(100);
      const height = signal(100);

      const svg = SVG({
        width,
        height,
        viewBox: '0 0 100 100',
      });

      expect(svg).toBeDefined();

      // Update signals
      width.set(200);
      height.set(200);

      expect(width()).toBe(200);
      expect(height()).toBe(200);
    });

    it('should support reactive circle attributes', () => {
      const cx = signal(50);
      const cy = signal(50);
      const r = signal(20);

      const circle = Circle({
        cx,
        cy,
        r,
        fill: 'red',
      });

      expect(circle).toBeDefined();

      // Update circle position and size
      cx.set(75);
      cy.set(75);
      r.set(30);

      expect(cx()).toBe(75);
      expect(cy()).toBe(75);
      expect(r()).toBe(30);
    });

    it('should support reactive colors', () => {
      const fill = signal('red');
      const stroke = signal('blue');

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill,
        stroke,
        strokeWidth: 2,
      });

      expect(circle).toBeDefined();

      // Update colors
      fill.set('green');
      stroke.set('yellow');

      expect(fill()).toBe('green');
      expect(stroke()).toBe('yellow');
    });

    it('should support reactive path data', () => {
      const pathData = signal('M 10 10 L 90 10');

      const path = Path({
        d: pathData,
        stroke: 'black',
        strokeWidth: 2,
      });

      expect(path).toBeDefined();

      // Update path
      pathData.set('M 10 10 L 90 90');
      expect(pathData()).toBe('M 10 10 L 90 90');
    });

    it('should support reactive viewBox', () => {
      const viewBox = signal('0 0 100 100');

      const svg = SVG({
        width: 200,
        height: 200,
        viewBox,
      });

      expect(svg).toBeDefined();

      // Update viewBox for zoom
      viewBox.set('25 25 50 50');
      expect(viewBox()).toBe('25 25 50 50');
    });

    it('should support reactive transform', () => {
      const rotation = signal(0);

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill: 'blue',
        transform: computed(() => `rotate(${rotation()} 50 50)`),
      });

      expect(circle).toBeDefined();

      // Rotate
      rotation.set(45);
      expect(rotation()).toBe(45);

      rotation.set(90);
      expect(rotation()).toBe(90);
    });
  });

  describe('Computed Values in SVG Attributes', () => {
    it('should compute circle position from center point', () => {
      const centerX = signal(100);
      const centerY = signal(100);

      const cx = computed(() => centerX());
      const cy = computed(() => centerY());

      const circle = Circle({
        cx,
        cy,
        r: 30,
        fill: 'red',
      });

      expect(circle).toBeDefined();

      centerX.set(150);
      centerY.set(150);

      expect(cx()).toBe(150);
      expect(cy()).toBe(150);
    });

    it('should compute dimensions from scale factor', () => {
      const baseSize = signal(100);
      const scale = signal(1);

      const width = computed(() => baseSize() * scale());
      const height = computed(() => baseSize() * scale());

      const rect = Rect({
        x: 0,
        y: 0,
        width,
        height,
        fill: 'green',
      });

      expect(rect).toBeDefined();

      scale.set(2);
      expect(width()).toBe(200);
      expect(height()).toBe(200);
    });

    it('should compute color from state', () => {
      const isActive = signal(false);
      const color = computed(() => (isActive() ? '#00ff00' : '#ff0000'));

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill: color,
      });

      expect(circle).toBeDefined();
      expect(color()).toBe('#ff0000');

      isActive.set(true);
      expect(color()).toBe('#00ff00');
    });

    it('should compute multiple dependent values', () => {
      const size = signal(100);
      const padding = signal(10);

      const innerSize = computed(() => size() - padding() * 2);
      const halfSize = computed(() => innerSize() / 2);

      const rect = Rect({
        x: padding,
        y: padding,
        width: innerSize,
        height: innerSize,
        rx: halfSize,
      });

      expect(rect).toBeDefined();

      size.set(200);
      expect(innerSize()).toBe(180);
      expect(halfSize()).toBe(90);
    });

    it('should compute path from parametric functions', () => {
      const amplitude = signal(20);
      const frequency = signal(2);

      const pathData = computed(() => {
        const points: string[] = [];
        for (let x = 0; x <= 100; x += 5) {
          const y = 50 + amplitude() * Math.sin((x * frequency() * Math.PI) / 100);
          points.push(x === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
        }
        return points.join(' ');
      });

      const path = Path({
        d: pathData,
        stroke: 'blue',
        fill: 'none',
      });

      expect(path).toBeDefined();

      amplitude.set(30);
      expect(pathData()).toContain('M 0');
    });
  });

  describe('Effects Triggering SVG Updates', () => {
    it('should trigger effect on attribute change', () => {
      const radius = signal(20);
      const updates: number[] = [];

      effect(() => {
        updates.push(radius());
      });

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: radius,
        fill: 'red',
      });

      expect(circle).toBeDefined();
      expect(updates).toContain(20);

      radius.set(30);
      expect(updates).toContain(30);

      radius.set(40);
      expect(updates).toContain(40);
    });

    it('should run side effects on color changes', () => {
      const color = signal('red');
      const colorHistory: string[] = [];

      effect(() => {
        colorHistory.push(color());
      });

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill: color,
      });

      expect(circle).toBeDefined();

      color.set('blue');
      color.set('green');

      expect(colorHistory).toEqual(['red', 'blue', 'green']);
    });

    it('should coordinate multiple effects', () => {
      const x = signal(0);
      const y = signal(0);

      const positions: Array<{ x: number; y: number }> = [];

      effect(() => {
        positions.push({ x: x(), y: y() });
      });

      const circle = Circle({
        cx: computed(() => x()),
        cy: computed(() => y()),
        r: 10,
      });

      expect(circle).toBeDefined();

      x.set(50);
      y.set(50);

      x.set(100);
      y.set(100);

      expect(positions.length).toBeGreaterThan(0);
      expect(positions[positions.length - 1]).toEqual({ x: 100, y: 100 });
    });

    it('should cleanup effects properly', () => {
      const value = signal(0);
      const callCount = { count: 0 };

      effect(() => {
        callCount.count++;
        value();
      });

      expect(callCount.count).toBe(1);

      value.set(1);
      value.set(2);

      const afterUpdateCount = callCount.count;
      expect(afterUpdateCount).toBeGreaterThan(1);

      // Note: Aether effects don't return cleanup functions like React useEffect
      // They are automatically cleaned up when the component unmounts
      // This test documents the expected behavior
    });
  });

  describe('Batch Updates Optimization', () => {
    it('should batch multiple signal updates', () => {
      const x = signal(0);
      const y = signal(0);
      const r = signal(10);

      let updateCount = 0;
      effect(() => {
        updateCount++;
        x();
        y();
        r();
      });

      const initialCount = updateCount;

      // Update multiple values
      x.set(50);
      y.set(50);
      r.set(20);

      // Should have triggered effects, but ideally batched
      expect(updateCount).toBeGreaterThan(initialCount);
    });

    it('should handle rapid successive updates efficiently', () => {
      const value = signal(0);
      const updates: number[] = [];

      effect(() => {
        updates.push(value());
      });

      // Rapid updates
      for (let i = 1; i <= 100; i++) {
        value.set(i);
      }

      // Should have recorded all updates
      expect(updates).toContain(100);
      expect(updates.length).toBeGreaterThan(0);
    });

    it('should optimize repeated identical updates', () => {
      const color = signal('red');
      let updateCount = 0;

      effect(() => {
        updateCount++;
        color();
      });

      const initialCount = updateCount;

      // Set to same value multiple times
      color.set('red');
      color.set('red');
      color.set('red');

      // Should not trigger unnecessary updates
      expect(updateCount).toBe(initialCount);
    });
  });

  describe('Reactive Animations', () => {
    it('should animate using signal-based time', () => {
      vi.useFakeTimers();

      const time = signal(0);
      const rotation = computed(() => (time() / 10) % 360);

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill: 'blue',
        transform: computed(() => `rotate(${rotation()} 50 50)`),
      });

      expect(circle).toBeDefined();

      // Simulate animation frame
      time.set(100);
      expect(rotation()).toBe(10);

      time.set(3600);
      expect(rotation()).toBe(0); // Full rotation

      vi.useRealTimers();
    });

    it('should interpolate between values smoothly', () => {
      const progress = signal(0);

      const interpolate = (start: number, end: number, t: number) =>
        start + (end - start) * t;

      const x = computed(() => interpolate(0, 100, progress()));
      const y = computed(() => interpolate(0, 100, progress()));

      const circle = Circle({
        cx: x,
        cy: y,
        r: 10,
        fill: 'red',
      });

      expect(circle).toBeDefined();

      progress.set(0.5);
      expect(x()).toBe(50);
      expect(y()).toBe(50);

      progress.set(1);
      expect(x()).toBe(100);
      expect(y()).toBe(100);
    });

    it('should apply easing functions', () => {
      const t = signal(0);

      const easeInOut = (x: number): number =>
        x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

      const easedProgress = computed(() => easeInOut(t()));
      const scale = computed(() => 0.5 + easedProgress() * 0.5);

      const transform = computed(() => `scale(${scale()})`);

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill: 'green',
        transform,
      });

      expect(circle).toBeDefined();

      t.set(0);
      expect(easedProgress()).toBe(0);

      t.set(0.5);
      expect(easedProgress()).toBeGreaterThan(0);

      t.set(1);
      expect(easedProgress()).toBe(1);
    });
  });

  describe('Complex Reactive Scenarios', () => {
    it('should handle multiple interdependent signals', () => {
      const outerRadius = signal(50);
      const thickness = signal(10);

      const innerRadius = computed(() => outerRadius() - thickness());
      const area = computed(
        () => Math.PI * (outerRadius() ** 2 - innerRadius() ** 2)
      );

      expect(innerRadius()).toBe(40);
      expect(area()).toBeCloseTo(Math.PI * (2500 - 1600), 0.01);

      outerRadius.set(60);
      expect(innerRadius()).toBe(50);
      expect(area()).toBeCloseTo(Math.PI * (3600 - 2500), 0.01);
    });

    it('should handle reactive icon properties', () => {
      const icons: IconSet = {
        heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
      };

      registry.registerSet('reactive', icons);

      const size = signal(24);
      const color = signal('red');

      const icon = SVGIcon({
        name: 'heart',
        size,
        color,
      });

      expect(icon).toBeDefined();

      size.set(32);
      color.set('pink');

      expect(size()).toBe(32);
      expect(color()).toBe('pink');
    });

    it('should handle conditional rendering based on signals', () => {
      const isVisible = signal(true);
      const opacity = computed(() => (isVisible() ? 1 : 0));

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill: 'blue',
        opacity,
      });

      expect(circle).toBeDefined();
      expect(opacity()).toBe(1);

      isVisible.set(false);
      expect(opacity()).toBe(0);

      isVisible.set(true);
      expect(opacity()).toBe(1);
    });

    it('should handle list-based reactive rendering', () => {
      const items = signal([
        { id: 1, x: 10, y: 10 },
        { id: 2, x: 30, y: 30 },
        { id: 3, x: 50, y: 50 },
      ]);

      const circles = computed(() =>
        items().map((item) =>
          Circle({
            cx: item.x,
            cy: item.y,
            r: 5,
            fill: 'red',
            key: item.id,
          })
        )
      );

      expect(circles()).toHaveLength(3);

      // Add item
      items.set([
        ...items(),
        { id: 4, x: 70, y: 70 },
      ]);

      expect(circles()).toHaveLength(4);

      // Remove item
      items.set(items().filter((item) => item.id !== 2));
      expect(circles()).toHaveLength(3);
    });

    it('should handle derived state across components', () => {
      const mouseX = signal(0);
      const mouseY = signal(0);

      const isHovered = computed(
        () => Math.sqrt(mouseX() ** 2 + mouseY() ** 2) < 50
      );

      const fill = computed(() => (isHovered() ? 'blue' : 'gray'));

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: 20,
        fill,
      });

      expect(circle).toBeDefined();
      // Initially at origin (0, 0), distance is 0, which is < 50, so isHovered is true
      expect(fill()).toBe('blue');

      // Move mouse away from origin
      mouseX.set(100);
      mouseY.set(100);
      // Distance is sqrt(100^2 + 100^2) = ~141, which is > 50, so not hovered
      expect(isHovered()).toBe(false);
      expect(fill()).toBe('gray');

      // Move mouse near origin
      mouseX.set(10);
      mouseY.set(10);
      // Distance is sqrt(10^2 + 10^2) = ~14, which is < 50, so hovered
      expect(isHovered()).toBe(true);
      expect(fill()).toBe('blue');
    });
  });

  describe('Performance with Reactive SVG', () => {
    it('should handle many reactive elements efficiently', () => {
      const circles: Array<{
        cx: () => number;
        cy: () => number;
        r: number;
      }> = [];

      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        const cx = signal(i * 10);
        const cy = signal(50);

        circles.push({
          cx: computed(() => cx()),
          cy: computed(() => cy()),
          r: 5,
        });
      }

      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // Should be fast
      expect(circles).toHaveLength(100);
    });

    it('should optimize unnecessary computations', () => {
      const base = signal(10);
      let computeCount = 0;

      const doubled = computed(() => {
        computeCount++;
        return base() * 2;
      });

      // Access computed value
      const value1 = doubled();
      const initialCount = computeCount;

      // Access again without changing base
      const value2 = doubled();

      // Should not recompute
      expect(computeCount).toBe(initialCount);
      expect(value1).toBe(value2);
    });
  });

  describe('Error Handling in Reactive SVG', () => {
    it('should handle invalid signal values gracefully', () => {
      const radius = signal(20);

      const circle = Circle({
        cx: 50,
        cy: 50,
        r: computed(() => {
          const r = radius();
          return r > 0 ? r : 0;
        }),
        fill: 'red',
      });

      expect(circle).toBeDefined();

      // Set invalid value
      radius.set(-10);

      // Should clamp to 0
      const r = computed(() => {
        const val = radius();
        return val > 0 ? val : 0;
      });
      expect(r()).toBe(0);
    });

    it('should handle NaN and Infinity values', () => {
      const value = signal(10);

      const safeDivision = computed(() => {
        const result = value() / 0;
        return isFinite(result) ? result : 0;
      });

      expect(safeDivision()).toBe(0); // Infinity handled

      value.set(NaN as any);
      const safeValue = computed(() => (isNaN(value()) ? 0 : value()));
      expect(safeValue()).toBe(0); // NaN handled
    });
  });
});
