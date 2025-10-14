/**
 * Edge Case Tests for SVG Viewport Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  parseViewBox,
  formatViewBox,
  parsePreserveAspectRatio,
  calculateViewBox,
  fitToViewport,
  scaleViewBox,
  panViewBox,
  getAspectRatio,
  constrainViewBox,
  viewportToViewBox,
  viewBoxToViewport,
  type ViewBox,
  type Viewport,
  type PreserveAspectRatio,
} from '../../../src/svg/utils/viewport.js';

describe('SVG Viewport Utils - Edge Cases', () => {
  describe('parseViewBox - Invalid Inputs', () => {
    it('should throw on null input', () => {
      expect(() => parseViewBox(null as any)).toThrow();
    });

    it('should throw on undefined input', () => {
      expect(() => parseViewBox(undefined as any)).toThrow();
    });

    it('should throw on empty string', () => {
      expect(() => parseViewBox('')).toThrow();
    });

    it('should throw on malformed viewBox', () => {
      expect(() => parseViewBox('not a viewBox')).toThrow();
    });

    it('should throw on incomplete viewBox', () => {
      expect(() => parseViewBox('0 0 100')).toThrow();
    });

    it('should throw on too many values', () => {
      expect(() => parseViewBox('0 0 100 100 50')).toThrow();
    });

    it('should handle negative values', () => {
      const result = parseViewBox('-10 -20 100 200');
      expect(result).toEqual({ x: -10, y: -20, width: 100, height: 200 });
    });

    it('should handle decimal values', () => {
      const result = parseViewBox('10.5 20.7 100.25 200.99');
      expect(result.x).toBeCloseTo(10.5);
      expect(result.y).toBeCloseTo(20.7);
    });

    it('should handle scientific notation', () => {
      const result = parseViewBox('1e2 2e1 3e2 4e2');
      expect(result.x).toBe(100);
      expect(result.y).toBe(20);
    });

    it('should handle comma separators', () => {
      const result = parseViewBox('0,0,100,100');
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle mixed separators', () => {
      const result = parseViewBox('0 0, 100 100');
      expect(result).toBeDefined();
    });

    it('should handle extra whitespace', () => {
      const result = parseViewBox('  0   0   100   100  ');
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle NaN values', () => {
      expect(() => parseViewBox('NaN NaN NaN NaN')).toThrow();
    });

    it('should handle Infinity', () => {
      expect(() => parseViewBox('Infinity Infinity Infinity Infinity')).toThrow();
    });

    it('should handle zero dimensions', () => {
      const result = parseViewBox('0 0 0 0');
      expect(result).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('should handle negative dimensions', () => {
      const result = parseViewBox('0 0 -100 -100');
      expect(result.width).toBe(-100);
      expect(result.height).toBe(-100);
    });
  });

  describe('formatViewBox - Edge Cases', () => {
    it('should format normal viewBox', () => {
      const result = formatViewBox({ x: 0, y: 0, width: 100, height: 100 });
      expect(result).toBe('0 0 100 100');
    });

    it('should handle negative values', () => {
      const result = formatViewBox({ x: -10, y: -20, width: 100, height: 200 });
      expect(result).toBe('-10 -20 100 200');
    });

    it('should handle decimal values', () => {
      const result = formatViewBox({ x: 10.5, y: 20.7, width: 100.25, height: 200.99 });
      expect(result).toContain('10.5');
      expect(result).toContain('20.7');
    });

    it('should handle zero values', () => {
      const result = formatViewBox({ x: 0, y: 0, width: 0, height: 0 });
      expect(result).toBe('0 0 0 0');
    });

    it('should handle very large values', () => {
      const result = formatViewBox({ x: 1e10, y: 1e10, width: 1e10, height: 1e10 });
      expect(result).toBeDefined();
    });

    it('should handle NaN values', () => {
      const result = formatViewBox({ x: NaN, y: NaN, width: NaN, height: NaN });
      expect(result).toContain('NaN');
    });

    it('should handle Infinity', () => {
      const result = formatViewBox({ x: Infinity, y: -Infinity, width: Infinity, height: Infinity });
      expect(result).toContain('Infinity');
    });
  });

  describe('parsePreserveAspectRatio - Edge Cases', () => {
    it('should handle empty string', () => {
      const result = parsePreserveAspectRatio('');
      expect(result).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    });

    it('should handle only align', () => {
      const result = parsePreserveAspectRatio('xMinYMin');
      expect(result).toEqual({ align: 'xMinYMin', meetOrSlice: 'meet' });
    });

    it('should handle only meetOrSlice', () => {
      const result = parsePreserveAspectRatio('slice');
      expect(result.meetOrSlice).toBe('meet'); // 'slice' is in position 0, becomes align
    });

    it('should handle extra whitespace', () => {
      const result = parsePreserveAspectRatio('  xMidYMid   meet  ');
      expect(result).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    });

    it('should handle all alignment values', () => {
      const aligns = ['none', 'xMinYMin', 'xMidYMin', 'xMaxYMin', 'xMinYMid', 'xMidYMid', 'xMaxYMid', 'xMinYMax', 'xMidYMax', 'xMaxYMax'];
      aligns.forEach(align => {
        const result = parsePreserveAspectRatio(`${align} meet`);
        expect(result.align).toBe(align);
      });
    });

    it('should handle both meet and slice', () => {
      const meet = parsePreserveAspectRatio('xMidYMid meet');
      expect(meet.meetOrSlice).toBe('meet');

      const slice = parsePreserveAspectRatio('xMidYMid slice');
      expect(slice.meetOrSlice).toBe('slice');
    });
  });

  describe('calculateViewBox - Edge Cases', () => {
    it('should handle zero bounds', () => {
      const result = calculateViewBox({ x: 0, y: 0, width: 0, height: 0 });
      expect(result).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('should handle negative bounds', () => {
      const result = calculateViewBox({ x: -100, y: -100, width: 200, height: 200 });
      expect(result).toEqual({ x: -100, y: -100, width: 200, height: 200 });
    });

    it('should add padding correctly', () => {
      const result = calculateViewBox({ x: 10, y: 10, width: 80, height: 80 }, 10);
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle negative padding', () => {
      const result = calculateViewBox({ x: 10, y: 10, width: 80, height: 80 }, -5);
      expect(result).toEqual({ x: 15, y: 15, width: 70, height: 70 });
    });

    it('should handle zero padding', () => {
      const result = calculateViewBox({ x: 10, y: 10, width: 80, height: 80 }, 0);
      expect(result).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    });

    it('should handle very large padding', () => {
      const result = calculateViewBox({ x: 10, y: 10, width: 80, height: 80 }, 1000);
      expect(result.width).toBe(2080);
    });
  });

  describe('fitToViewport - Edge Cases', () => {
    it('should handle zero viewBox dimensions', () => {
      const result = fitToViewport(
        { x: 0, y: 0, width: 0, height: 0 },
        { width: 100, height: 100 }
      );
      expect(result.scale).toBe(Infinity);
    });

    it('should handle zero viewport dimensions', () => {
      const result = fitToViewport(
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 0, height: 0 }
      );
      expect(result.scale).toBe(0);
    });

    it('should handle align none', () => {
      const result = fitToViewport(
        { x: 10, y: 10, width: 100, height: 100 },
        { width: 200, height: 200 },
        { align: 'none', meetOrSlice: 'meet' }
      );
      expect(result.scale).toBe(1);
      expect(result.translateX).toBe(-10);
      expect(result.translateY).toBe(-10);
    });

    it('should handle meet mode', () => {
      const result = fitToViewport(
        { x: 0, y: 0, width: 200, height: 100 },
        { width: 100, height: 100 },
        { align: 'xMidYMid', meetOrSlice: 'meet' }
      );
      expect(result.scale).toBe(0.5);
    });

    it('should handle slice mode', () => {
      const result = fitToViewport(
        { x: 0, y: 0, width: 100, height: 200 },
        { width: 100, height: 100 },
        { align: 'xMidYMid', meetOrSlice: 'slice' }
      );
      expect(result.scale).toBe(1);
    });

    it('should handle all alignment positions', () => {
      const aligns: PreserveAspectRatio['align'][] = [
        'xMinYMin', 'xMidYMin', 'xMaxYMin',
        'xMinYMid', 'xMidYMid', 'xMaxYMid',
        'xMinYMax', 'xMidYMax', 'xMaxYMax'
      ];

      aligns.forEach(align => {
        const result = fitToViewport(
          { x: 0, y: 0, width: 100, height: 100 },
          { width: 200, height: 200 },
          { align, meetOrSlice: 'meet' }
        );
        expect(result).toBeDefined();
      });
    });

    it('should handle negative viewBox', () => {
      const result = fitToViewport(
        { x: -50, y: -50, width: 100, height: 100 },
        { width: 200, height: 200 }
      );
      expect(result).toBeDefined();
    });
  });

  describe('scaleViewBox - Edge Cases', () => {
    it('should handle scale factor of 0', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 0);
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
    });

    it('should handle scale factor of 1', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 1);
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle negative scale factor', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, -1);
      expect(result.width).toBe(-100);
      expect(result.height).toBe(-100);
    });

    it('should handle very large scale factor', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 1000);
      expect(result.width).toBe(100000);
    });

    it('should handle all anchor points', () => {
      const anchors: Array<'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'> = [
        'center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'
      ];

      anchors.forEach(anchor => {
        const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, anchor);
        expect(result.width).toBe(200);
        expect(result.height).toBe(200);
      });
    });

    it('should scale from center correctly', () => {
      const result = scaleViewBox({ x: 50, y: 50, width: 100, height: 100 }, 2, 'center');
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
    });

    it('should scale from topLeft correctly', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, 'topLeft');
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should handle NaN scale factor', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, NaN);
      expect(result.width).toBe(NaN);
    });

    it('should handle Infinity scale factor', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, Infinity);
      expect(result.width).toBe(Infinity);
    });
  });

  describe('panViewBox - Edge Cases', () => {
    it('should handle zero pan', () => {
      const original = { x: 0, y: 0, width: 100, height: 100 };
      const result = panViewBox(original, 0, 0);
      expect(result).toEqual(original);
    });

    it('should handle negative pan', () => {
      const result = panViewBox({ x: 10, y: 10, width: 100, height: 100 }, -5, -5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('should handle large pan', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, 1000, 1000);
      expect(result.x).toBe(1000);
      expect(result.y).toBe(1000);
    });

    it('should not modify dimensions', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, 10, 10);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    it('should handle NaN delta', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, NaN, NaN);
      expect(result.x).toBe(NaN);
    });

    it('should handle Infinity delta', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, Infinity, -Infinity);
      expect(result.x).toBe(Infinity);
      expect(result.y).toBe(-Infinity);
    });
  });

  describe('getAspectRatio - Edge Cases', () => {
    it('should handle square viewBox', () => {
      const ratio = getAspectRatio({ x: 0, y: 0, width: 100, height: 100 });
      expect(ratio).toBe(1);
    });

    it('should handle landscape viewBox', () => {
      const ratio = getAspectRatio({ x: 0, y: 0, width: 200, height: 100 });
      expect(ratio).toBe(2);
    });

    it('should handle portrait viewBox', () => {
      const ratio = getAspectRatio({ x: 0, y: 0, width: 100, height: 200 });
      expect(ratio).toBe(0.5);
    });

    it('should handle zero height', () => {
      const ratio = getAspectRatio({ x: 0, y: 0, width: 100, height: 0 });
      expect(ratio).toBe(Infinity);
    });

    it('should handle zero width', () => {
      const ratio = getAspectRatio({ x: 0, y: 0, width: 0, height: 100 });
      expect(ratio).toBe(0);
    });

    it('should handle negative dimensions', () => {
      const ratio = getAspectRatio({ x: 0, y: 0, width: -100, height: -100 });
      expect(ratio).toBe(1);
    });
  });

  describe('constrainViewBox - Edge Cases', () => {
    it('should constrain to bounds', () => {
      const result = constrainViewBox(
        { x: -10, y: -10, width: 120, height: 120 },
        { x: 0, y: 0, width: 100, height: 100 }
      );
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.width).toBeLessThanOrEqual(100);
      expect(result.height).toBeLessThanOrEqual(100);
    });

    it('should handle viewBox within bounds', () => {
      const viewBox = { x: 10, y: 10, width: 50, height: 50 };
      const result = constrainViewBox(
        viewBox,
        { x: 0, y: 0, width: 100, height: 100 }
      );
      expect(result).toEqual(viewBox);
    });

    it('should handle viewBox larger than bounds', () => {
      const result = constrainViewBox(
        { x: 0, y: 0, width: 200, height: 200 },
        { x: 0, y: 0, width: 100, height: 100 }
      );
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    it('should handle negative bounds', () => {
      const result = constrainViewBox(
        { x: -200, y: -200, width: 100, height: 100 },
        { x: -100, y: -100, width: 200, height: 200 }
      );
      expect(result.x).toBeGreaterThanOrEqual(-100);
    });

    it('should handle zero bounds', () => {
      const result = constrainViewBox(
        { x: 10, y: 10, width: 50, height: 50 },
        { x: 0, y: 0, width: 0, height: 0 }
      );
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
    });
  });

  describe('Coordinate Transformations - Edge Cases', () => {
    it('should handle viewportToViewBox with identity transform', () => {
      const result = viewportToViewBox(
        { x: 50, y: 50 },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 100, height: 100 }
      );
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(50);
    });

    it('should handle viewportToViewBox with scaled viewport', () => {
      const result = viewportToViewBox(
        { x: 100, y: 100 },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 200, height: 200 }
      );
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(50);
    });

    it('should handle viewBoxToViewport with identity transform', () => {
      const result = viewBoxToViewport(
        { x: 50, y: 50 },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 100, height: 100 }
      );
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(50);
    });

    it('should handle viewBoxToViewport with scaled viewport', () => {
      const result = viewBoxToViewport(
        { x: 50, y: 50 },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 200, height: 200 }
      );
      expect(result.x).toBeCloseTo(100);
      expect(result.y).toBeCloseTo(100);
    });

    it('should handle round-trip conversion', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const original = { x: 50, y: 50 };

      const viewBoxCoord = viewportToViewBox(original, viewBox, viewport);
      const backToViewport = viewBoxToViewport(viewBoxCoord, viewBox, viewport);

      expect(backToViewport.x).toBeCloseTo(original.x);
      expect(backToViewport.y).toBeCloseTo(original.y);
    });

    it('should handle negative coordinates', () => {
      const result = viewportToViewBox(
        { x: -10, y: -10 },
        { x: -50, y: -50, width: 100, height: 100 },
        { width: 100, height: 100 }
      );
      expect(result).toBeDefined();
    });

    it('should handle NaN coordinates', () => {
      const result = viewportToViewBox(
        { x: NaN, y: NaN },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 100, height: 100 }
      );
      expect(result.x).toBe(NaN);
    });
  });

  describe('Performance - Edge Cases', () => {
    it('should handle thousands of fitToViewport calls', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };

      const startTime = performance.now();
      for (let i = 0; i < 10000; i++) {
        fitToViewport(viewBox, viewport);
      }
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle rapid coordinate transformations', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };

      for (let i = 0; i < 10000; i++) {
        const point = { x: i % 100, y: i % 100 };
        viewportToViewBox(point, viewBox, viewport);
        viewBoxToViewport(point, viewBox, viewport);
      }

      expect(true).toBe(true); // Should complete without issues
    });
  });
});
