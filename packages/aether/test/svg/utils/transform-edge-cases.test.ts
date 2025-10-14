/**
 * Edge Case Tests for SVG Transform Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  parseTransform,
  transformToMatrix,
  multiplyMatrices,
  applyTransform,
  composeTransforms,
  decomposeMatrix,
  invertMatrix,
  isIdentityMatrix,
  createTransform,
  type TransformMatrix,
  type Transform,
} from '../../../src/svg/utils/transform.js';

describe('SVG Transform Utils - Edge Cases', () => {
  describe('parseTransform - Invalid Inputs', () => {
    it('should handle null input', () => {
      const result = parseTransform(null as any);
      expect(result).toEqual([]);
    });

    it('should handle undefined input', () => {
      const result = parseTransform(undefined as any);
      expect(result).toEqual([]);
    });

    it('should handle empty string', () => {
      const result = parseTransform('');
      expect(result).toEqual([]);
    });

    it('should handle whitespace-only string', () => {
      const result = parseTransform('   \n\t  ');
      expect(result).toEqual([]);
    });

    it('should handle malformed transform', () => {
      const result = parseTransform('translate(');
      expect(result).toEqual([]);
    });

    it('should handle transform with no values', () => {
      const result = parseTransform('translate()');
      expect(result).toHaveLength(1);
      expect(result[0]?.values).toEqual([]);
    });

    it('should handle transform with NaN values', () => {
      const result = parseTransform('translate(NaN, NaN)');
      expect(result).toHaveLength(1);
    });

    it('should handle transform with Infinity', () => {
      const result = parseTransform('translate(Infinity, -Infinity)');
      expect(result).toHaveLength(1);
    });

    it('should handle multiple transforms', () => {
      const result = parseTransform('translate(10, 20) rotate(45) scale(2)');
      expect(result).toHaveLength(3);
    });

    it('should handle transform with extra whitespace', () => {
      const result = parseTransform('  translate(  10  ,  20  )  ');
      expect(result).toHaveLength(1);
    });

    it('should handle transform with no commas', () => {
      const result = parseTransform('translate(10 20)');
      expect(result).toHaveLength(1);
      expect(result[0]?.values).toEqual([10, 20]);
    });

    it('should handle invalid transform name', () => {
      const result = parseTransform('invalid(10, 20)');
      expect(result).toEqual([]);
    });
  });

  describe('transformToMatrix - Edge Cases', () => {
    it('should handle translate with NaN', () => {
      const matrix = transformToMatrix({
        type: 'translate',
        values: [NaN, NaN],
      });
      expect(matrix).toBeDefined();
      expect(matrix[4]).toBe(0); // NaN || 0 = 0
    });

    it('should handle translate with Infinity', () => {
      const matrix = transformToMatrix({
        type: 'translate',
        values: [Infinity, -Infinity],
      });
      expect(matrix[4]).toBe(Infinity);
      expect(matrix[5]).toBe(-Infinity);
    });

    it('should handle translate with single value', () => {
      const matrix = transformToMatrix({
        type: 'translate',
        values: [10],
      });
      expect(matrix).toEqual([1, 0, 0, 1, 10, 0]);
    });

    it('should handle translate with no values', () => {
      const matrix = transformToMatrix({
        type: 'translate',
        values: [],
      });
      expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should handle scale with zero', () => {
      const matrix = transformToMatrix({
        type: 'scale',
        values: [0, 0],
      });
      expect(matrix).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('should handle scale with negative values', () => {
      const matrix = transformToMatrix({
        type: 'scale',
        values: [-1, -2],
      });
      expect(matrix).toEqual([-1, 0, 0, -2, 0, 0]);
    });

    it('should handle scale with single value', () => {
      const matrix = transformToMatrix({
        type: 'scale',
        values: [2],
      });
      expect(matrix).toEqual([2, 0, 0, 2, 0, 0]);
    });

    it('should handle rotate with zero angle', () => {
      const matrix = transformToMatrix({
        type: 'rotate',
        values: [0],
      });
      expect(matrix[0]).toBeCloseTo(1);
      expect(matrix[3]).toBeCloseTo(1);
    });

    it('should handle rotate with 360 degrees', () => {
      const matrix = transformToMatrix({
        type: 'rotate',
        values: [360],
      });
      expect(matrix[0]).toBeCloseTo(1);
      expect(matrix[3]).toBeCloseTo(1);
    });

    it('should handle rotate with negative angle', () => {
      const matrix = transformToMatrix({
        type: 'rotate',
        values: [-45],
      });
      expect(matrix).toBeDefined();
    });

    it('should handle rotate with center point', () => {
      const matrix = transformToMatrix({
        type: 'rotate',
        values: [45, 100, 100],
      });
      expect(matrix).toBeDefined();
      expect(matrix.length).toBe(6);
    });

    it('should handle skewX with zero', () => {
      const matrix = transformToMatrix({
        type: 'skewX',
        values: [0],
      });
      expect(matrix[2]).toBe(0);
    });

    it('should handle skewX with 90 degrees', () => {
      const matrix = transformToMatrix({
        type: 'skewX',
        values: [90],
      });
      expect(Math.abs(matrix[2]!)).toBeGreaterThan(1000);
    });

    it('should handle skewY with negative angle', () => {
      const matrix = transformToMatrix({
        type: 'skewY',
        values: [-30],
      });
      expect(matrix[1]).toBeLessThan(0);
    });

    it('should handle matrix with missing values', () => {
      const matrix = transformToMatrix({
        type: 'matrix',
        values: [1, 0, 0],
      });
      expect(matrix.length).toBe(6);
    });

    it('should handle matrix with extra values', () => {
      const matrix = transformToMatrix({
        type: 'matrix',
        values: [1, 0, 0, 1, 0, 0, 99, 88],
      });
      expect(matrix.length).toBe(6);
    });

    it('should handle unknown transform type', () => {
      const matrix = transformToMatrix({
        type: 'unknown' as any,
        values: [1, 2, 3],
      });
      expect(matrix).toEqual([1, 0, 0, 1, 0, 0]); // Identity matrix
    });
  });

  describe('multiplyMatrices - Edge Cases', () => {
    it('should handle identity matrices', () => {
      const identity: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = multiplyMatrices(identity, identity);
      expect(result).toEqual(identity);
    });

    it('should handle zero matrices', () => {
      const zero: TransformMatrix = [0, 0, 0, 0, 0, 0];
      const identity: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = multiplyMatrices(zero, identity);
      expect(result).toEqual(zero);
    });

    it('should handle matrices with NaN', () => {
      const m1: TransformMatrix = [NaN, 0, 0, 1, 0, 0];
      const m2: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = multiplyMatrices(m1, m2);
      expect(result[0]).toBe(NaN);
    });

    it('should handle matrices with Infinity', () => {
      const m1: TransformMatrix = [Infinity, 0, 0, 1, 0, 0];
      const m2: TransformMatrix = [2, 0, 0, 1, 0, 0];
      const result = multiplyMatrices(m1, m2);
      expect(result[0]).toBe(Infinity);
    });

    it('should handle negative values', () => {
      const m1: TransformMatrix = [-1, 0, 0, -1, 0, 0];
      const m2: TransformMatrix = [1, 0, 0, 1, 10, 10];
      const result = multiplyMatrices(m1, m2);
      expect(result[0]).toBe(-1);
      expect(result[3]).toBe(-1);
    });

    it('should be associative', () => {
      const m1: TransformMatrix = [2, 0, 0, 2, 0, 0];
      const m2: TransformMatrix = [1, 0, 0, 1, 10, 10];
      const m3: TransformMatrix = [0.5, 0, 0, 0.5, 0, 0];

      const result1 = multiplyMatrices(multiplyMatrices(m1, m2), m3);
      const result2 = multiplyMatrices(m1, multiplyMatrices(m2, m3));

      result1.forEach((val, i) => {
        expect(val).toBeCloseTo(result2[i]!);
      });
    });
  });

  describe('applyTransform - Edge Cases', () => {
    it('should handle point at origin', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 10, 10];
      const result = applyTransform(matrix, { x: 0, y: 0 });
      expect(result).toEqual({ x: 10, y: 10 });
    });

    it('should handle negative coordinates', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = applyTransform(matrix, { x: -100, y: -200 });
      expect(result).toEqual({ x: -100, y: -200 });
    });

    it('should handle NaN coordinates', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = applyTransform(matrix, { x: NaN, y: NaN });
      expect(result.x).toBe(NaN);
      expect(result.y).toBe(NaN);
    });

    it('should handle Infinity coordinates', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = applyTransform(matrix, { x: Infinity, y: -Infinity });
      expect(result.x).toBe(Infinity);
      expect(result.y).toBe(-Infinity);
    });

    it('should handle zero scale matrix', () => {
      const matrix: TransformMatrix = [0, 0, 0, 0, 10, 10];
      const result = applyTransform(matrix, { x: 100, y: 200 });
      expect(result).toEqual({ x: 10, y: 10 });
    });
  });

  describe('composeTransforms - Edge Cases', () => {
    it('should handle empty array', () => {
      const result = composeTransforms([]);
      expect(result).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should handle single transform', () => {
      const transforms: Transform[] = [
        { type: 'translate', values: [10, 20] },
      ];
      const result = composeTransforms(transforms);
      expect(result).toEqual([1, 0, 0, 1, 10, 20]);
    });

    it('should handle conflicting transforms', () => {
      const transforms: Transform[] = [
        { type: 'translate', values: [10, 10] },
        { type: 'translate', values: [-10, -10] },
      ];
      const result = composeTransforms(transforms);
      expect(result[4]).toBeCloseTo(0);
      expect(result[5]).toBeCloseTo(0);
    });

    it('should handle transforms with NaN', () => {
      const transforms: Transform[] = [
        { type: 'translate', values: [NaN, NaN] },
      ];
      const result = composeTransforms(transforms);
      expect(result).toBeDefined();
    });
  });

  describe('invertMatrix - Edge Cases', () => {
    it('should invert identity matrix to itself', () => {
      const identity: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const inverted = invertMatrix(identity);
      expect(inverted).toEqual(identity);
    });

    it('should handle non-invertible matrix (determinant = 0)', () => {
      const singular: TransformMatrix = [0, 0, 0, 0, 10, 10];
      const inverted = invertMatrix(singular);
      expect(inverted).toEqual([1, 0, 0, 1, 0, 0]); // Returns identity
    });

    it('should handle scale matrix', () => {
      const scale: TransformMatrix = [2, 0, 0, 2, 0, 0];
      const inverted = invertMatrix(scale);
      expect(inverted[0]).toBeCloseTo(0.5);
      expect(inverted[3]).toBeCloseTo(0.5);
    });

    it('should handle translate matrix', () => {
      const translate: TransformMatrix = [1, 0, 0, 1, 10, 20];
      const inverted = invertMatrix(translate);
      expect(inverted[4]).toBeCloseTo(-10);
      expect(inverted[5]).toBeCloseTo(-20);
    });

    it('should handle matrix with NaN', () => {
      const withNaN: TransformMatrix = [NaN, 0, 0, 1, 0, 0];
      const inverted = invertMatrix(withNaN);
      expect(inverted).toBeDefined();
    });

    it('should handle matrix with Infinity', () => {
      const withInf: TransformMatrix = [Infinity, 0, 0, 1, 0, 0];
      const inverted = invertMatrix(withInf);
      expect(inverted).toBeDefined();
    });

    it('should invert twice to get original', () => {
      const original: TransformMatrix = [2, 0, 0, 3, 10, 20];
      const inverted = invertMatrix(original);
      const doubleInverted = invertMatrix(inverted);

      doubleInverted.forEach((val, i) => {
        expect(val).toBeCloseTo(original[i]!);
      });
    });
  });

  describe('isIdentityMatrix - Edge Cases', () => {
    it('should recognize exact identity', () => {
      const identity: TransformMatrix = [1, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(identity)).toBe(true);
    });

    it('should handle near-identity with default tolerance', () => {
      const nearIdentity: TransformMatrix = [
        1.0000000001,
        0.0000000001,
        0.0000000001,
        1.0000000001,
        0.0000000001,
        0.0000000001,
      ];
      expect(isIdentityMatrix(nearIdentity)).toBe(true);
    });

    it('should handle custom tolerance', () => {
      const almostIdentity: TransformMatrix = [1.001, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(almostIdentity, 0.01)).toBe(true);
      expect(isIdentityMatrix(almostIdentity, 0.0001)).toBe(false);
    });

    it('should reject scale matrix', () => {
      const scale: TransformMatrix = [2, 0, 0, 2, 0, 0];
      expect(isIdentityMatrix(scale)).toBe(false);
    });

    it('should reject translate matrix', () => {
      const translate: TransformMatrix = [1, 0, 0, 1, 10, 10];
      expect(isIdentityMatrix(translate)).toBe(false);
    });

    it('should handle NaN values', () => {
      const withNaN: TransformMatrix = [NaN, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(withNaN)).toBe(false);
    });

    it('should handle Infinity values', () => {
      const withInf: TransformMatrix = [Infinity, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(withInf)).toBe(false);
    });

    it('should handle zero tolerance', () => {
      const nearIdentity: TransformMatrix = [1.0000000001, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(nearIdentity, 0)).toBe(false);
    });
  });

  describe('decomposeMatrix - Edge Cases', () => {
    it('should decompose identity matrix', () => {
      const identity: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const decomposed = decomposeMatrix(identity);
      expect(decomposed.translate).toEqual([0, 0]);
      expect(decomposed.scale[0]).toBeCloseTo(1);
      expect(decomposed.scale[1]).toBeCloseTo(1);
      expect(decomposed.rotate).toBeCloseTo(0);
    });

    it('should decompose pure translation', () => {
      const translate: TransformMatrix = [1, 0, 0, 1, 10, 20];
      const decomposed = decomposeMatrix(translate);
      expect(decomposed.translate).toEqual([10, 20]);
      expect(decomposed.scale[0]).toBeCloseTo(1);
    });

    it('should decompose pure scale', () => {
      const scale: TransformMatrix = [2, 0, 0, 3, 0, 0];
      const decomposed = decomposeMatrix(scale);
      expect(decomposed.scale[0]).toBeCloseTo(2);
      expect(decomposed.scale[1]).toBeCloseTo(3);
    });

    it('should decompose rotation', () => {
      const angle = 45 * (Math.PI / 180);
      const rotate: TransformMatrix = [
        Math.cos(angle),
        Math.sin(angle),
        -Math.sin(angle),
        Math.cos(angle),
        0,
        0,
      ];
      const decomposed = decomposeMatrix(rotate);
      expect(decomposed.rotate).toBeCloseTo(45, 1);
    });

    it('should handle negative scale', () => {
      const negScale: TransformMatrix = [-1, 0, 0, -1, 0, 0];
      const decomposed = decomposeMatrix(negScale);
      expect(decomposed.scale[0]).toBeCloseTo(1);
      expect(decomposed.scale[1]).toBeCloseTo(1);
    });

    it('should handle zero matrix', () => {
      const zero: TransformMatrix = [0, 0, 0, 0, 0, 0];
      const decomposed = decomposeMatrix(zero);
      expect(decomposed.scale[0]).toBe(0);
      expect(decomposed.scale[1]).toBe(0);
    });

    it('should handle matrix with NaN', () => {
      const withNaN: TransformMatrix = [NaN, 0, 0, 1, 0, 0];
      const decomposed = decomposeMatrix(withNaN);
      expect(decomposed).toBeDefined();
    });
  });

  describe('createTransform - Edge Cases', () => {
    it('should create translate with zero', () => {
      const transform = createTransform.translate(0, 0);
      expect(transform.values).toEqual([0, 0]);
    });

    it('should create translate with negative', () => {
      const transform = createTransform.translate(-10, -20);
      expect(transform.values).toEqual([-10, -20]);
    });

    it('should create translate with single value', () => {
      const transform = createTransform.translate(10);
      expect(transform.values).toEqual([10, 0]);
    });

    it('should create scale with zero', () => {
      const transform = createTransform.scale(0, 0);
      expect(transform.values).toEqual([0, 0]);
    });

    it('should create scale with single value', () => {
      const transform = createTransform.scale(2);
      expect(transform.values).toEqual([2]);
    });

    it('should create rotate with zero', () => {
      const transform = createTransform.rotate(0);
      expect(transform.values).toEqual([0]);
    });

    it('should create rotate with center', () => {
      const transform = createTransform.rotate(45, 100, 100);
      expect(transform.values).toEqual([45, 100, 100]);
    });

    it('should create skewX with negative', () => {
      const transform = createTransform.skewX(-30);
      expect(transform.values).toEqual([-30]);
    });

    it('should create matrix with all values', () => {
      const transform = createTransform.matrix(1, 0, 0, 1, 10, 10);
      expect(transform.values).toEqual([1, 0, 0, 1, 10, 10]);
    });
  });

  describe('Performance - Edge Cases', () => {
    it('should handle thousands of matrix multiplications', () => {
      let result: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const transform: TransformMatrix = [1, 0, 0, 1, 0.001, 0.001];

      const startTime = performance.now();
      for (let i = 0; i < 10000; i++) {
        result = multiplyMatrices(result, transform);
      }
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete in 1 second
      expect(result).toBeDefined();
    });

    it('should handle complex transform chains', () => {
      const transforms: Transform[] = [];
      for (let i = 0; i < 1000; i++) {
        transforms.push({ type: 'translate', values: [1, 1] });
      }

      const result = composeTransforms(transforms);
      expect(result[4]).toBeCloseTo(1000);
      expect(result[5]).toBeCloseTo(1000);
    });
  });
});
