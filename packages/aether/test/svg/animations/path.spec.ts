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
  SVGPathElement.prototype.getTotalLength = function () {
    return 100; // Mock length
  };
  SVGPathElement.prototype.getPointAtLength = function (distance: number) {
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

  describe('Edge Cases - Path Animations', () => {
    it('should handle null path element', () => {
      expect(() => getPathLength(null as any)).not.toThrow();
    });

    it('should handle undefined path element', () => {
      expect(() => getPathLength(undefined as any)).not.toThrow();
    });

    it('should handle empty path string', () => {
      const length = getPathLength('');
      expect(length).toBeGreaterThanOrEqual(0);
    });

    it('should handle malformed path string', () => {
      const length = getPathLength('not a path');
      expect(length).toBeGreaterThanOrEqual(0);
    });

    it('should handle path with NaN coordinates', () => {
      const length = getPathLength('M NaN NaN L NaN NaN');
      expect(length).toBeGreaterThanOrEqual(0);
    });

    it('should handle path with Infinity', () => {
      const length = getPathLength('M Infinity -Infinity');
      expect(length).toBeGreaterThanOrEqual(0);
    });

    it('should handle getPointAtLength with negative distance', () => {
      const point = getPointAtLength('M 0 0 L 100 0', -10);
      expect(point).toBeDefined();
    });

    it('should handle getPointAtLength with distance > path length', () => {
      const point = getPointAtLength('M 0 0 L 100 0', 1000);
      expect(point).toBeDefined();
    });

    it('should handle getPointAtLength with NaN distance', () => {
      const point = getPointAtLength('M 0 0 L 100 0', NaN);
      expect(point).toBeDefined();
    });

    it('should handle interpolatePath with progress < 0', () => {
      const result = interpolatePath('M 0 0 L 100 0', 'M 0 0 L 0 100', -0.5);
      expect(result).toBeDefined();
    });

    it('should handle interpolatePath with progress > 1', () => {
      const result = interpolatePath('M 0 0 L 100 0', 'M 0 0 L 0 100', 1.5);
      expect(result).toBeDefined();
    });

    it('should handle interpolatePath with NaN progress', () => {
      const result = interpolatePath('M 0 0 L 100 0', 'M 0 0 L 0 100', NaN);
      expect(result).toBeDefined();
    });

    it('should handle interpolatePath with different command counts', () => {
      const result = interpolatePath('M 0 0 L 100 0', 'M 0 0 L 50 50 L 100 100', 0.5);
      expect(result).toBeDefined();
    });

    it('should handle interpolatePath with empty paths', () => {
      const result = interpolatePath('', '', 0.5);
      expect(result).toBeDefined();
    });

    it('should handle splitPath with empty string', () => {
      const segments = splitPath('');
      expect(segments).toBeInstanceOf(Array);
    });

    it('should handle splitPath with malformed path', () => {
      const segments = splitPath('not a path');
      expect(segments).toBeInstanceOf(Array);
    });

    it('should handle reversePath with empty string', () => {
      const reversed = reversePath('');
      expect(reversed).toBeDefined();
    });

    it('should handle reversePath with single command', () => {
      const reversed = reversePath('M 0 0');
      expect(reversed).toBeDefined();
    });

    it('should handle animatePathDraw with zero duration', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, { duration: 0 });
      expect(controller).toBeDefined();

      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should handle animatePathDraw with negative duration', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, { duration: -100 });
      expect(controller).toBeDefined();

      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should handle animatePathDraw with very large duration', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, { duration: 1e10 });
      expect(controller).toBeDefined();

      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should handle multiple pause/resume cycles', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, { duration: 1000 });

      for (let i = 0; i < 10; i++) {
        controller.pause();
        controller.resume();
      }

      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should handle stop without start', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, { duration: 1000 });
      controller.stop();
      controller.stop(); // Double stop

      document.body.removeChild(pathElement);
    });

    it('should handle path with zero length', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, { duration: 100 });
      expect(controller).toBeDefined();

      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should handle onUpdate throwing error', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, {
        duration: 100,
        onUpdate: () => {
          throw new Error('Update error');
        },
      });

      expect(controller).toBeDefined();

      controller.stop();
      document.body.removeChild(pathElement);
    });

    it('should handle onComplete throwing error', () => {
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', 'M 0 0 L 100 0');
      document.body.appendChild(pathElement);

      const controller = animatePathDraw(pathElement, {
        duration: 10,
        onComplete: () => {
          throw new Error('Complete error');
        },
      });

      expect(controller).toBeDefined();

      setTimeout(() => {
        controller.stop();
        document.body.removeChild(pathElement);
      }, 50);
    });
  });
});
