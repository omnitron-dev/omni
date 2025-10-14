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
  type AspectRatioAlign,
} from '../../../src/svg/utils/viewport';

describe('SVG Viewport Utils', () => {
  describe('parseViewBox', () => {
    it('should parse space-separated viewBox', () => {
      const result = parseViewBox('0 0 100 100');
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should parse comma-separated viewBox', () => {
      const result = parseViewBox('0,0,100,100');
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should parse mixed separator viewBox', () => {
      const result = parseViewBox('0 0 100 100');
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should parse viewBox with negative values', () => {
      const result = parseViewBox('-10 -10 100 100');
      expect(result).toEqual({ x: -10, y: -10, width: 100, height: 100 });
    });

    it('should parse viewBox with decimal values', () => {
      const result = parseViewBox('0.5 0.5 100.5 100.5');
      expect(result).toEqual({ x: 0.5, y: 0.5, width: 100.5, height: 100.5 });
    });

    it('should handle multiple spaces', () => {
      const result = parseViewBox('0   0   100   100');
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle leading/trailing whitespace', () => {
      const result = parseViewBox('  0 0 100 100  ');
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should throw error for invalid viewBox (too few values)', () => {
      expect(() => parseViewBox('0 0 100')).toThrow('Invalid viewBox');
    });

    it('should throw error for invalid viewBox (too many values)', () => {
      expect(() => parseViewBox('0 0 100 100 200')).toThrow('Invalid viewBox');
    });

    it('should throw error for invalid viewBox (non-numeric)', () => {
      expect(() => parseViewBox('0 0 abc 100')).toThrow('Invalid viewBox');
    });

    it('should throw error for empty string', () => {
      expect(() => parseViewBox('')).toThrow('Invalid viewBox');
    });

    it('should handle scientific notation', () => {
      const result = parseViewBox('1e2 1e2 1e3 1e3');
      expect(result).toEqual({ x: 100, y: 100, width: 1000, height: 1000 });
    });
  });

  describe('formatViewBox', () => {
    it('should format viewBox to string', () => {
      const result = formatViewBox({ x: 0, y: 0, width: 100, height: 100 });
      expect(result).toBe('0 0 100 100');
    });

    it('should format viewBox with negative values', () => {
      const result = formatViewBox({ x: -10, y: -10, width: 100, height: 100 });
      expect(result).toBe('-10 -10 100 100');
    });

    it('should format viewBox with decimal values', () => {
      const result = formatViewBox({ x: 0.5, y: 0.5, width: 100.5, height: 100.5 });
      expect(result).toBe('0.5 0.5 100.5 100.5');
    });

    it('should format viewBox with zero dimensions', () => {
      const result = formatViewBox({ x: 0, y: 0, width: 0, height: 0 });
      expect(result).toBe('0 0 0 0');
    });

    it('should format viewBox with large values', () => {
      const result = formatViewBox({ x: 1000, y: 2000, width: 5000, height: 10000 });
      expect(result).toBe('1000 2000 5000 10000');
    });
  });

  describe('parsePreserveAspectRatio', () => {
    it('should parse xMidYMid meet', () => {
      const result = parsePreserveAspectRatio('xMidYMid meet');
      expect(result).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    });

    it('should parse xMinYMin slice', () => {
      const result = parsePreserveAspectRatio('xMinYMin slice');
      expect(result).toEqual({ align: 'xMinYMin', meetOrSlice: 'slice' });
    });

    it('should parse none', () => {
      const result = parsePreserveAspectRatio('none');
      expect(result).toEqual({ align: 'none', meetOrSlice: 'meet' });
    });

    it('should default to xMidYMid for empty string', () => {
      const result = parsePreserveAspectRatio('');
      expect(result).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    });

    it('should default meetOrSlice to meet', () => {
      const result = parsePreserveAspectRatio('xMinYMin');
      expect(result).toEqual({ align: 'xMinYMin', meetOrSlice: 'meet' });
    });

    it('should parse xMaxYMax', () => {
      const result = parsePreserveAspectRatio('xMaxYMax');
      expect(result).toEqual({ align: 'xMaxYMax', meetOrSlice: 'meet' });
    });

    it('should parse xMinYMid', () => {
      const result = parsePreserveAspectRatio('xMinYMid');
      expect(result).toEqual({ align: 'xMinYMid', meetOrSlice: 'meet' });
    });

    it('should parse xMaxYMin', () => {
      const result = parsePreserveAspectRatio('xMaxYMin');
      expect(result).toEqual({ align: 'xMaxYMin', meetOrSlice: 'meet' });
    });

    it('should handle multiple spaces', () => {
      const result = parsePreserveAspectRatio('xMidYMid   meet');
      expect(result).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    });

    it('should handle leading/trailing whitespace', () => {
      const result = parsePreserveAspectRatio('  xMidYMid meet  ');
      expect(result).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    });
  });

  describe('calculateViewBox', () => {
    it('should calculate viewBox from bounds', () => {
      const result = calculateViewBox({ x: 10, y: 10, width: 80, height: 80 });
      expect(result).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    });

    it('should calculate viewBox with padding', () => {
      const result = calculateViewBox({ x: 10, y: 10, width: 80, height: 80 }, 10);
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle zero padding', () => {
      const result = calculateViewBox({ x: 0, y: 0, width: 100, height: 100 }, 0);
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle negative coordinates', () => {
      const result = calculateViewBox({ x: -50, y: -50, width: 100, height: 100 }, 10);
      expect(result).toEqual({ x: -60, y: -60, width: 120, height: 120 });
    });

    it('should handle large padding', () => {
      const result = calculateViewBox({ x: 50, y: 50, width: 100, height: 100 }, 50);
      expect(result).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    });

    it('should handle zero dimensions', () => {
      const result = calculateViewBox({ x: 50, y: 50, width: 0, height: 0 }, 10);
      expect(result).toEqual({ x: 40, y: 40, width: 20, height: 20 });
    });

    it('should handle decimal values', () => {
      const result = calculateViewBox({ x: 10.5, y: 10.5, width: 80.5, height: 80.5 }, 5.5);
      expect(result).toEqual({ x: 5, y: 5, width: 91.5, height: 91.5 });
    });
  });

  describe('fitToViewport', () => {
    it('should fit viewBox to viewport with meet', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMidYMid', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(25);
    });

    it('should fit viewBox to viewport with slice', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMidYMid', meetOrSlice: 'slice' });

      expect(result.scale).toBe(1);
      expect(result.translateX).toBe(-50);
      expect(result.translateY).toBe(0);
    });

    it('should handle none alignment', () => {
      const viewBox: ViewBox = { x: 10, y: 20, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const result = fitToViewport(viewBox, viewport, { align: 'none', meetOrSlice: 'meet' });

      expect(result.scale).toBe(1);
      expect(result.translateX).toBe(-10);
      expect(result.translateY).toBe(-20);
    });

    it('should handle xMinYMin alignment', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMinYMin', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(0);
    });

    it('should handle xMaxYMax alignment', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMaxYMax', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(50);
    });

    it('should handle xMinYMid alignment', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMinYMid', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(25);
    });

    it('should handle xMidYMin alignment', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 200 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMidYMin', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(25);
      expect(result.translateY).toBe(0);
    });

    it('should handle xMaxYMin alignment', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 200 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMaxYMin', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(50);
      expect(result.translateY).toBe(0);
    });

    it('should handle xMinYMax alignment', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMinYMax', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(50);
    });

    it('should handle xMidYMax alignment', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMidYMax', meetOrSlice: 'meet' });

      expect(result.scale).toBe(0.5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(50);
    });

    it('should handle offset viewBox', () => {
      const viewBox: ViewBox = { x: 50, y: 50, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const result = fitToViewport(viewBox, viewport, { align: 'xMidYMid', meetOrSlice: 'meet' });

      expect(result.scale).toBe(2);
      expect(result.translateX).toBe(-100);
      expect(result.translateY).toBe(-100);
    });

    it('should use default preserveAspectRatio', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const result = fitToViewport(viewBox, viewport);

      expect(result.scale).toBe(2);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(0);
    });
  });

  describe('scaleViewBox', () => {
    it('should scale viewBox from center', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, 'center');
      expect(result).toEqual({ x: -50, y: -50, width: 200, height: 200 });
    });

    it('should scale viewBox from topLeft', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, 'topLeft');
      expect(result).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    });

    it('should scale viewBox from topRight', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, 'topRight');
      expect(result).toEqual({ x: -100, y: 0, width: 200, height: 200 });
    });

    it('should scale viewBox from bottomLeft', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, 'bottomLeft');
      expect(result).toEqual({ x: 0, y: -100, width: 200, height: 200 });
    });

    it('should scale viewBox from bottomRight', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, 'bottomRight');
      expect(result).toEqual({ x: -100, y: -100, width: 200, height: 200 });
    });

    it('should handle scale less than 1', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 0.5, 'center');
      expect(result).toEqual({ x: 25, y: 25, width: 50, height: 50 });
    });

    it('should handle negative coordinates', () => {
      const result = scaleViewBox({ x: -50, y: -50, width: 100, height: 100 }, 2, 'center');
      expect(result).toEqual({ x: -100, y: -100, width: 200, height: 200 });
    });

    it('should handle zero scale', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 0, 'center');
      expect(result).toEqual({ x: 50, y: 50, width: 0, height: 0 });
    });

    it('should use center as default anchor', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2);
      expect(result).toEqual({ x: -50, y: -50, width: 200, height: 200 });
    });

    it('should handle non-square viewBox', () => {
      const result = scaleViewBox({ x: 0, y: 0, width: 200, height: 100 }, 2, 'center');
      expect(result).toEqual({ x: -100, y: -50, width: 400, height: 200 });
    });
  });

  describe('panViewBox', () => {
    it('should pan viewBox horizontally', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, 10, 0);
      expect(result).toEqual({ x: 10, y: 0, width: 100, height: 100 });
    });

    it('should pan viewBox vertically', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, 0, 10);
      expect(result).toEqual({ x: 0, y: 10, width: 100, height: 100 });
    });

    it('should pan viewBox diagonally', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, 10, 10);
      expect(result).toEqual({ x: 10, y: 10, width: 100, height: 100 });
    });

    it('should handle negative deltas', () => {
      const result = panViewBox({ x: 50, y: 50, width: 100, height: 100 }, -10, -10);
      expect(result).toEqual({ x: 40, y: 40, width: 100, height: 100 });
    });

    it('should handle zero deltas', () => {
      const result = panViewBox({ x: 10, y: 10, width: 100, height: 100 }, 0, 0);
      expect(result).toEqual({ x: 10, y: 10, width: 100, height: 100 });
    });

    it('should handle decimal deltas', () => {
      const result = panViewBox({ x: 0, y: 0, width: 100, height: 100 }, 10.5, 20.5);
      expect(result).toEqual({ x: 10.5, y: 20.5, width: 100, height: 100 });
    });

    it('should handle negative coordinates', () => {
      const result = panViewBox({ x: -50, y: -50, width: 100, height: 100 }, 10, 10);
      expect(result).toEqual({ x: -40, y: -40, width: 100, height: 100 });
    });
  });

  describe('getAspectRatio', () => {
    it('should calculate aspect ratio for square', () => {
      const result = getAspectRatio({ x: 0, y: 0, width: 100, height: 100 });
      expect(result).toBe(1);
    });

    it('should calculate aspect ratio for landscape', () => {
      const result = getAspectRatio({ x: 0, y: 0, width: 200, height: 100 });
      expect(result).toBe(2);
    });

    it('should calculate aspect ratio for portrait', () => {
      const result = getAspectRatio({ x: 0, y: 0, width: 100, height: 200 });
      expect(result).toBe(0.5);
    });

    it('should handle decimal dimensions', () => {
      const result = getAspectRatio({ x: 0, y: 0, width: 150, height: 100 });
      expect(result).toBe(1.5);
    });

    it('should return Infinity for zero height', () => {
      const result = getAspectRatio({ x: 0, y: 0, width: 100, height: 0 });
      expect(result).toBe(Infinity);
    });

    it('should handle very small dimensions', () => {
      const result = getAspectRatio({ x: 0, y: 0, width: 0.1, height: 0.05 });
      expect(result).toBeCloseTo(2, 10);
    });

    it('should handle very large dimensions', () => {
      const result = getAspectRatio({ x: 0, y: 0, width: 10000, height: 5000 });
      expect(result).toBe(2);
    });
  });

  describe('constrainViewBox', () => {
    it('should not constrain viewBox within bounds', () => {
      const viewBox: ViewBox = { x: 10, y: 10, width: 80, height: 80 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    });

    it('should constrain x position to minimum', () => {
      const viewBox: ViewBox = { x: -10, y: 10, width: 80, height: 80 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result.x).toBe(0);
    });

    it('should constrain y position to minimum', () => {
      const viewBox: ViewBox = { x: 10, y: -10, width: 80, height: 80 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result.y).toBe(0);
    });

    it('should constrain x position to maximum', () => {
      const viewBox: ViewBox = { x: 30, y: 10, width: 80, height: 80 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result.x).toBe(20);
    });

    it('should constrain y position to maximum', () => {
      const viewBox: ViewBox = { x: 10, y: 30, width: 80, height: 80 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result.y).toBe(20);
    });

    it('should constrain width to bounds', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 120, height: 80 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result.width).toBe(100);
    });

    it('should constrain height to bounds', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 80, height: 120 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result.height).toBe(100);
    });

    it('should constrain both position and dimensions', () => {
      const viewBox: ViewBox = { x: -10, y: -10, width: 120, height: 120 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle negative bounds', () => {
      const viewBox: ViewBox = { x: -60, y: -60, width: 80, height: 80 };
      const bounds: ViewBox = { x: -50, y: -50, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result.x).toBe(-50);
      expect(result.y).toBe(-50);
    });

    it('should handle viewBox smaller than bounds', () => {
      const viewBox: ViewBox = { x: 10, y: 10, width: 20, height: 20 };
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const result = constrainViewBox(viewBox, bounds);
      expect(result).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    });
  });

  describe('viewportToViewBox', () => {
    it('should convert viewport point to viewBox coordinates', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 100, y: 100 };
      const result = viewportToViewBox(point, viewBox, viewport);

      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should handle scaled viewport', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const point = { x: 50, y: 50 };
      const result = viewportToViewBox(point, viewBox, viewport, {
        align: 'xMidYMid',
        meetOrSlice: 'meet',
      });

      // Scale is 0.5, translateY is 25 for centering
      expect(result.x).toBeCloseTo(100, 1);
      expect(result.y).toBeCloseTo(50, 1);
    });

    it('should handle offset viewBox', () => {
      const viewBox: ViewBox = { x: 50, y: 50, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 100, y: 100 };
      const result = viewportToViewBox(point, viewBox, viewport);

      // With 2x scale, translateX/Y = -50 * 2 = -100
      // (100 - (-100)) / 2 + 50 = 150
      expect(result.x).toBe(150);
      expect(result.y).toBe(150);
    });

    it('should use default preserveAspectRatio', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 100, y: 100 };
      const result = viewportToViewBox(point, viewBox, viewport);

      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should handle corner points', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 0, y: 0 };
      const result = viewportToViewBox(point, viewBox, viewport);

      expect(result).toEqual({ x: 0, y: 0 });
    });

    it('should handle negative coordinates', () => {
      const viewBox: ViewBox = { x: -50, y: -50, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 100, y: 100 };
      const result = viewportToViewBox(point, viewBox, viewport);

      // With 2x scale, translateX/Y = -(-50) * 2 = 100
      // (100 - 100) / 2 + (-50) = -50
      expect(result.x).toBe(-50);
      expect(result.y).toBe(-50);
    });
  });

  describe('viewBoxToViewport', () => {
    it('should convert viewBox point to viewport coordinates', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 50, y: 50 };
      const result = viewBoxToViewport(point, viewBox, viewport);

      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('should handle scaled viewport', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const viewport: Viewport = { width: 100, height: 100 };
      const point = { x: 100, y: 50 };
      const result = viewBoxToViewport(point, viewBox, viewport, {
        align: 'xMidYMid',
        meetOrSlice: 'meet',
      });

      expect(result.x).toBeCloseTo(50, 10);
      expect(result.y).toBeCloseTo(50, 10);
    });

    it('should handle offset viewBox', () => {
      const viewBox: ViewBox = { x: 50, y: 50, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 100, y: 100 };
      const result = viewBoxToViewport(point, viewBox, viewport);

      // With 2x scale, translateX/Y = -50 * 2 = -100
      // (100-50)*2 + (-100) = 0
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should use default preserveAspectRatio', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 50, y: 50 };
      const result = viewBoxToViewport(point, viewBox, viewport);

      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('should handle corner points', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 0, y: 0 };
      const result = viewBoxToViewport(point, viewBox, viewport);

      expect(result).toEqual({ x: 0, y: 0 });
    });

    it('should handle negative coordinates', () => {
      const viewBox: ViewBox = { x: -50, y: -50, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const point = { x: 0, y: 0 };
      const result = viewBoxToViewport(point, viewBox, viewport);

      // With 2x scale, translateX/Y = -(-50) * 2 = 100
      // (0-(-50))*2 + 100 = 200
      expect(result.x).toBe(200);
      expect(result.y).toBe(200);
    });

    it('should be inverse of viewportToViewBox', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const originalPoint = { x: 50, y: 75 };

      const viewportPoint = viewBoxToViewport(originalPoint, viewBox, viewport);
      const backToViewBox = viewportToViewBox(viewportPoint, viewBox, viewport);

      expect(backToViewBox.x).toBeCloseTo(originalPoint.x, 10);
      expect(backToViewBox.y).toBeCloseTo(originalPoint.y, 10);
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle parse then format workflow', () => {
      const original = '10 20 100 200';
      const parsed = parseViewBox(original);
      const formatted = formatViewBox(parsed);
      expect(formatted).toBe(original);
    });

    it('should handle calculateViewBox then fitToViewport', () => {
      const bounds = { x: 10, y: 10, width: 80, height: 80 };
      const viewBox = calculateViewBox(bounds, 10);
      const viewport = { width: 200, height: 200 };
      const fit = fitToViewport(viewBox, viewport);

      expect(fit.scale).toBe(2);
    });

    it('should handle scaleViewBox then constrainViewBox', () => {
      const original: ViewBox = { x: 40, y: 40, width: 20, height: 20 };
      const scaled = scaleViewBox(original, 3, 'center');
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const constrained = constrainViewBox(scaled, bounds);

      expect(constrained.x).toBeGreaterThanOrEqual(bounds.x);
      expect(constrained.y).toBeGreaterThanOrEqual(bounds.y);
      expect(constrained.width).toBeLessThanOrEqual(bounds.width);
      expect(constrained.height).toBeLessThanOrEqual(bounds.height);
    });

    it('should handle coordinate conversion round trip', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };
      const original = { x: 50, y: 50 };

      const vp = viewBoxToViewport(original, viewBox, viewport);
      const vb = viewportToViewBox(vp, viewBox, viewport);

      expect(vb.x).toBeCloseTo(original.x, 10);
      expect(vb.y).toBeCloseTo(original.y, 10);
    });

    it('should handle zero-dimension viewBox', () => {
      const viewBox: ViewBox = { x: 50, y: 50, width: 0, height: 0 };
      const viewport: Viewport = { width: 100, height: 100 };
      const fit = fitToViewport(viewBox, viewport);

      expect(fit.scale).toBe(Infinity);
    });

    it('should handle very small viewBox', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 0.01, height: 0.01 };
      const viewport: Viewport = { width: 100, height: 100 };
      const fit = fitToViewport(viewBox, viewport);

      expect(fit.scale).toBe(10000);
    });

    it('should handle very large viewBox', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 10000, height: 10000 };
      const viewport: Viewport = { width: 100, height: 100 };
      const fit = fitToViewport(viewBox, viewport);

      expect(fit.scale).toBe(0.01);
    });

    it('should maintain aspect ratio through multiple operations', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 200, height: 100 };
      const originalRatio = getAspectRatio(viewBox);

      const scaled = scaleViewBox(viewBox, 2);
      const scaledRatio = getAspectRatio(scaled);

      expect(scaledRatio).toBeCloseTo(originalRatio, 10);
    });

    it('should handle pan then constrain workflow', () => {
      const viewBox: ViewBox = { x: 10, y: 10, width: 50, height: 50 };
      const panned = panViewBox(viewBox, 100, 100);
      const bounds: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const constrained = constrainViewBox(panned, bounds);

      expect(constrained.x).toBe(50);
      expect(constrained.y).toBe(50);
    });

    it('should handle all alignment modes', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 50 };
      const viewport: Viewport = { width: 100, height: 100 };

      const alignments: AspectRatioAlign[] = [
        'none',
        'xMinYMin',
        'xMidYMin',
        'xMaxYMin',
        'xMinYMid',
        'xMidYMid',
        'xMaxYMid',
        'xMinYMax',
        'xMidYMax',
        'xMaxYMax',
      ];

      alignments.forEach(align => {
        const result = fitToViewport(viewBox, viewport, { align, meetOrSlice: 'meet' });
        expect(result).toBeDefined();
        expect(result.scale).toBeGreaterThan(0);
      });
    });
  });

  describe('Performance Tests', () => {
    it('should parse many viewBoxes efficiently', () => {
      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        parseViewBox(`${i} ${i} ${i * 2} ${i * 2}`);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it('should calculate many viewBox fits efficiently', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };

      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        fitToViewport(viewBox, viewport);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it('should convert many coordinates efficiently', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };
      const viewport: Viewport = { width: 200, height: 200 };

      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        viewBoxToViewport({ x: i, y: i }, viewBox, viewport);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it('should scale many viewBoxes efficiently', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 100 };

      const start = performance.now();

      for (let i = 1; i <= 1000; i++) {
        scaleViewBox(viewBox, i / 100);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
    });
  });
});
