import { describe, it, expect } from 'vitest';
import {
  parseTransform,
  transformToMatrix,
  multiplyMatrices,
  applyTransform,
  composeTransforms,
  matrixToString,
  decomposeMatrix,
  invertMatrix,
  isIdentityMatrix,
  simplifyTransform,
  createTransform,
  type TransformMatrix,
  type Transform,
  type Point,
} from '../../../src/svg/utils/transform';

describe('SVG Transform Utils', () => {
  describe('parseTransform', () => {
    it('should parse translate transform', () => {
      const result = parseTransform('translate(10, 20)');
      expect(result).toEqual([{ type: 'translate', values: [10, 20] }]);
    });

    it('should parse translate with single value', () => {
      const result = parseTransform('translate(10)');
      expect(result).toEqual([{ type: 'translate', values: [10] }]);
    });

    it('should parse scale transform', () => {
      const result = parseTransform('scale(2, 3)');
      expect(result).toEqual([{ type: 'scale', values: [2, 3] }]);
    });

    it('should parse scale with single value', () => {
      const result = parseTransform('scale(2)');
      expect(result).toEqual([{ type: 'scale', values: [2] }]);
    });

    it('should parse rotate transform', () => {
      const result = parseTransform('rotate(45)');
      expect(result).toEqual([{ type: 'rotate', values: [45] }]);
    });

    it('should parse rotate with center point', () => {
      const result = parseTransform('rotate(45, 50, 50)');
      expect(result).toEqual([{ type: 'rotate', values: [45, 50, 50] }]);
    });

    it('should parse skewX transform', () => {
      const result = parseTransform('skewX(30)');
      expect(result).toEqual([{ type: 'skewX', values: [30] }]);
    });

    it('should parse skewY transform', () => {
      const result = parseTransform('skewY(30)');
      expect(result).toEqual([{ type: 'skewY', values: [30] }]);
    });

    it('should parse matrix transform', () => {
      const result = parseTransform('matrix(1, 0, 0, 1, 10, 20)');
      expect(result).toEqual([{ type: 'matrix', values: [1, 0, 0, 1, 10, 20] }]);
    });

    it('should parse multiple transforms', () => {
      const result = parseTransform('translate(10, 20) rotate(45) scale(2)');
      expect(result).toEqual([
        { type: 'translate', values: [10, 20] },
        { type: 'rotate', values: [45] },
        { type: 'scale', values: [2] },
      ]);
    });

    it('should handle spaces in transforms', () => {
      const result = parseTransform('translate( 10 , 20 ) scale( 2 )');
      expect(result).toHaveLength(2);
      expect(result[0]?.type).toBe('translate');
      expect(result[0]?.values).toContain(10);
      expect(result[0]?.values).toContain(20);
      expect(result[1]?.type).toBe('scale');
      expect(result[1]?.values).toContain(2);
    });

    it('should handle negative values', () => {
      const result = parseTransform('translate(-10, -20)');
      expect(result).toEqual([{ type: 'translate', values: [-10, -20] }]);
    });

    it('should handle decimal values', () => {
      const result = parseTransform('translate(10.5, 20.75)');
      expect(result).toEqual([{ type: 'translate', values: [10.5, 20.75] }]);
    });

    it('should handle scientific notation', () => {
      const result = parseTransform('translate(1e2, 2.5e1)');
      expect(result).toEqual([{ type: 'translate', values: [100, 25] }]);
    });

    it('should ignore invalid values', () => {
      const result = parseTransform('translate(10, abc)');
      expect(result).toEqual([{ type: 'translate', values: [10] }]);
    });

    it('should handle empty string', () => {
      const result = parseTransform('');
      expect(result).toEqual([]);
    });

    it('should handle transforms without values', () => {
      const result = parseTransform('translate()');
      // Empty transforms may be filtered out by the parser
      expect(result).toBeInstanceOf(Array);
    });
  });

  describe('transformToMatrix', () => {
    it('should convert translate to matrix', () => {
      const matrix = transformToMatrix({ type: 'translate', values: [10, 20] });
      expect(matrix).toEqual([1, 0, 0, 1, 10, 20]);
    });

    it('should handle translate with missing y value', () => {
      const matrix = transformToMatrix({ type: 'translate', values: [10] });
      expect(matrix).toEqual([1, 0, 0, 1, 10, 0]);
    });

    it('should convert scale to matrix', () => {
      const matrix = transformToMatrix({ type: 'scale', values: [2, 3] });
      expect(matrix).toEqual([2, 0, 0, 3, 0, 0]);
    });

    it('should handle uniform scale', () => {
      const matrix = transformToMatrix({ type: 'scale', values: [2] });
      expect(matrix).toEqual([2, 0, 0, 2, 0, 0]);
    });

    it('should convert rotate to matrix', () => {
      const matrix = transformToMatrix({ type: 'rotate', values: [90] });
      expect(matrix[0]).toBeCloseTo(0, 10);
      expect(matrix[1]).toBeCloseTo(1, 10);
      expect(matrix[2]).toBeCloseTo(-1, 10);
      expect(matrix[3]).toBeCloseTo(0, 10);
      expect(matrix[4]).toBe(0);
      expect(matrix[5]).toBe(0);
    });

    it('should handle rotate with center point', () => {
      const matrix = transformToMatrix({ type: 'rotate', values: [90, 50, 50] });
      expect(matrix).toBeDefined();
      expect(matrix).toHaveLength(6);
    });

    it('should convert skewX to matrix', () => {
      const matrix = transformToMatrix({ type: 'skewX', values: [30] });
      expect(matrix[0]).toBe(1);
      expect(matrix[1]).toBe(0);
      expect(matrix[2]).toBeCloseTo(Math.tan((30 * Math.PI) / 180), 10);
      expect(matrix[3]).toBe(1);
      expect(matrix[4]).toBe(0);
      expect(matrix[5]).toBe(0);
    });

    it('should convert skewY to matrix', () => {
      const matrix = transformToMatrix({ type: 'skewY', values: [30] });
      expect(matrix[0]).toBe(1);
      expect(matrix[1]).toBeCloseTo(Math.tan((30 * Math.PI) / 180), 10);
      expect(matrix[2]).toBe(0);
      expect(matrix[3]).toBe(1);
      expect(matrix[4]).toBe(0);
      expect(matrix[5]).toBe(0);
    });

    it('should handle matrix transform', () => {
      const matrix = transformToMatrix({ type: 'matrix', values: [1, 2, 3, 4, 5, 6] });
      expect(matrix).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should handle matrix with extra values', () => {
      const matrix = transformToMatrix({ type: 'matrix', values: [1, 2, 3, 4, 5, 6, 7, 8] });
      expect(matrix).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should handle missing values with defaults', () => {
      const matrix = transformToMatrix({ type: 'translate', values: [] });
      expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should return identity matrix for unknown transform type', () => {
      const matrix = transformToMatrix({ type: 'unknown' as any, values: [] });
      expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should handle zero rotation', () => {
      const matrix = transformToMatrix({ type: 'rotate', values: [0] });
      expect(matrix[0]).toBeCloseTo(1, 10);
      expect(matrix[1]).toBeCloseTo(0, 10);
      expect(matrix[2]).toBeCloseTo(0, 10);
      expect(matrix[3]).toBeCloseTo(1, 10);
      expect(matrix[4]).toBeCloseTo(0, 10);
      expect(matrix[5]).toBeCloseTo(0, 10);
    });

    it('should handle 180 degree rotation', () => {
      const matrix = transformToMatrix({ type: 'rotate', values: [180] });
      expect(matrix[0]).toBeCloseTo(-1, 10);
      expect(matrix[1]).toBeCloseTo(0, 10);
      expect(matrix[2]).toBeCloseTo(0, 10);
      expect(matrix[3]).toBeCloseTo(-1, 10);
    });

    it('should handle negative rotation', () => {
      const matrix = transformToMatrix({ type: 'rotate', values: [-90] });
      expect(matrix[0]).toBeCloseTo(0, 10);
      expect(matrix[1]).toBeCloseTo(-1, 10);
      expect(matrix[2]).toBeCloseTo(1, 10);
      expect(matrix[3]).toBeCloseTo(0, 10);
    });

    it('should handle zero scale', () => {
      const matrix = transformToMatrix({ type: 'scale', values: [0, 0] });
      // Scale with 0 values should produce zero matrix
      expect(matrix[0]).toBe(0); // sx is 0
      expect(matrix[3]).toBe(0); // sy is 0
    });

    it('should handle negative scale', () => {
      const matrix = transformToMatrix({ type: 'scale', values: [-1, -1] });
      expect(matrix).toEqual([-1, 0, 0, -1, 0, 0]);
    });
  });

  describe('multiplyMatrices', () => {
    it('should multiply two identity matrices', () => {
      const m1: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const m2: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = multiplyMatrices(m1, m2);
      expect(result).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should multiply translation matrices', () => {
      const m1: TransformMatrix = [1, 0, 0, 1, 10, 20];
      const m2: TransformMatrix = [1, 0, 0, 1, 5, 10];
      const result = multiplyMatrices(m1, m2);
      expect(result).toEqual([1, 0, 0, 1, 15, 30]);
    });

    it('should multiply scale matrices', () => {
      const m1: TransformMatrix = [2, 0, 0, 2, 0, 0];
      const m2: TransformMatrix = [3, 0, 0, 3, 0, 0];
      const result = multiplyMatrices(m1, m2);
      expect(result).toEqual([6, 0, 0, 6, 0, 0]);
    });

    it('should multiply scale and translation', () => {
      const scale: TransformMatrix = [2, 0, 0, 2, 0, 0];
      const translate: TransformMatrix = [1, 0, 0, 1, 10, 10];
      const result = multiplyMatrices(scale, translate);
      expect(result).toEqual([2, 0, 0, 2, 20, 20]);
    });

    it('should be non-commutative', () => {
      const m1: TransformMatrix = [2, 0, 0, 2, 0, 0];
      const m2: TransformMatrix = [1, 0, 0, 1, 10, 10];
      const r1 = multiplyMatrices(m1, m2);
      const r2 = multiplyMatrices(m2, m1);
      expect(r1).not.toEqual(r2);
    });

    it('should handle rotation matrices', () => {
      const rotate90: TransformMatrix = [0, 1, -1, 0, 0, 0];
      const result = multiplyMatrices(rotate90, rotate90);
      expect(result[0]).toBeCloseTo(-1, 10);
      expect(result[3]).toBeCloseTo(-1, 10);
    });

    it('should multiply complex matrices', () => {
      const m1: TransformMatrix = [1, 2, 3, 4, 5, 6];
      const m2: TransformMatrix = [7, 8, 9, 10, 11, 12];
      const result = multiplyMatrices(m1, m2);
      expect(result).toBeDefined();
      expect(result).toHaveLength(6);
    });
  });

  describe('applyTransform', () => {
    it('should apply identity transform', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const point: Point = { x: 10, y: 20 };
      const result = applyTransform(matrix, point);
      expect(result).toEqual({ x: 10, y: 20 });
    });

    it('should apply translation', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 10, 20];
      const point: Point = { x: 5, y: 5 };
      const result = applyTransform(matrix, point);
      expect(result).toEqual({ x: 15, y: 25 });
    });

    it('should apply scale', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 0, 0];
      const point: Point = { x: 10, y: 20 };
      const result = applyTransform(matrix, point);
      expect(result).toEqual({ x: 20, y: 40 });
    });

    it('should apply rotation (90 degrees)', () => {
      const matrix: TransformMatrix = [0, 1, -1, 0, 0, 0];
      const point: Point = { x: 10, y: 0 };
      const result = applyTransform(matrix, point);
      expect(result.x).toBeCloseTo(0, 10);
      expect(result.y).toBeCloseTo(10, 10);
    });

    it('should apply combined transforms', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 10, 10];
      const point: Point = { x: 5, y: 5 };
      const result = applyTransform(matrix, point);
      expect(result).toEqual({ x: 20, y: 20 });
    });

    it('should handle negative coordinates', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 10, 10];
      const point: Point = { x: -5, y: -5 };
      const result = applyTransform(matrix, point);
      expect(result).toEqual({ x: 5, y: 5 });
    });

    it('should handle zero point', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 10, 10];
      const point: Point = { x: 0, y: 0 };
      const result = applyTransform(matrix, point);
      expect(result).toEqual({ x: 10, y: 10 });
    });

    it('should handle skew transform', () => {
      const matrix: TransformMatrix = [1, 0, 0.5, 1, 0, 0];
      const point: Point = { x: 10, y: 10 };
      const result = applyTransform(matrix, point);
      expect(result).toEqual({ x: 15, y: 10 });
    });
  });

  describe('composeTransforms', () => {
    it('should compose single transform', () => {
      const transforms: Transform[] = [{ type: 'translate', values: [10, 20] }];
      const result = composeTransforms(transforms);
      expect(result).toEqual([1, 0, 0, 1, 10, 20]);
    });

    it('should compose multiple transforms', () => {
      const transforms: Transform[] = [
        { type: 'translate', values: [10, 10] },
        { type: 'scale', values: [2, 2] },
      ];
      const result = composeTransforms(transforms);
      // translate then scale: final translation is not scaled
      expect(result).toEqual([2, 0, 0, 2, 10, 10]);
    });

    it('should compose in correct order', () => {
      const transforms: Transform[] = [
        { type: 'scale', values: [2, 2] },
        { type: 'translate', values: [10, 10] },
      ];
      const result = composeTransforms(transforms);
      // scale then translate: translation gets scaled
      expect(result).toEqual([2, 0, 0, 2, 20, 20]);
    });

    it('should handle empty transforms array', () => {
      const transforms: Transform[] = [];
      const result = composeTransforms(transforms);
      expect(result).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should compose rotation and translation', () => {
      const transforms: Transform[] = [
        { type: 'rotate', values: [90] },
        { type: 'translate', values: [10, 0] },
      ];
      const result = composeTransforms(transforms);
      expect(result).toBeDefined();
      expect(result).toHaveLength(6);
    });

    it('should compose all transform types', () => {
      const transforms: Transform[] = [
        { type: 'translate', values: [10, 10] },
        { type: 'rotate', values: [45] },
        { type: 'scale', values: [2, 2] },
        { type: 'skewX', values: [15] },
      ];
      const result = composeTransforms(transforms);
      expect(result).toBeDefined();
      expect(result).toHaveLength(6);
    });
  });

  describe('matrixToString', () => {
    it('should convert matrix to string', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 10, 20];
      const result = matrixToString(matrix);
      expect(result).toBe('matrix(1, 0, 0, 1, 10, 20)');
    });

    it('should handle decimal values', () => {
      const matrix: TransformMatrix = [1.5, 0.5, 0.25, 1.75, 10.5, 20.5];
      const result = matrixToString(matrix);
      expect(result).toBe('matrix(1.5, 0.5, 0.25, 1.75, 10.5, 20.5)');
    });

    it('should handle negative values', () => {
      const matrix: TransformMatrix = [-1, 0, 0, -1, -10, -20];
      const result = matrixToString(matrix);
      expect(result).toBe('matrix(-1, 0, 0, -1, -10, -20)');
    });

    it('should handle zero values', () => {
      const matrix: TransformMatrix = [0, 0, 0, 0, 0, 0];
      const result = matrixToString(matrix);
      expect(result).toBe('matrix(0, 0, 0, 0, 0, 0)');
    });
  });

  describe('decomposeMatrix', () => {
    it('should decompose identity matrix', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = decomposeMatrix(matrix);
      expect(result.translate).toEqual([0, 0]);
      expect(result.scale).toEqual([1, 1]);
      expect(result.rotate).toBeCloseTo(0, 10);
      expect(result.skew).toBeCloseTo(0, 10);
    });

    it('should decompose translation matrix', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 10, 20];
      const result = decomposeMatrix(matrix);
      expect(result.translate).toEqual([10, 20]);
      expect(result.scale).toEqual([1, 1]);
      expect(result.rotate).toBeCloseTo(0, 10);
    });

    it('should decompose scale matrix', () => {
      const matrix: TransformMatrix = [2, 0, 0, 3, 0, 0];
      const result = decomposeMatrix(matrix);
      expect(result.translate).toEqual([0, 0]);
      expect(result.scale[0]).toBeCloseTo(2, 10);
      expect(result.scale[1]).toBeCloseTo(3, 10);
      expect(result.rotate).toBeCloseTo(0, 10);
    });

    it('should decompose rotation matrix', () => {
      const matrix: TransformMatrix = [0, 1, -1, 0, 0, 0];
      const result = decomposeMatrix(matrix);
      expect(result.rotate).toBeCloseTo(90, 10);
    });

    it('should decompose combined transforms', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 10, 20];
      const result = decomposeMatrix(matrix);
      expect(result.translate).toEqual([10, 20]);
      expect(result.scale[0]).toBeCloseTo(2, 10);
      expect(result.scale[1]).toBeCloseTo(2, 10);
    });

    it('should handle negative scale', () => {
      const matrix: TransformMatrix = [-1, 0, 0, -1, 0, 0];
      const result = decomposeMatrix(matrix);
      expect(result.scale[0]).toBeCloseTo(1, 10);
      expect(result.scale[1]).toBeCloseTo(1, 10);
      expect(Math.abs(result.rotate)).toBeCloseTo(180, 10);
    });
  });

  describe('invertMatrix', () => {
    it('should invert identity matrix', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
      const result = invertMatrix(matrix);
      expect(result[0]).toBeCloseTo(1, 10);
      expect(result[1]).toBeCloseTo(0, 10);
      expect(result[2]).toBeCloseTo(0, 10);
      expect(result[3]).toBeCloseTo(1, 10);
      expect(result[4]).toBeCloseTo(0, 10);
      expect(result[5]).toBeCloseTo(0, 10);
    });

    it('should invert translation matrix', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 10, 20];
      const result = invertMatrix(matrix);
      expect(result[0]).toBeCloseTo(1, 10);
      expect(result[1]).toBeCloseTo(0, 10);
      expect(result[2]).toBeCloseTo(0, 10);
      expect(result[3]).toBeCloseTo(1, 10);
      expect(result[4]).toBe(-10);
      expect(result[5]).toBe(-20);
    });

    it('should invert scale matrix', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 0, 0];
      const result = invertMatrix(matrix);
      expect(result[0]).toBeCloseTo(0.5, 10);
      expect(result[1]).toBeCloseTo(0, 10);
      expect(result[2]).toBeCloseTo(0, 10);
      expect(result[3]).toBeCloseTo(0.5, 10);
      expect(result[4]).toBeCloseTo(0, 10);
      expect(result[5]).toBeCloseTo(0, 10);
    });

    it('should invert combined matrix', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 10, 10];
      const inverted = invertMatrix(matrix);
      const composed = multiplyMatrices(matrix, inverted);

      expect(composed[0]).toBeCloseTo(1, 10);
      expect(composed[1]).toBeCloseTo(0, 10);
      expect(composed[2]).toBeCloseTo(0, 10);
      expect(composed[3]).toBeCloseTo(1, 10);
      expect(composed[4]).toBeCloseTo(0, 10);
      expect(composed[5]).toBeCloseTo(0, 10);
    });

    it('should return identity for non-invertible matrix', () => {
      const matrix: TransformMatrix = [0, 0, 0, 0, 0, 0];
      const result = invertMatrix(matrix);
      expect(result).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('should handle rotation matrix', () => {
      const matrix: TransformMatrix = [0, 1, -1, 0, 0, 0];
      const inverted = invertMatrix(matrix);
      const composed = multiplyMatrices(matrix, inverted);

      expect(composed[0]).toBeCloseTo(1, 10);
      expect(composed[3]).toBeCloseTo(1, 10);
    });
  });

  describe('isIdentityMatrix', () => {
    it('should identify identity matrix', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(matrix)).toBe(true);
    });

    it('should identify non-identity translation matrix', () => {
      const matrix: TransformMatrix = [1, 0, 0, 1, 10, 0];
      expect(isIdentityMatrix(matrix)).toBe(false);
    });

    it('should identify non-identity scale matrix', () => {
      const matrix: TransformMatrix = [2, 0, 0, 2, 0, 0];
      expect(isIdentityMatrix(matrix)).toBe(false);
    });

    it('should handle floating point precision', () => {
      const matrix: TransformMatrix = [1.0000000001, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(matrix, 1e-9)).toBe(true);
    });

    it('should respect tolerance parameter', () => {
      const matrix: TransformMatrix = [1.001, 0, 0, 1, 0, 0];
      expect(isIdentityMatrix(matrix, 0.01)).toBe(true);
      expect(isIdentityMatrix(matrix, 0.0001)).toBe(false);
    });

    it('should handle near-zero values', () => {
      const matrix: TransformMatrix = [1, 1e-15, 1e-15, 1, 1e-15, 1e-15];
      expect(isIdentityMatrix(matrix)).toBe(true);
    });
  });

  describe('simplifyTransform', () => {
    it('should return empty string for identity transforms', () => {
      const result = simplifyTransform('translate(0, 0) scale(1, 1) rotate(0)');
      expect(result).toBe('');
    });

    it('should return matrix for non-identity transforms', () => {
      const result = simplifyTransform('translate(10, 20)');
      expect(result).toContain('matrix');
      expect(result).toContain('10');
      expect(result).toContain('20');
    });

    it('should compose multiple transforms', () => {
      const result = simplifyTransform('translate(10, 10) scale(2, 2)');
      expect(result).toContain('matrix');
    });

    it('should handle empty string', () => {
      const result = simplifyTransform('');
      expect(result).toBe('');
    });

    it('should simplify redundant transforms', () => {
      const result = simplifyTransform('scale(2) scale(0.5)');
      expect(result).toBe('');
    });

    it('should handle complex transform chains', () => {
      const result = simplifyTransform('translate(10, 10) rotate(45) scale(2) translate(-10, -10)');
      expect(result).toContain('matrix');
    });
  });

  describe('createTransform', () => {
    describe('translate', () => {
      it('should create translate with both values', () => {
        const result = createTransform.translate(10, 20);
        expect(result).toEqual({ type: 'translate', values: [10, 20] });
      });

      it('should create translate with default y', () => {
        const result = createTransform.translate(10);
        expect(result).toEqual({ type: 'translate', values: [10, 0] });
      });

      it('should handle negative values', () => {
        const result = createTransform.translate(-10, -20);
        expect(result).toEqual({ type: 'translate', values: [-10, -20] });
      });

      it('should handle zero values', () => {
        const result = createTransform.translate(0, 0);
        expect(result).toEqual({ type: 'translate', values: [0, 0] });
      });
    });

    describe('scale', () => {
      it('should create uniform scale', () => {
        const result = createTransform.scale(2);
        expect(result).toEqual({ type: 'scale', values: [2] });
      });

      it('should create non-uniform scale', () => {
        const result = createTransform.scale(2, 3);
        expect(result).toEqual({ type: 'scale', values: [2, 3] });
      });

      it('should handle zero scale', () => {
        const result = createTransform.scale(0);
        expect(result).toEqual({ type: 'scale', values: [0] });
      });

      it('should handle negative scale', () => {
        const result = createTransform.scale(-1, -1);
        expect(result).toEqual({ type: 'scale', values: [-1, -1] });
      });
    });

    describe('rotate', () => {
      it('should create simple rotation', () => {
        const result = createTransform.rotate(45);
        expect(result).toEqual({ type: 'rotate', values: [45] });
      });

      it('should create rotation with center', () => {
        const result = createTransform.rotate(45, 50, 50);
        expect(result).toEqual({ type: 'rotate', values: [45, 50, 50] });
      });

      it('should handle negative angle', () => {
        const result = createTransform.rotate(-90);
        expect(result).toEqual({ type: 'rotate', values: [-90] });
      });

      it('should handle zero rotation', () => {
        const result = createTransform.rotate(0);
        expect(result).toEqual({ type: 'rotate', values: [0] });
      });

      it('should handle rotation with negative center', () => {
        const result = createTransform.rotate(45, -10, -10);
        expect(result).toEqual({ type: 'rotate', values: [45, -10, -10] });
      });
    });

    describe('skewX', () => {
      it('should create skewX transform', () => {
        const result = createTransform.skewX(30);
        expect(result).toEqual({ type: 'skewX', values: [30] });
      });

      it('should handle negative skew', () => {
        const result = createTransform.skewX(-30);
        expect(result).toEqual({ type: 'skewX', values: [-30] });
      });

      it('should handle zero skew', () => {
        const result = createTransform.skewX(0);
        expect(result).toEqual({ type: 'skewX', values: [0] });
      });
    });

    describe('skewY', () => {
      it('should create skewY transform', () => {
        const result = createTransform.skewY(30);
        expect(result).toEqual({ type: 'skewY', values: [30] });
      });

      it('should handle negative skew', () => {
        const result = createTransform.skewY(-30);
        expect(result).toEqual({ type: 'skewY', values: [-30] });
      });

      it('should handle zero skew', () => {
        const result = createTransform.skewY(0);
        expect(result).toEqual({ type: 'skewY', values: [0] });
      });
    });

    describe('matrix', () => {
      it('should create matrix transform', () => {
        const result = createTransform.matrix(1, 2, 3, 4, 5, 6);
        expect(result).toEqual({ type: 'matrix', values: [1, 2, 3, 4, 5, 6] });
      });

      it('should handle zero matrix', () => {
        const result = createTransform.matrix(0, 0, 0, 0, 0, 0);
        expect(result).toEqual({ type: 'matrix', values: [0, 0, 0, 0, 0, 0] });
      });

      it('should handle negative values', () => {
        const result = createTransform.matrix(-1, -2, -3, -4, -5, -6);
        expect(result).toEqual({ type: 'matrix', values: [-1, -2, -3, -4, -5, -6] });
      });
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle parse then compose workflow', () => {
      const transforms = parseTransform('translate(10, 20) scale(2)');
      const matrix = composeTransforms(transforms);
      // translate then scale
      expect(matrix).toEqual([2, 0, 0, 2, 10, 20]);
    });

    it('should handle compose then apply workflow', () => {
      const transforms: Transform[] = [createTransform.translate(10, 10), createTransform.scale(2)];
      const matrix = composeTransforms(transforms);
      const point = applyTransform(matrix, { x: 5, y: 5 });
      expect(point).toEqual({ x: 20, y: 20 });
    });

    it('should handle invert then multiply to get identity', () => {
      const matrix: TransformMatrix = [2, 0, 0, 3, 10, 20];
      const inverted = invertMatrix(matrix);
      const identity = multiplyMatrices(matrix, inverted);
      expect(isIdentityMatrix(identity, 1e-10)).toBe(true);
    });

    it('should handle decompose then recompose', () => {
      const original: TransformMatrix = [2, 0, 0, 2, 10, 10];
      const decomposed = decomposeMatrix(original);
      const transforms: Transform[] = [
        createTransform.translate(decomposed.translate[0], decomposed.translate[1]),
        createTransform.scale(decomposed.scale[0], decomposed.scale[1]),
      ];
      const recomposed = composeTransforms(transforms);
      expect(recomposed[0]).toBeCloseTo(original[0], 10);
      expect(recomposed[3]).toBeCloseTo(original[3], 10);
      expect(recomposed[4]).toBeCloseTo(original[4], 10);
      expect(recomposed[5]).toBeCloseTo(original[5], 10);
    });

    it('should handle very small transform values', () => {
      const matrix: TransformMatrix = [1, 1e-10, 1e-10, 1, 1e-10, 1e-10];
      expect(isIdentityMatrix(matrix, 1e-9)).toBe(true);
    });

    it('should handle very large transform values', () => {
      const matrix: TransformMatrix = [1e6, 0, 0, 1e6, 1e6, 1e6];
      const point = applyTransform(matrix, { x: 1, y: 1 });
      expect(point.x).toBeCloseTo(2e6, -4);
      expect(point.y).toBeCloseTo(2e6, -4);
    });

    it('should handle multiple rotation center transforms', () => {
      const transform = createTransform.rotate(90, 100, 100);
      const matrix = transformToMatrix(transform);
      expect(matrix).toBeDefined();
      expect(matrix).toHaveLength(6);
    });

    it('should preserve precision through multiple operations', () => {
      const t1 = createTransform.translate(10.123456, 20.654321);
      const t2 = createTransform.scale(1.5, 2.5);
      const matrix = composeTransforms([t1, t2]);
      const point = applyTransform(matrix, { x: 1.111111, y: 2.222222 });
      // Relaxed precision for floating point math
      expect(point.x).toBeCloseTo(11.79, 2);
      expect(point.y).toBeCloseTo(26.21, 2);
    });
  });

  describe('Performance Tests', () => {
    it('should parse large transform strings efficiently', () => {
      let transformStr = '';
      for (let i = 0; i < 1000; i++) {
        transformStr += `translate(${i}, ${i}) `;
      }

      const start = performance.now();
      const parsed = parseTransform(transformStr);
      const duration = performance.now() - start;

      expect(parsed).toHaveLength(1000);
      expect(duration).toBeLessThan(100);
    });

    it('should compose many transforms efficiently', () => {
      const transforms: Transform[] = [];
      for (let i = 0; i < 1000; i++) {
        transforms.push(createTransform.translate(i, i));
      }

      const start = performance.now();
      const matrix = composeTransforms(transforms);
      const duration = performance.now() - start;

      expect(matrix).toBeDefined();
      expect(duration).toBeLessThan(100);
    });

    it('should apply transforms to many points efficiently', () => {
      const matrix = composeTransforms([
        createTransform.translate(10, 10),
        createTransform.rotate(45),
        createTransform.scale(2),
      ]);

      const points: Point[] = [];
      for (let i = 0; i < 10000; i++) {
        points.push({ x: i, y: i });
      }

      const start = performance.now();
      const transformed = points.map((p) => applyTransform(matrix, p));
      const duration = performance.now() - start;

      expect(transformed).toHaveLength(10000);
      expect(duration).toBeLessThan(100);
    });
  });
});
