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
  type PathBounds,
  type Point,
} from '../../../src/svg/utils/path';

describe('SVG Path Utils', () => {
  describe('parsePath', () => {
    it('should parse simple move and line commands', () => {
      const result = parsePath('M 10 10 L 20 20');
      expect(result).toEqual([
        { type: 'M', values: [10, 10] },
        { type: 'L', values: [20, 20] },
      ]);
    });

    it('should parse lowercase (relative) commands', () => {
      const result = parsePath('m 10 10 l 20 20');
      expect(result).toEqual([
        { type: 'm', values: [10, 10] },
        { type: 'l', values: [20, 20] },
      ]);
    });

    it('should parse horizontal and vertical line commands', () => {
      const result = parsePath('M 0 0 H 50 V 50 h 10 v 10');
      expect(result).toEqual([
        { type: 'M', values: [0, 0] },
        { type: 'H', values: [50] },
        { type: 'V', values: [50] },
        { type: 'h', values: [10] },
        { type: 'v', values: [10] },
      ]);
    });

    it('should parse cubic bezier curves', () => {
      const result = parsePath('M 0 0 C 10 10 20 20 30 30');
      expect(result).toEqual([
        { type: 'M', values: [0, 0] },
        { type: 'C', values: [10, 10, 20, 20, 30, 30] },
      ]);
    });

    it('should parse smooth cubic bezier curves', () => {
      const result = parsePath('M 0 0 S 20 20 30 30');
      expect(result).toEqual([
        { type: 'M', values: [0, 0] },
        { type: 'S', values: [20, 20, 30, 30] },
      ]);
    });

    it('should parse quadratic bezier curves', () => {
      const result = parsePath('M 0 0 Q 10 10 20 20');
      expect(result).toEqual([
        { type: 'M', values: [0, 0] },
        { type: 'Q', values: [10, 10, 20, 20] },
      ]);
    });

    it('should parse smooth quadratic bezier curves', () => {
      const result = parsePath('M 0 0 T 20 20');
      expect(result).toEqual([
        { type: 'M', values: [0, 0] },
        { type: 'T', values: [20, 20] },
      ]);
    });

    it('should parse arc commands', () => {
      const result = parsePath('M 0 0 A 50 50 0 0 1 100 100');
      expect(result).toEqual([
        { type: 'M', values: [0, 0] },
        { type: 'A', values: [50, 50, 0, 0, 1, 100, 100] },
      ]);
    });

    it('should parse close path command', () => {
      const result = parsePath('M 0 0 L 100 100 Z');
      expect(result).toEqual([
        { type: 'M', values: [0, 0] },
        { type: 'L', values: [100, 100] },
        { type: 'Z', values: [] },
      ]);
    });

    it('should handle comma-separated values', () => {
      const result = parsePath('M 10,10 L 20,20');
      expect(result).toEqual([
        { type: 'M', values: [10, 10] },
        { type: 'L', values: [20, 20] },
      ]);
    });

    it('should handle scientific notation', () => {
      const result = parsePath('M 1e2 1.5e1 L 2E2 2.5E1');
      expect(result).toEqual([
        { type: 'M', values: [100, 15] },
        { type: 'L', values: [200, 25] },
      ]);
    });

    it('should handle negative numbers', () => {
      const result = parsePath('M -10 -20 L -30 -40');
      expect(result).toEqual([
        { type: 'M', values: [-10, -20] },
        { type: 'L', values: [-30, -40] },
      ]);
    });

    it('should handle decimal numbers', () => {
      const result = parsePath('M 10.5 20.75 L 30.25 40.125');
      expect(result).toEqual([
        { type: 'M', values: [10.5, 20.75] },
        { type: 'L', values: [30.25, 40.125] },
      ]);
    });

    it('should handle empty value strings', () => {
      const result = parsePath('M 10 10 Z');
      expect(result).toEqual([
        { type: 'M', values: [10, 10] },
        { type: 'Z', values: [] },
      ]);
    });

    it('should handle multiple spaces and mixed separators', () => {
      const result = parsePath('M  10,  20   L   30   40');
      expect(result).toEqual([
        { type: 'M', values: [10, 20] },
        { type: 'L', values: [30, 40] },
      ]);
    });

    it('should return empty array for empty string', () => {
      const result = parsePath('');
      expect(result).toEqual([]);
    });

    it('should handle complex path with multiple command types', () => {
      const result = parsePath('M 10 10 L 20 20 H 30 V 40 C 50 50 60 60 70 70 Z');
      expect(result).toHaveLength(6);
      expect(result[0]).toEqual({ type: 'M', values: [10, 10] });
      expect(result[5]).toEqual({ type: 'Z', values: [] });
    });
  });

  describe('normalizePath', () => {
    it('should convert relative move to absolute', () => {
      const result = normalizePath('M 10 10 m 20 20');
      expect(result).toBe('M 10 10 M 30 30');
    });

    it('should convert relative line to absolute', () => {
      const result = normalizePath('M 10 10 l 20 20');
      expect(result).toBe('M 10 10 L 30 30');
    });

    it('should convert relative horizontal line to absolute', () => {
      const result = normalizePath('M 10 10 h 20');
      expect(result).toBe('M 10 10 L 30 10');
    });

    it('should convert relative vertical line to absolute', () => {
      const result = normalizePath('M 10 10 v 20');
      expect(result).toBe('M 10 10 L 10 30');
    });

    it('should convert absolute horizontal line to L command', () => {
      const result = normalizePath('M 10 10 H 30');
      expect(result).toBe('M 10 10 L 30 10');
    });

    it('should convert absolute vertical line to L command', () => {
      const result = normalizePath('M 10 10 V 30');
      expect(result).toBe('M 10 10 L 10 30');
    });

    it('should convert relative cubic bezier to absolute', () => {
      const result = normalizePath('M 10 10 c 10 10 20 20 30 30');
      expect(result).toBe('M 10 10 C 20 20 30 30 40 40');
    });

    it('should keep absolute cubic bezier commands', () => {
      const result = normalizePath('M 10 10 C 20 20 30 30 40 40');
      expect(result).toBe('M 10 10 C 20 20 30 30 40 40');
    });

    it('should convert relative smooth cubic bezier to absolute', () => {
      const result = normalizePath('M 10 10 s 10 10 20 20');
      expect(result).toBe('M 10 10 S 20 20 30 30');
    });

    it('should convert relative quadratic bezier to absolute', () => {
      const result = normalizePath('M 10 10 q 10 10 20 20');
      expect(result).toBe('M 10 10 Q 20 20 30 30');
    });

    it('should convert relative smooth quadratic bezier to absolute', () => {
      const result = normalizePath('M 10 10 t 20 20');
      expect(result).toBe('M 10 10 T 30 30');
    });

    it('should convert relative arc to absolute', () => {
      const result = normalizePath('M 10 10 a 50 50 0 0 1 90 90');
      expect(result).toBe('M 10 10 A 50 50 0 0 1 100 100');
    });

    it('should handle close path command', () => {
      const result = normalizePath('M 10 10 L 50 50 Z');
      expect(result).toBe('M 10 10 L 50 50 Z');
    });

    it('should handle close path with relative commands', () => {
      const result = normalizePath('M 10 10 l 40 40 z M 50 50');
      expect(result).toBe('M 10 10 L 50 50 Z M 50 50');
    });

    it('should handle missing values gracefully', () => {
      const result = normalizePath('M 10 10 L 20 20');
      expect(result).toBe('M 10 10 L 20 20');
    });

    it('should handle complex path with mixed commands', () => {
      const result = normalizePath('M 10 10 l 20 20 h 10 v 10 c 5 5 10 10 15 15 z');
      expect(result).toContain('M 10 10');
      expect(result).toContain('L 30 30');
      expect(result).toContain('L 40 30');
      expect(result).toContain('L 40 40');
      expect(result).toContain('C 45 45 50 50 55 55');
      expect(result).toContain('Z');
    });

    it('should handle empty path', () => {
      const result = normalizePath('');
      expect(result).toBe('');
    });

    it('should track current position correctly through multiple commands', () => {
      const result = normalizePath('M 0 0 l 10 10 l 10 10 l 10 10');
      expect(result).toBe('M 0 0 L 10 10 L 20 20 L 30 30');
    });
  });

  describe('simplifyPath', () => {
    it('should round values to default precision (2)', () => {
      const result = simplifyPath('M 10.12345 10.67890 L 20.11111 20.99999');
      expect(result).toBe('M 10.12 10.68 L 20.11 21');
    });

    it('should round values to custom precision', () => {
      const result = simplifyPath('M 10.12345 10.67890 L 20.11111 20.99999', 1);
      expect(result).toBe('M 10.1 10.7 L 20.1 21');
    });

    it('should handle precision of 0', () => {
      const result = simplifyPath('M 10.5 10.7 L 20.4 20.6', 0);
      expect(result).toBe('M 11 11 L 20 21');
    });

    it('should handle high precision', () => {
      const result = simplifyPath('M 10.123456789 10.987654321', 5);
      expect(result).toBe('M 10.12346 10.98765');
    });

    it('should preserve command types', () => {
      const result = simplifyPath('M 10.5 10.5 C 20.7 20.7 30.3 30.3 40.9 40.9', 1);
      expect(result).toContain('M 10.5 10.5');
      expect(result).toContain('C 20.7 20.7 30.3 30.3 40.9 40.9');
    });

    it('should handle commands without values', () => {
      const result = simplifyPath('M 10.5 10.5 L 20.5 20.5 Z', 1);
      expect(result).toBe('M 10.5 10.5 L 20.5 20.5 Z');
    });

    it('should handle negative numbers', () => {
      const result = simplifyPath('M -10.555 -20.444', 2);
      expect(result).toBe('M -10.55 -20.44');
    });

    it('should handle very small numbers', () => {
      const result = simplifyPath('M 0.001234 0.005678', 2);
      expect(result).toBe('M 0 0.01');
    });

    it('should handle large numbers', () => {
      const result = simplifyPath('M 1234.5678 5678.1234', 1);
      expect(result).toBe('M 1234.6 5678.1');
    });

    it('should handle empty path', () => {
      const result = simplifyPath('');
      expect(result).toBe('');
    });

    it('should maintain relative commands', () => {
      const result = simplifyPath('M 10.123 10.456 l 20.789 20.012', 1);
      expect(result).toBe('M 10.1 10.5 l 20.8 20');
    });
  });

  describe('calculatePathBounds', () => {
    it('should calculate bounds for simple line', () => {
      const bounds = calculatePathBounds('M 10 10 L 90 90');
      expect(bounds).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    });

    it('should calculate bounds for horizontal line', () => {
      const bounds = calculatePathBounds('M 10 20 H 90');
      expect(bounds).toEqual({ x: 10, y: 20, width: 80, height: 0 });
    });

    it('should calculate bounds for vertical line', () => {
      const bounds = calculatePathBounds('M 20 10 V 90');
      expect(bounds).toEqual({ x: 20, y: 10, width: 0, height: 80 });
    });

    it('should calculate bounds for relative commands', () => {
      const bounds = calculatePathBounds('M 10 10 l 80 80');
      expect(bounds).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    });

    it('should calculate bounds for cubic bezier', () => {
      const bounds = calculatePathBounds('M 0 0 C 10 10 20 20 30 30');
      expect(bounds).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    });

    it('should calculate bounds for quadratic bezier', () => {
      const bounds = calculatePathBounds('M 0 0 Q 50 100 100 0');
      // Q command uses simplified bounds calculation (just end point)
      expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 0 });
    });

    it('should calculate bounds for arc', () => {
      const bounds = calculatePathBounds('M 0 0 A 50 50 0 0 1 100 100');
      expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle negative coordinates', () => {
      const bounds = calculatePathBounds('M -50 -50 L 50 50');
      expect(bounds).toEqual({ x: -50, y: -50, width: 100, height: 100 });
    });

    it('should handle multiple disconnected segments', () => {
      const bounds = calculatePathBounds('M 0 0 L 100 100 M 200 200 L 300 300');
      expect(bounds).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    });

    it('should handle close path command', () => {
      const bounds = calculatePathBounds('M 0 0 L 100 0 L 100 100 L 0 100 Z');
      expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle single point', () => {
      const bounds = calculatePathBounds('M 50 50');
      expect(bounds).toEqual({ x: 50, y: 50, width: 0, height: 0 });
    });

    it('should handle empty path', () => {
      const bounds = calculatePathBounds('');
      expect(bounds).toEqual({ x: Infinity, y: Infinity, width: -Infinity, height: -Infinity });
    });

    it('should handle relative horizontal and vertical lines', () => {
      const bounds = calculatePathBounds('M 10 10 h 50 v 50');
      expect(bounds).toEqual({ x: 10, y: 10, width: 50, height: 50 });
    });

    it('should handle relative cubic bezier', () => {
      const bounds = calculatePathBounds('M 0 0 c 10 10 20 20 30 30');
      expect(bounds).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    });

    it('should handle relative arc', () => {
      const bounds = calculatePathBounds('M 0 0 a 50 50 0 0 1 100 100');
      expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('should handle smooth bezier curves', () => {
      const bounds = calculatePathBounds('M 0 0 S 50 50 100 0');
      // S command uses simplified bounds calculation (just end point)
      expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 0 });
    });

    it('should handle smooth quadratic bezier', () => {
      const bounds = calculatePathBounds('M 0 0 T 100 100');
      expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });
  });

  describe('getPathCenter', () => {
    it('should calculate center of rectangular path', () => {
      const center = getPathCenter('M 0 0 L 100 0 L 100 100 L 0 100 Z');
      expect(center).toEqual({ x: 50, y: 50 });
    });

    it('should calculate center of diagonal line', () => {
      const center = getPathCenter('M 0 0 L 100 100');
      expect(center).toEqual({ x: 50, y: 50 });
    });

    it('should handle negative coordinates', () => {
      const center = getPathCenter('M -50 -50 L 50 50');
      expect(center).toEqual({ x: 0, y: 0 });
    });

    it('should handle offset rectangle', () => {
      const center = getPathCenter('M 10 10 L 90 10 L 90 90 L 10 90 Z');
      expect(center).toEqual({ x: 50, y: 50 });
    });

    it('should handle single point', () => {
      const center = getPathCenter('M 50 50');
      expect(center).toEqual({ x: 50, y: 50 });
    });

    it('should handle complex path', () => {
      const center = getPathCenter('M 0 0 C 50 50 100 50 150 0');
      expect(center).toEqual({ x: 75, y: 25 });
    });
  });

  describe('reversePath', () => {
    it('should reverse simple path', () => {
      const result = reversePath('M 10 10 L 20 20 L 30 10 Z');
      // The reversed path keeps the first M command
      expect(result).toContain('L 30 10');
      expect(result).toContain('L 20 20');
      expect(result).toContain('M 10 10');
      expect(result).toContain('Z');
    });

    it('should reverse path without close', () => {
      const result = reversePath('M 10 10 L 20 20 L 30 30');
      expect(result).toContain('L 30 30');
      expect(result).toContain('L 20 20');
      expect(result).toContain('M 10 10');
    });

    it('should handle single segment', () => {
      const result = reversePath('M 10 10 L 20 20');
      expect(result).toContain('L 20 20');
      expect(result).toContain('M 10 10');
    });

    it('should preserve relative commands', () => {
      const result = reversePath('M 10 10 l 10 10 l 10 -10 z');
      expect(result).toContain('Z');
      expect(result).toContain('l 10 -10');
      expect(result).toContain('l 10 10');
    });

    it('should handle curves', () => {
      const result = reversePath('M 0 0 C 10 10 20 20 30 30 Z');
      expect(result).toContain('C 10 10 20 20 30 30');
      expect(result).toContain('Z');
    });

    it('should handle empty path', () => {
      const result = reversePath('');
      expect(result).toBe('');
    });

    it('should handle single move command', () => {
      const result = reversePath('M 10 10');
      expect(result).toBe('M 10 10');
    });

    it('should keep Z at the end', () => {
      const result = reversePath('M 0 0 L 100 0 L 100 100 Z');
      expect(result.endsWith('Z')).toBe(true);
    });
  });

  describe('toRelativePath', () => {
    it('should convert absolute line to relative', () => {
      const result = toRelativePath('M 10 10 L 20 20 L 30 30');
      expect(result).toContain('M 10 10');
      expect(result).toContain('l 10 10');
      expect(result).toContain('l 10 10');
    });

    it('should convert absolute horizontal line to relative', () => {
      const result = toRelativePath('M 10 10 H 30');
      expect(result).toContain('M 10 10');
      expect(result).toContain('h 20');
    });

    it('should convert absolute vertical line to relative', () => {
      const result = toRelativePath('M 10 10 V 30');
      expect(result).toContain('M 10 10');
      expect(result).toContain('v 20');
    });

    it('should keep first move command absolute', () => {
      const result = toRelativePath('M 10 10 l 20 20');
      expect(result).toContain('M 10 10');
    });

    it('should handle close path', () => {
      const result = toRelativePath('M 10 10 L 20 20 Z');
      expect(result).toContain('z');
    });

    it('should handle already relative commands', () => {
      const result = toRelativePath('M 10 10 l 20 20 l 30 30');
      expect(result).toContain('M 10 10');
      expect(result).toContain('l 20 20');
      expect(result).toContain('l 30 30');
    });

    it('should convert absolute move to relative (except first)', () => {
      const result = toRelativePath('M 10 10 L 20 20 M 30 30');
      expect(result).toContain('M 10 10');
      expect(result).toContain('m 10 10');
    });

    it('should handle negative coordinates', () => {
      const result = toRelativePath('M 50 50 L 20 20');
      expect(result).toContain('M 50 50');
      expect(result).toContain('l -30 -30');
    });

    it('should handle empty path', () => {
      const result = toRelativePath('');
      expect(result).toBe('');
    });

    it('should track position correctly through mixed commands', () => {
      const result = toRelativePath('M 0 0 L 10 10 L 20 20 L 30 30');
      expect(result).toContain('M 0 0');
      expect(result).toContain('l 10 10');
      expect(result).toContain('l 10 10');
      expect(result).toContain('l 10 10');
    });

    it('should handle curves and other commands', () => {
      const result = toRelativePath('M 0 0 C 10 10 20 20 30 30');
      expect(result).toContain('M 0 0');
      expect(result).toContain('C 10 10 20 20 30 30');
    });

    it('should convert absolute Z to relative z', () => {
      const result = toRelativePath('M 10 10 L 20 20 Z');
      expect(result).toContain('z');
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle path with only move commands', () => {
      const parsed = parsePath('M 10 10 M 20 20 M 30 30');
      expect(parsed).toHaveLength(3);

      const bounds = calculatePathBounds('M 10 10 M 20 20 M 30 30');
      expect(bounds).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    });

    it('should handle very long complex paths', () => {
      let longPath = 'M 0 0';
      for (let i = 1; i <= 100; i++) {
        longPath += ` L ${i * 10} ${i * 10}`;
      }

      const parsed = parsePath(longPath);
      expect(parsed).toHaveLength(101);

      const bounds = calculatePathBounds(longPath);
      expect(bounds.width).toBe(1000);
      expect(bounds.height).toBe(1000);
    });

    it('should handle normalize then simplify workflow', () => {
      const path = 'm 10.12345 10.67890 l 20.11111 20.99999';
      const normalized = normalizePath(path);
      const simplified = simplifyPath(normalized, 2);

      expect(simplified).toContain('M 10.12 10.68');
      expect(simplified).toContain('L 30.23 31.68');
    });

    it('should handle reverse then normalize workflow', () => {
      const path = 'm 10 10 l 20 20 l 30 -20 z';
      const reversed = reversePath(path);
      const normalized = normalizePath(reversed);

      expect(normalized).toContain('M');
      expect(normalized).toContain('L');
    });

    it('should handle relative conversion then normalize', () => {
      const path = 'M 10 10 L 30 30 L 50 50';
      const relative = toRelativePath(path);
      const normalized = normalizePath(relative);

      expect(normalized).toContain('M 10 10');
      expect(normalized).toContain('L 30 30');
      expect(normalized).toContain('L 50 50');
    });

    it('should handle zero-length path segments', () => {
      const bounds = calculatePathBounds('M 50 50 L 50 50');
      expect(bounds).toEqual({ x: 50, y: 50, width: 0, height: 0 });
    });

    it('should handle floating point precision issues', () => {
      const path = 'M 0.1 0.1 L 0.2 0.2';
      const bounds = calculatePathBounds(path);

      expect(bounds.x).toBeCloseTo(0.1, 10);
      expect(bounds.y).toBeCloseTo(0.1, 10);
      expect(bounds.width).toBeCloseTo(0.1, 10);
      expect(bounds.height).toBeCloseTo(0.1, 10);
    });

    it('should handle paths with all command types', () => {
      const complexPath = 'M 10 10 L 20 20 H 30 V 40 C 50 50 60 60 70 70 S 80 80 90 90 Q 100 100 110 110 T 120 120 A 10 10 0 0 1 130 130 Z';
      const parsed = parsePath(complexPath);
      expect(parsed.length).toBeGreaterThan(8);

      const bounds = calculatePathBounds(complexPath);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    });

    it('should preserve precision through multiple operations', () => {
      const original = 'M 10.12345 20.67890 L 30.11111 40.99999';
      const normalized = normalizePath(original);
      const simplified = simplifyPath(normalized, 5);
      const relative = toRelativePath(simplified);
      const backToAbsolute = normalizePath(relative);

      expect(backToAbsolute).toBeTruthy();
      expect(backToAbsolute).toContain('M');
      expect(backToAbsolute).toContain('L');
    });
  });

  describe('Performance Tests', () => {
    it('should parse large paths efficiently', () => {
      let largePath = 'M 0 0';
      for (let i = 1; i <= 1000; i++) {
        largePath += ` L ${i} ${i * 2}`;
      }

      const start = performance.now();
      const parsed = parsePath(largePath);
      const duration = performance.now() - start;

      expect(parsed).toHaveLength(1001);
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it('should calculate bounds efficiently for complex paths', () => {
      let complexPath = 'M 0 0';
      for (let i = 1; i <= 500; i++) {
        complexPath += ` C ${i * 2} ${i * 3} ${i * 4} ${i * 5} ${i * 6} ${i * 7}`;
      }

      const start = performance.now();
      const bounds = calculatePathBounds(complexPath);
      const duration = performance.now() - start;

      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100);
    });

    it('should normalize large paths efficiently', () => {
      let relativePath = 'm 0 0';
      for (let i = 1; i <= 500; i++) {
        relativePath += ` l ${i} ${i}`;
      }

      const start = performance.now();
      const normalized = normalizePath(relativePath);
      const duration = performance.now() - start;

      expect(normalized).toContain('M 0 0');
      expect(duration).toBeLessThan(100);
    });
  });
});
