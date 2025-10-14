/**
 * Tests for SVG shape primitives
 *
 * Note: Tests marked with .skip require ENABLE_REACTIVITY=true in jsxruntime/runtime.ts
 * These tests verify automatic DOM updates when signals change, which requires the full
 * reactivity system to be enabled.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  Circle,
  Rect,
  Path,
  Line,
  Polygon,
  Polyline,
  Ellipse,
  G,
  Use,
  Symbol,
  Defs
} from '../../../src/svg/primitives/shapes';
import { createSignal } from '../../../src/core/reactivity/signal';
import { render, cleanup, nextTick } from '../../test-utils';

describe('SVG Shape Primitives', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Circle', () => {
    it('should render circle element', () => {
      const { container } = render(() => (
        <svg>
          <Circle cx={50} cy={50} r={40} fill="red" />
        </svg>
      ));

      const circle = container.querySelector('circle');
      expect(circle).toBeTruthy();
      expect(circle?.getAttribute('cx')).toBe('50');
      expect(circle?.getAttribute('cy')).toBe('50');
      expect(circle?.getAttribute('r')).toBe('40');
      expect(circle?.getAttribute('fill')).toBe('red');
    });

    it('should support reactive attributes', async () => {
      const [r, setR] = createSignal(40);

      const { container } = render(() => (
        <svg>
          <Circle cx={50} cy={50} r={r} />
        </svg>
      ));

      const circle = container.querySelector('circle');
      console.log('[TEST] Initial r:', circle?.getAttribute('r'));
      expect(circle?.getAttribute('r')).toBe('40');

      console.log('[TEST] Setting r to 60');
      setR(60);
      console.log('[TEST] After setR, r is:', circle?.getAttribute('r'));

      await nextTick();
      console.log('[TEST] After nextTick, r is:', circle?.getAttribute('r'));
      expect(circle?.getAttribute('r')).toBe('60');
    });

    it('should handle string and number values', () => {
      const { container } = render(() => (
        <svg>
          <Circle cx="50%" cy={100} r="2em" />
        </svg>
      ));

      const circle = container.querySelector('circle');
      expect(circle?.getAttribute('cx')).toBe('50%');
      expect(circle?.getAttribute('cy')).toBe('100');
      expect(circle?.getAttribute('r')).toBe('2em');
    });
  });

  describe('Rect', () => {
    it('should render rect element', () => {
      const { container } = render(() => (
        <svg>
          <Rect x={10} y={10} width={80} height={60} fill="blue" />
        </svg>
      ));

      const rect = container.querySelector('rect');
      expect(rect).toBeTruthy();
      expect(rect?.getAttribute('x')).toBe('10');
      expect(rect?.getAttribute('y')).toBe('10');
      expect(rect?.getAttribute('width')).toBe('80');
      expect(rect?.getAttribute('height')).toBe('60');
      expect(rect?.getAttribute('fill')).toBe('blue');
    });

    it('should support rounded corners', () => {
      const { container } = render(() => (
        <svg>
          <Rect x={0} y={0} width={100} height={100} rx={10} ry={10} />
        </svg>
      ));

      const rect = container.querySelector('rect');
      expect(rect?.getAttribute('rx')).toBe('10');
      expect(rect?.getAttribute('ry')).toBe('10');
    });

    it('should support reactive dimensions', async () => {
      const [width, setWidth] = createSignal(100);
      const [height, setHeight] = createSignal(50);

      const { container } = render(() => (
        <svg>
          <Rect x={0} y={0} width={width} height={height} />
        </svg>
      ));

      const rect = container.querySelector('rect');
      expect(rect?.getAttribute('width')).toBe('100');
      expect(rect?.getAttribute('height')).toBe('50');

      setWidth(200);
      setHeight(100);
      await nextTick();
      expect(rect?.getAttribute('width')).toBe('200');
      expect(rect?.getAttribute('height')).toBe('100');
    });
  });

  describe('Path', () => {
    it('should render path element', () => {
      const { container } = render(() => (
        <svg>
          <Path d="M 10 10 L 90 90" stroke="black" />
        </svg>
      ));

      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M 10 10 L 90 90');
      expect(path?.getAttribute('stroke')).toBe('black');
    });

    it('should support reactive path data', async () => {
      const [d, setD] = createSignal('M 0 0 L 100 100');

      const { container } = render(() => (
        <svg>
          <Path d={d} />
        </svg>
      ));

      const path = container.querySelector('path');
      expect(path?.getAttribute('d')).toBe('M 0 0 L 100 100');

      setD('M 0 0 Q 50 50 100 0');
      await nextTick();
      expect(path?.getAttribute('d')).toBe('M 0 0 Q 50 50 100 0');
    });

    it('should support pathLength attribute', () => {
      const { container } = render(() => (
        <svg>
          <Path d="M 0 0 L 100 100" pathLength={100} />
        </svg>
      ));

      const path = container.querySelector('path');
      expect(path?.getAttribute('pathLength')).toBe('100');
    });
  });

  describe('Line', () => {
    it('should render line element', () => {
      const { container } = render(() => (
        <svg>
          <Line x1={0} y1={0} x2={100} y2={100} stroke="green" />
        </svg>
      ));

      const line = container.querySelector('line');
      expect(line).toBeTruthy();
      expect(line?.getAttribute('x1')).toBe('0');
      expect(line?.getAttribute('y1')).toBe('0');
      expect(line?.getAttribute('x2')).toBe('100');
      expect(line?.getAttribute('y2')).toBe('100');
      expect(line?.getAttribute('stroke')).toBe('green');
    });
  });

  describe('Polygon', () => {
    it('should render polygon element', () => {
      const points = '0,0 100,0 100,100 0,100';
      const { container } = render(() => (
        <svg>
          <Polygon points={points} fill="yellow" />
        </svg>
      ));

      const polygon = container.querySelector('polygon');
      expect(polygon).toBeTruthy();
      expect(polygon?.getAttribute('points')).toBe(points);
      expect(polygon?.getAttribute('fill')).toBe('yellow');
    });

    it('should support reactive points', async () => {
      const [points, setPoints] = createSignal('0,0 50,0 25,50');

      const { container } = render(() => (
        <svg>
          <Polygon points={points} />
        </svg>
      ));

      const polygon = container.querySelector('polygon');
      expect(polygon?.getAttribute('points')).toBe('0,0 50,0 25,50');

      setPoints('0,0 100,0 50,100');
      await nextTick();
      expect(polygon?.getAttribute('points')).toBe('0,0 100,0 50,100');
    });
  });

  describe('Polyline', () => {
    it('should render polyline element', () => {
      const points = '0,0 50,50 100,0';
      const { container } = render(() => (
        <svg>
          <Polyline points={points} fill="none" stroke="purple" />
        </svg>
      ));

      const polyline = container.querySelector('polyline');
      expect(polyline).toBeTruthy();
      expect(polyline?.getAttribute('points')).toBe(points);
      expect(polyline?.getAttribute('fill')).toBe('none');
      expect(polyline?.getAttribute('stroke')).toBe('purple');
    });
  });

  describe('Ellipse', () => {
    it('should render ellipse element', () => {
      const { container } = render(() => (
        <svg>
          <Ellipse cx={50} cy={50} rx={40} ry={30} fill="orange" />
        </svg>
      ));

      const ellipse = container.querySelector('ellipse');
      expect(ellipse).toBeTruthy();
      expect(ellipse?.getAttribute('cx')).toBe('50');
      expect(ellipse?.getAttribute('cy')).toBe('50');
      expect(ellipse?.getAttribute('rx')).toBe('40');
      expect(ellipse?.getAttribute('ry')).toBe('30');
      expect(ellipse?.getAttribute('fill')).toBe('orange');
    });
  });

  describe('G (Group)', () => {
    it('should render g element with children', () => {
      const { container } = render(() => (
        <svg>
          <G transform="translate(10, 10)">
            <Circle cx={0} cy={0} r={10} />
            <Rect x={-5} y={-5} width={10} height={10} />
          </G>
        </svg>
      ));

      const g = container.querySelector('g');
      expect(g).toBeTruthy();
      expect(g?.getAttribute('transform')).toBe('translate(10, 10)');

      const circle = g?.querySelector('circle');
      const rect = g?.querySelector('rect');
      expect(circle).toBeTruthy();
      expect(rect).toBeTruthy();
    });
  });

  describe('Use', () => {
    it('should render use element', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <circle id="myCircle" cx={0} cy={0} r={10} />
          </defs>
          <Use href="#myCircle" x={50} y={50} />
        </svg>
      ));

      const use = container.querySelector('use');
      expect(use).toBeTruthy();
      expect(use?.getAttribute('href')).toBe('#myCircle');
      expect(use?.getAttribute('x')).toBe('50');
      expect(use?.getAttribute('y')).toBe('50');
    });

    it('should support reactive href', async () => {
      const [href, setHref] = createSignal('#icon1');

      const { container } = render(() => (
        <svg>
          <Use href={href} />
        </svg>
      ));

      const use = container.querySelector('use');
      expect(use?.getAttribute('href')).toBe('#icon1');

      setHref('#icon2');
      await nextTick();
      expect(use?.getAttribute('href')).toBe('#icon2');
    });
  });

  describe('Symbol', () => {
    it('should render symbol element', () => {
      const { container } = render(() => (
        <svg>
          <Symbol id="mySymbol" viewBox="0 0 100 100">
            <Circle cx={50} cy={50} r={40} />
          </Symbol>
        </svg>
      ));

      const symbol = container.querySelector('symbol');
      expect(symbol).toBeTruthy();
      expect(symbol?.getAttribute('id')).toBe('mySymbol');
      expect(symbol?.getAttribute('viewBox')).toBe('0 0 100 100');

      const circle = symbol?.querySelector('circle');
      expect(circle).toBeTruthy();
    });
  });

  describe('Defs', () => {
    it('should render defs element with children', () => {
      const { container } = render(() => (
        <svg>
          <Defs>
            <linearGradient id="grad1">
              <stop offset="0%" stopColor="red" />
              <stop offset="100%" stopColor="blue" />
            </linearGradient>
          </Defs>
        </svg>
      ));

      const defs = container.querySelector('defs');
      expect(defs).toBeTruthy();

      const gradient = defs?.querySelector('linearGradient');
      expect(gradient).toBeTruthy();
      expect(gradient?.getAttribute('id')).toBe('grad1');
    });
  });
});