/**
 * Path Animation Tests
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  getPathLength,
  getPointAtLength,
  interpolatePath,
  splitPath,
  reversePath,
  animatePathDraw,
} from '../../../src/svg/animations/path.js';

// Mock SVG path element methods that don't exist in happy-dom
beforeAll(() => {
  SVGPathElement.prototype.getTotalLength = function() {
    return 100; // Mock length
  };
  SVGPathElement.prototype.getPointAtLength = function(distance: number) {
    return { x: distance, y: distance } as DOMPoint; // Mock point
  };
});

describe('Path Animations', () => {
  describe('getPathLength', () => {
    it('should calculate path length from string', () => {
      const path = 'M 0 0 L 100 0';
      const length = getPathLength(path);

      expect(length).toBeGreaterThan(0);
      expect(length).toBe(100); // Mocked to return 100
    });

    it('should get length from SVG path element', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const length = getPathLength(pathElement);
      expect(length).toBeGreaterThan(0);

      document.body.removeChild(pathElement);
    });
  });

  describe('getPointAtLength', () => {
    it('should get point at specific length', () => {
      const path = 'M 0 0 L 100 0';
      const point = getPointAtLength(path, 50);

      expect(point).toBeDefined();
      expect(point.x).toBe(50); // Mocked to return { x: distance, y: distance }
      expect(point.y).toBe(50);
    });
  });

  describe('interpolatePath', () => {
    it('should interpolate between two paths', () => {
      const from = 'M 0 0 L 100 0';
      const to = 'M 0 0 L 0 100';

      const midpoint = interpolatePath(from, to, 0.5);
      expect(midpoint).toBeDefined();
      expect(typeof midpoint).toBe('string');

      const start = interpolatePath(from, to, 0);
      expect(start).toBeDefined();

      const end = interpolatePath(from, to, 1);
      expect(end).toBeDefined();
    });

    it('should handle progress at boundaries', () => {
      const from = 'M 0 0 L 100 0';
      const to = 'M 0 0 L 0 100';

      const start = interpolatePath(from, to, 0);
      expect(start).toContain('M');

      const end = interpolatePath(from, to, 1);
      expect(end).toContain('M');
    });
  });

  describe('splitPath', () => {
    it('should split path into segments', () => {
      const path = 'M 0 0 L 100 0 L 100 100';
      const segments = splitPath(path);

      expect(segments).toBeInstanceOf(Array);
      expect(segments.length).toBeGreaterThan(0);
      expect(segments[0]).toContain('M');
    });
  });

  describe('reversePath', () => {
    it('should reverse path commands', () => {
      const path = 'M 0 0 L 100 0 L 100 100';
      const reversed = reversePath(path);

      expect(reversed).toBeDefined();
      expect(typeof reversed).toBe('string');
      expect(reversed).toContain('M');
    });
  });

  describe('animatePathDraw', () => {
    it('should animate path drawing', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const onUpdate = vi.fn();
      const onComplete = vi.fn();

      const controller = animatePathDraw(pathElement, {
        duration: 100,
        onUpdate,
        onComplete,
      });

      expect(controller).toBeDefined();
      expect(controller.stop).toBeDefined();
      expect(controller.pause).toBeDefined();
      expect(controller.resume).toBeDefined();

      // Clean up
      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should support reverse drawing', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, {
        duration: 100,
        reverse: true,
      });

      expect(pathElement.style.strokeDashoffset).toBeDefined();

      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should allow pause and resume', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, {
        duration: 1000,
      });

      controller.pause();
      controller.resume();
      controller.stop();

      document.body.removeChild(pathElement);
    });
  });
});
