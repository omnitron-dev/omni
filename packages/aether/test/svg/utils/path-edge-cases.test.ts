/**
 * Edge Case Tests for SVG Path Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  parsePath,
  normalizePath,
  simplifyPath,
  calculatePathBounds,
  getPathCenter,
  reversePath,
  toRelativePath,
  type PathCommand,
} from '../../../src/svg/utils/path.js';

describe('SVG Path Utils - Edge Cases', () => {
  describe('parsePath - Invalid Inputs', () => {
    it('should handle null input', () => {
      const result = parsePath(null as any);
      expect(result).toEqual([]);
    });

    it('should handle undefined input', () => {
      const result = parsePath(undefined as any);
      expect(result).toEqual([]);
    });

    it('should handle empty string', () => {
      const result = parsePath('');
      expect(result).toEqual([]);
    });

    it('should handle whitespace-only string', () => {
      const result = parsePath('   \n\t  ');
      expect(result).toEqual([]);
    });

    it('should handle malformed path with no commands', () => {
      const result = parsePath('10 20 30 40');
      expect(result).toEqual([]);
    });

    it('should handle path with invalid command letters', () => {
      const result = parsePath('X 10 20 Y 30 40');
      expect(result).toEqual([]);
    });

    it('should handle path with mixed case commands', () => {
      const result = parsePath('m 10 10 L 20 20');
      expect(result).toHaveLength(2);
      expect(result[0]?.type).toBe('m');
      expect(result[1]?.type).toBe('L');
    });

    it('should handle path with scientific notation', () => {
      const result = parsePath('M 1e2 2.5e-1 L 3.14e+1 4e0');
      expect(result).toHaveLength(2);
      expect(result[0]?.values).toEqual([100, 0.25]);
      expect(result[1]?.values).toEqual([31.4, 4]);
    });

    it('should handle path with NaN values', () => {
      const result = parsePath('M NaN NaN L Infinity -Infinity');
      expect(result).toHaveLength(2);
      // parseFloat('NaN') returns NaN, parseFloat('Infinity') returns Infinity
      expect(result[0]?.values.every(v => isNaN(v))).toBe(true);
    });

    it('should handle path with negative coordinates', () => {
      const result = parsePath('M -10 -20 L -30 -40');
      expect(result).toHaveLength(2);
      expect(result[0]?.values).toEqual([-10, -20]);
      expect(result[1]?.values).toEqual([-30, -40]);
    });

    it('should handle path with decimal coordinates', () => {
      const result = parsePath('M 10.5 20.7 L 30.123 40.999');
      expect(result).toHaveLength(2);
      expect(result[0]?.values).toEqual([10.5, 20.7]);
    });

    it('should handle path with comma separators', () => {
      const result = parsePath('M 10,20 L 30,40');
      expect(result).toHaveLength(2);
      expect(result[0]?.values).toEqual([10, 20]);
    });

    it('should handle path with mixed separators', () => {
      const result = parsePath('M 10 20, 30 40');
      expect(result).toHaveLength(1);
      expect(result[0]?.values).toEqual([10, 20, 30, 40]);
    });

    it('should handle path with extra whitespace', () => {
      const result = parsePath('M   10   20    L   30   40  ');
      expect(result).toHaveLength(2);
    });

    it('should handle path with no spaces', () => {
      const result = parsePath('M10,20L30,40');
      expect(result).toHaveLength(2);
    });

    it('should handle very long path with thousands of commands', () => {
      const longPath = 'M 0 0 ' + Array(10000).fill('L 1 1').join(' ');
      const result = parsePath(longPath);
      expect(result.length).toBeGreaterThan(1000);
    });
  });

  describe('normalizePath - Edge Cases', () => {
    it('should handle empty path', () => {
      const result = normalizePath('');
      expect(result).toBe('');
    });

    it('should handle path with only Z command', () => {
      const result = normalizePath('Z');
      expect(result).toBe('Z');
    });

    it('should handle path with missing values', () => {
      const result = normalizePath('M L');
      expect(result).toContain('M 0 0');
    });

    it('should handle path with NaN values', () => {
      const result = normalizePath('M NaN NaN');
      expect(result).toBeDefined();
    });

    it('should handle path with Infinity values', () => {
      const result = normalizePath('M Infinity -Infinity');
      expect(result).toBeDefined();
    });

    it('should handle relative commands at start', () => {
      const result = normalizePath('m 10 10 l 20 20');
      expect(result).toContain('M 10 10');
      expect(result).toContain('L 30 30');
    });

    it('should handle complex curve commands', () => {
      const result = normalizePath('M 0 0 C 10 10 20 20 30 30');
      expect(result).toBeDefined();
    });

    it('should handle arc commands', () => {
      const result = normalizePath('M 0 0 A 10 10 0 0 1 20 20');
      expect(result).toBeDefined();
    });

    it('should handle quadratic curves', () => {
      const result = normalizePath('M 0 0 Q 10 10 20 20');
      expect(result).toBeDefined();
    });

    it('should handle smooth curves', () => {
      const result = normalizePath('M 0 0 S 10 10 20 20');
      expect(result).toBeDefined();
    });

    it('should handle path with all command types', () => {
      const result = normalizePath(
        'M 0 0 L 10 10 H 20 V 30 C 10 20 30 40 50 50 S 60 60 70 70 Q 80 80 90 90 T 100 100 A 10 10 0 0 1 110 110 Z'
      );
      expect(result).toBeDefined();
    });
  });

  describe('simplifyPath - Boundary Conditions', () => {
    it('should handle precision of 0', () => {
      const result = simplifyPath('M 10.12345 20.67890', 0);
      expect(result).toContain('10');
      expect(result).toContain('21');
    });

    it('should handle negative precision', () => {
      const result = simplifyPath('M 10.12345 20.67890', -1);
      expect(result).toBeDefined();
    });

    it('should handle very high precision', () => {
      const result = simplifyPath('M 10.12345 20.67890', 10);
      expect(result).toContain('10.12345');
    });

    it('should handle Infinity precision', () => {
      const result = simplifyPath('M 10.12345 20.67890', Infinity);
      expect(result).toBeDefined();
    });

    it('should handle NaN precision', () => {
      const result = simplifyPath('M 10.12345 20.67890', NaN);
      expect(result).toBeDefined();
    });

    it('should handle path with zero values', () => {
      const result = simplifyPath('M 0 0 L 0 0', 2);
      expect(result).toBeDefined();
    });

    it('should handle path with very small numbers', () => {
      const result = simplifyPath('M 0.0000001 0.0000002', 2);
      expect(result).toBe('M 0 0');
    });

    it('should handle path with very large numbers', () => {
      const result = simplifyPath('M 999999999 888888888', 2);
      expect(result).toContain('999999999');
    });
  });

  describe('calculatePathBounds - Edge Cases', () => {
    it('should handle empty path', () => {
      const bounds = calculatePathBounds('');
      expect(bounds.x).toBe(Infinity);
      expect(bounds.y).toBe(Infinity);
      expect(bounds.width).toBe(-Infinity);
    });

    it('should handle single point path', () => {
      const bounds = calculatePathBounds('M 10 10');
      expect(bounds.x).toBe(10);
      expect(bounds.y).toBe(10);
      expect(bounds.width).toBe(0);
      expect(bounds.height).toBe(0);
    });

    it('should handle path with negative coordinates', () => {
      const bounds = calculatePathBounds('M -10 -20 L 30 40');
      expect(bounds.x).toBe(-10);
      expect(bounds.y).toBe(-20);
      expect(bounds.width).toBe(40);
      expect(bounds.height).toBe(60);
    });

    it('should handle path with zero dimensions', () => {
      const bounds = calculatePathBounds('M 10 10 L 10 10');
      expect(bounds.width).toBe(0);
      expect(bounds.height).toBe(0);
    });

    it('should handle path with NaN values', () => {
      const bounds = calculatePathBounds('M NaN NaN L 10 10');
      expect(bounds).toBeDefined();
    });

    it('should handle path with Infinity values', () => {
      const bounds = calculatePathBounds('M Infinity -Infinity L 10 10');
      expect(bounds).toBeDefined();
    });

    it('should handle vertical line', () => {
      const bounds = calculatePathBounds('M 10 0 V 100');
      expect(bounds.x).toBe(10);
      expect(bounds.width).toBe(0);
      expect(bounds.height).toBe(100);
    });

    it('should handle horizontal line', () => {
      const bounds = calculatePathBounds('M 0 10 H 100');
      expect(bounds.y).toBe(10);
      expect(bounds.height).toBe(0);
      expect(bounds.width).toBe(100);
    });

    it('should handle complex curves', () => {
      const bounds = calculatePathBounds('M 0 0 C 10 10 20 20 30 30');
      expect(bounds).toBeDefined();
      expect(bounds.width).toBeGreaterThan(0);
    });

    it('should handle closed path', () => {
      const bounds = calculatePathBounds('M 0 0 L 100 0 L 100 100 L 0 100 Z');
      expect(bounds.width).toBe(100);
      expect(bounds.height).toBe(100);
    });
  });

  describe('getPathCenter - Edge Cases', () => {
    it('should handle empty path', () => {
      const center = getPathCenter('');
      expect(center.x).toBe(NaN);
      expect(center.y).toBe(NaN);
    });

    it('should handle single point', () => {
      const center = getPathCenter('M 10 20');
      expect(center.x).toBe(10);
      expect(center.y).toBe(20);
    });

    it('should handle negative coordinates', () => {
      const center = getPathCenter('M -100 -100 L 100 100');
      expect(center.x).toBe(0);
      expect(center.y).toBe(0);
    });
  });

  describe('reversePath - Edge Cases', () => {
    it('should handle empty path', () => {
      const reversed = reversePath('');
      expect(reversed).toBe('');
    });

    it('should handle single command', () => {
      const reversed = reversePath('M 10 10');
      expect(reversed).toContain('M 10 10');
    });

    it('should handle path without Z', () => {
      const reversed = reversePath('M 10 10 L 20 20 L 30 30');
      expect(reversed).toBeDefined();
    });

    it('should handle path with only Z', () => {
      const reversed = reversePath('Z');
      expect(reversed).toBeDefined();
    });

    it('should handle null input', () => {
      const reversed = reversePath(null as any);
      expect(reversed).toBeDefined();
    });

    it('should handle very complex path', () => {
      const complex = 'M 0 0 L 10 10 C 20 20 30 30 40 40 Q 50 50 60 60 Z';
      const reversed = reversePath(complex);
      expect(reversed).toBeDefined();
    });
  });

  describe('toRelativePath - Edge Cases', () => {
    it('should handle empty path', () => {
      const relative = toRelativePath('');
      expect(relative).toBe('');
    });

    it('should handle single M command', () => {
      const relative = toRelativePath('M 10 10');
      expect(relative).toContain('M 10 10');
    });

    it('should handle all absolute commands', () => {
      const relative = toRelativePath('M 0 0 L 10 10 L 20 20');
      expect(relative).toBeDefined();
    });

    it('should handle all relative commands', () => {
      const relative = toRelativePath('m 10 10 l 10 10 l 10 10');
      expect(relative).toBeDefined();
    });

    it('should handle mixed absolute and relative', () => {
      const relative = toRelativePath('M 0 0 l 10 10 L 30 30');
      expect(relative).toBeDefined();
    });

    it('should handle path with curves', () => {
      const relative = toRelativePath('M 0 0 C 10 10 20 20 30 30');
      expect(relative).toBeDefined();
    });

    it('should handle path with NaN', () => {
      const relative = toRelativePath('M NaN NaN L 10 10');
      expect(relative).toBeDefined();
    });

    it('should handle path with negative deltas', () => {
      const relative = toRelativePath('M 100 100 L 50 50 L 0 0');
      expect(relative).toBeDefined();
    });
  });

  describe('Performance and Memory - Edge Cases', () => {
    it('should handle extremely long path string', () => {
      const segments = Array(100000).fill('L 1 1').join(' ');
      const longPath = `M 0 0 ${segments}`;

      const startTime = performance.now();
      const commands = parsePath(longPath);
      const endTime = performance.now();

      expect(commands.length).toBeGreaterThan(1000);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in 5 seconds
    });

    it('should handle path with thousands of decimal places', () => {
      const preciseValue = '10.' + '1'.repeat(1000);
      const path = `M ${preciseValue} ${preciseValue}`;

      const commands = parsePath(path);
      expect(commands).toBeDefined();
    });

    it('should handle rapid successive operations', () => {
      const path = 'M 0 0 L 100 100';

      for (let i = 0; i < 1000; i++) {
        parsePath(path);
        normalizePath(path);
        simplifyPath(path);
      }

      // Should complete without crashing or memory issues
      expect(true).toBe(true);
    });
  });

  describe('Malformed Data - Edge Cases', () => {
    it('should handle path with incomplete commands', () => {
      const result = parsePath('M 10 L 20');
      expect(result).toBeDefined();
    });

    it('should handle path with extra values', () => {
      const result = parsePath('M 10 20 30 40 50');
      expect(result).toBeDefined();
    });

    it('should handle path with special characters', () => {
      const result = parsePath('M 10 20 @ # $ L 30 40');
      expect(result).toBeDefined();
    });

    it('should handle path with unicode characters', () => {
      const result = parsePath('M 10 20 ⭐ L 30 40');
      expect(result).toBeDefined();
    });

    it('should handle path with null bytes', () => {
      const result = parsePath('M 10 20\0L 30 40');
      expect(result).toBeDefined();
    });

    it('should handle path with newlines and tabs', () => {
      const result = parsePath('M 10 20\nL\t30\r\n40');
      expect(result).toHaveLength(2);
    });

    it('should handle path with multiple consecutive spaces', () => {
      const result = parsePath('M    10    20    L    30    40');
      expect(result).toHaveLength(2);
    });
  });

  describe('Type Coercion - Edge Cases', () => {
    it('should handle numeric input', () => {
      const result = parsePath(123 as any);
      expect(result).toBeDefined();
    });

    it('should handle boolean input', () => {
      const result = parsePath(true as any);
      expect(result).toBeDefined();
    });

    it('should handle object input', () => {
      const result = parsePath({} as any);
      expect(result).toBeDefined();
    });

    it('should handle array input', () => {
      const result = parsePath([] as any);
      expect(result).toBeDefined();
    });
  });
});
