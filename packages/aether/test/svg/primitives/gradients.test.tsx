/**
 * Tests for SVG Gradient Primitives
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  LinearGradient,
  RadialGradient,
  Stop,
  Pattern,
  Mask,
  ClipPath
} from '../../../src/svg/primitives/gradients';
import { createSignal } from '../../../src/core/reactivity/signal';
import { render, cleanup } from '../../test-utils';

describe('SVG Gradient Primitives', () => {
  afterEach(() => {
    cleanup();
  });

  describe('LinearGradient', () => {
    it('should render basic linear gradient', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad1">
              <Stop offset="0%" stopColor="red" />
              <Stop offset="100%" stopColor="blue" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('linearGradient');
      expect(gradient).toBeTruthy();
      expect(gradient?.getAttribute('id')).toBe('grad1');

      const stops = gradient?.querySelectorAll('stop');
      expect(stops?.length).toBe(2);
    });

    it('should apply gradient coordinates', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="red" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('linearGradient');
      expect(gradient?.getAttribute('x1')).toBe('0%');
      expect(gradient?.getAttribute('y1')).toBe('0%');
      expect(gradient?.getAttribute('x2')).toBe('100%');
      expect(gradient?.getAttribute('y2')).toBe('100%');
    });

    it('should support reactive coordinates', () => {
      const [x2, setX2] = createSignal('50%');

      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad3" x1="0%" y1="0%" x2={x2} y2="0%">
              <Stop offset="0%" stopColor="red" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('linearGradient');
      expect(gradient?.getAttribute('x2')).toBe('50%');

      setX2('100%');
      expect(gradient?.getAttribute('x2')).toBe('100%');
    });

    it('should apply gradientUnits', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad4" gradientUnits="userSpaceOnUse">
              <Stop offset="0%" stopColor="red" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('linearGradient');
      expect(gradient?.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    });

    it('should apply gradientTransform', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad5" gradientTransform="rotate(45)">
              <Stop offset="0%" stopColor="red" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('linearGradient');
      expect(gradient?.getAttribute('gradientTransform')).toBe('rotate(45)');
    });

    it('should apply spreadMethod', () => {
      const methods: Array<'pad' | 'reflect' | 'repeat'> = ['pad', 'reflect', 'repeat'];

      methods.forEach((method) => {
        const { container } = render(() => (
          <svg>
            <defs>
              <LinearGradient id={`grad-${method}`} spreadMethod={method}>
                <Stop offset="0%" stopColor="red" />
              </LinearGradient>
            </defs>
          </svg>
        ));

        const gradient = container.querySelector('linearGradient');
        expect(gradient?.getAttribute('spreadMethod')).toBe(method);
        cleanup();
      });
    });

    it('should support reactive gradientTransform', () => {
      const [transform, setTransform] = createSignal('rotate(0)');

      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad6" gradientTransform={transform}>
              <Stop offset="0%" stopColor="red" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('linearGradient');
      expect(gradient?.getAttribute('gradientTransform')).toBe('rotate(0)');

      setTransform('rotate(90)');
      expect(gradient?.getAttribute('gradientTransform')).toBe('rotate(90)');
    });
  });

  describe('RadialGradient', () => {
    it('should render basic radial gradient', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <RadialGradient id="radial1">
              <Stop offset="0%" stopColor="yellow" />
              <Stop offset="100%" stopColor="red" />
            </RadialGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('radialGradient');
      expect(gradient).toBeTruthy();
      expect(gradient?.getAttribute('id')).toBe('radial1');
    });

    it('should apply center coordinates', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <RadialGradient id="radial2" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="yellow" />
            </RadialGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('radialGradient');
      expect(gradient?.getAttribute('cx')).toBe('50%');
      expect(gradient?.getAttribute('cy')).toBe('50%');
      expect(gradient?.getAttribute('r')).toBe('50%');
    });

    it('should apply focal point coordinates', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <RadialGradient id="radial3" fx="30%" fy="30%" fr="10%">
              <Stop offset="0%" stopColor="yellow" />
            </RadialGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('radialGradient');
      expect(gradient?.getAttribute('fx')).toBe('30%');
      expect(gradient?.getAttribute('fy')).toBe('30%');
      expect(gradient?.getAttribute('fr')).toBe('10%');
    });

    it('should support reactive coordinates', () => {
      const [cx, setCx] = createSignal('25%');

      const { container } = render(() => (
        <svg>
          <defs>
            <RadialGradient id="radial4" cx={cx} cy="50%" r="50%">
              <Stop offset="0%" stopColor="yellow" />
            </RadialGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('radialGradient');
      expect(gradient?.getAttribute('cx')).toBe('25%');

      setCx('75%');
      expect(gradient?.getAttribute('cx')).toBe('75%');
    });

    it('should apply gradientUnits', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <RadialGradient id="radial5" gradientUnits="objectBoundingBox">
              <Stop offset="0%" stopColor="yellow" />
            </RadialGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('radialGradient');
      expect(gradient?.getAttribute('gradientUnits')).toBe('objectBoundingBox');
    });

    it('should apply spreadMethod', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <RadialGradient id="radial6" spreadMethod="reflect">
              <Stop offset="0%" stopColor="yellow" />
            </RadialGradient>
          </defs>
        </svg>
      ));

      const gradient = container.querySelector('radialGradient');
      expect(gradient?.getAttribute('spreadMethod')).toBe('reflect');
    });
  });

  describe('Stop', () => {
    it('should render gradient stop', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad-stop">
              <Stop offset="50%" stopColor="green" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const stop = container.querySelector('stop');
      expect(stop).toBeTruthy();
      expect(stop?.getAttribute('offset')).toBe('50%');
      expect(stop?.getAttribute('stopColor')).toBe('green');
    });

    it('should apply numeric offset', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad-stop2">
              <Stop offset={0.5} stopColor="green" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const stop = container.querySelector('stop');
      expect(stop?.getAttribute('offset')).toBe('0.5');
    });

    it('should apply stopOpacity', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad-stop3">
              <Stop offset="50%" stopColor="green" stopOpacity={0.5} />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const stop = container.querySelector('stop');
      expect(stop?.getAttribute('stopOpacity')).toBe('0.5');
    });

    it('should support reactive stopColor', () => {
      const [color, setColor] = createSignal('red');

      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad-stop4">
              <Stop offset="50%" stopColor={color} />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const stop = container.querySelector('stop');
      expect(stop?.getAttribute('stopColor')).toBe('red');

      setColor('blue');
      expect(stop?.getAttribute('stopColor')).toBe('blue');
    });

    it('should support reactive offset', () => {
      const [offset, setOffset] = createSignal('25%');

      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="grad-stop5">
              <Stop offset={offset} stopColor="green" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const stop = container.querySelector('stop');
      expect(stop?.getAttribute('offset')).toBe('25%');

      setOffset('75%');
      expect(stop?.getAttribute('offset')).toBe('75%');
    });
  });

  describe('Pattern', () => {
    it('should render basic pattern', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Pattern id="pattern1" width={10} height={10}>
              <circle cx="5" cy="5" r="3" fill="red" />
            </Pattern>
          </defs>
        </svg>
      ));

      const pattern = container.querySelector('pattern');
      expect(pattern).toBeTruthy();
      expect(pattern?.getAttribute('id')).toBe('pattern1');
      expect(pattern?.getAttribute('width')).toBe('10');
      expect(pattern?.getAttribute('height')).toBe('10');
    });

    it('should apply pattern position', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Pattern id="pattern2" x={5} y={5} width={10} height={10}>
              <rect width="10" height="10" fill="blue" />
            </Pattern>
          </defs>
        </svg>
      ));

      const pattern = container.querySelector('pattern');
      expect(pattern?.getAttribute('x')).toBe('5');
      expect(pattern?.getAttribute('y')).toBe('5');
    });

    it('should apply patternUnits', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Pattern
              id="pattern3"
              width={10}
              height={10}
              patternUnits="userSpaceOnUse"
            >
              <rect width="10" height="10" fill="blue" />
            </Pattern>
          </defs>
        </svg>
      ));

      const pattern = container.querySelector('pattern');
      expect(pattern?.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    });

    it('should apply patternContentUnits', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Pattern
              id="pattern4"
              width={10}
              height={10}
              patternContentUnits="objectBoundingBox"
            >
              <rect width="10" height="10" fill="blue" />
            </Pattern>
          </defs>
        </svg>
      ));

      const pattern = container.querySelector('pattern');
      expect(pattern?.getAttribute('patternContentUnits')).toBe('objectBoundingBox');
    });

    it('should apply patternTransform', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Pattern
              id="pattern5"
              width={10}
              height={10}
              patternTransform="rotate(45)"
            >
              <rect width="10" height="10" fill="blue" />
            </Pattern>
          </defs>
        </svg>
      ));

      const pattern = container.querySelector('pattern');
      expect(pattern?.getAttribute('patternTransform')).toBe('rotate(45)');
    });

    it('should support reactive dimensions', () => {
      const [width, setWidth] = createSignal(10);

      const { container } = render(() => (
        <svg>
          <defs>
            <Pattern id="pattern6" width={width} height={10}>
              <rect width="10" height="10" fill="blue" />
            </Pattern>
          </defs>
        </svg>
      ));

      const pattern = container.querySelector('pattern');
      expect(pattern?.getAttribute('width')).toBe('10');

      setWidth(20);
      expect(pattern?.getAttribute('width')).toBe('20');
    });
  });

  describe('Mask', () => {
    it('should render basic mask', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Mask id="mask1">
              <rect width="100" height="100" fill="white" />
            </Mask>
          </defs>
        </svg>
      ));

      const mask = container.querySelector('mask');
      expect(mask).toBeTruthy();
      expect(mask?.getAttribute('id')).toBe('mask1');
    });

    it('should apply mask dimensions', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Mask id="mask2" x={0} y={0} width={100} height={100}>
              <rect width="100" height="100" fill="white" />
            </Mask>
          </defs>
        </svg>
      ));

      const mask = container.querySelector('mask');
      expect(mask?.getAttribute('x')).toBe('0');
      expect(mask?.getAttribute('y')).toBe('0');
      expect(mask?.getAttribute('width')).toBe('100');
      expect(mask?.getAttribute('height')).toBe('100');
    });

    it('should apply maskUnits', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Mask id="mask3" maskUnits="userSpaceOnUse">
              <rect width="100" height="100" fill="white" />
            </Mask>
          </defs>
        </svg>
      ));

      const mask = container.querySelector('mask');
      expect(mask?.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    });

    it('should apply maskContentUnits', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <Mask id="mask4" maskContentUnits="objectBoundingBox">
              <rect width="100" height="100" fill="white" />
            </Mask>
          </defs>
        </svg>
      ));

      const mask = container.querySelector('mask');
      expect(mask?.getAttribute('maskContentUnits')).toBe('objectBoundingBox');
    });

    it('should support reactive dimensions', () => {
      const [width, setWidth] = createSignal(100);

      const { container } = render(() => (
        <svg>
          <defs>
            <Mask id="mask5" width={width} height={100}>
              <rect width="100" height="100" fill="white" />
            </Mask>
          </defs>
        </svg>
      ));

      const mask = container.querySelector('mask');
      expect(mask?.getAttribute('width')).toBe('100');

      setWidth(200);
      expect(mask?.getAttribute('width')).toBe('200');
    });
  });

  describe('ClipPath', () => {
    it('should render basic clipPath', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <ClipPath id="clip1">
              <circle cx="50" cy="50" r="40" />
            </ClipPath>
          </defs>
        </svg>
      ));

      const clipPath = container.querySelector('clipPath');
      expect(clipPath).toBeTruthy();
      expect(clipPath?.getAttribute('id')).toBe('clip1');
    });

    it('should apply clipPathUnits', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <ClipPath id="clip2" clipPathUnits="userSpaceOnUse">
              <circle cx="50" cy="50" r="40" />
            </ClipPath>
          </defs>
        </svg>
      ));

      const clipPath = container.querySelector('clipPath');
      expect(clipPath?.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
    });

    it('should render multiple clip shapes', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <ClipPath id="clip3">
              <circle cx="50" cy="50" r="40" />
              <rect x="30" y="30" width="40" height="40" />
            </ClipPath>
          </defs>
        </svg>
      ));

      const clipPath = container.querySelector('clipPath');
      const circle = clipPath?.querySelector('circle');
      const rect = clipPath?.querySelector('rect');

      expect(circle).toBeTruthy();
      expect(rect).toBeTruthy();
    });
  });

  describe('Complex Gradients', () => {
    it('should render multi-stop gradient', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="multi-stop">
              <Stop offset="0%" stopColor="red" />
              <Stop offset="25%" stopColor="yellow" />
              <Stop offset="50%" stopColor="green" />
              <Stop offset="75%" stopColor="blue" />
              <Stop offset="100%" stopColor="purple" />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const stops = container.querySelectorAll('stop');
      expect(stops.length).toBe(5);
    });

    it('should render gradient with opacity stops', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <LinearGradient id="opacity-gradient">
              <Stop offset="0%" stopColor="black" stopOpacity={1} />
              <Stop offset="50%" stopColor="black" stopOpacity={0.5} />
              <Stop offset="100%" stopColor="black" stopOpacity={0} />
            </LinearGradient>
          </defs>
        </svg>
      ));

      const stops = container.querySelectorAll('stop');
      expect(stops[0]?.getAttribute('stopOpacity')).toBe('1');
      expect(stops[1]?.getAttribute('stopOpacity')).toBe('0.5');
      expect(stops[2]?.getAttribute('stopOpacity')).toBe('0');
    });
  });

  describe('Integration Tests', () => {
    it('should use gradient in shape', () => {
      const { container } = render(() => (
        <svg width="200" height="200">
          <defs>
            <LinearGradient id="gradient1">
              <Stop offset="0%" stopColor="red" />
              <Stop offset="100%" stopColor="blue" />
            </LinearGradient>
          </defs>
          <rect width="200" height="200" fill="url(#gradient1)" />
        </svg>
      ));

      const rect = container.querySelector('rect');
      expect(rect?.getAttribute('fill')).toBe('url(#gradient1)');
    });

    it('should use pattern in shape', () => {
      const { container } = render(() => (
        <svg width="200" height="200">
          <defs>
            <Pattern id="pattern-test" width={20} height={20}>
              <circle cx="10" cy="10" r="5" fill="red" />
            </Pattern>
          </defs>
          <rect width="200" height="200" fill="url(#pattern-test)" />
        </svg>
      ));

      const rect = container.querySelector('rect');
      expect(rect?.getAttribute('fill')).toBe('url(#pattern-test)');
    });

    it('should use mask on shape', () => {
      const { container } = render(() => (
        <svg width="200" height="200">
          <defs>
            <Mask id="mask-test">
              <circle cx="100" cy="100" r="50" fill="white" />
            </Mask>
          </defs>
          <rect width="200" height="200" fill="red" mask="url(#mask-test)" />
        </svg>
      ));

      const rect = container.querySelector('rect');
      expect(rect?.getAttribute('mask')).toBe('url(#mask-test)');
    });

    it('should use clipPath on shape', () => {
      const { container } = render(() => (
        <svg width="200" height="200">
          <defs>
            <ClipPath id="clip-test">
              <circle cx="100" cy="100" r="50" />
            </ClipPath>
          </defs>
          <rect width="200" height="200" fill="red" clipPath="url(#clip-test)" />
        </svg>
      ));

      const rect = container.querySelector('rect');
      expect(rect?.getAttribute('clipPath')).toBe('url(#clip-test)');
    });
  });
});
