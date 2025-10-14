/**
 * SVG Transform Utilities
 *
 * Utilities for parsing, applying, and composing SVG transforms.
 *
 * @module svg/utils/transform
 */

/**
 * Transform matrix [a, b, c, d, e, f]
 * Represents: [a c e]
 *             [b d f]
 *             [0 0 1]
 */
export type TransformMatrix = [number, number, number, number, number, number];

/**
 * Transform object
 */
export interface Transform {
  type: 'matrix' | 'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY';
  values: number[];
}

/**
 * Point for transformation
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Parse transform string into transform objects
 *
 * @param transformString - SVG transform attribute value
 * @returns Array of transform objects
 *
 * @example
 * ```typescript
 * const transforms = parseTransform('translate(10, 20) rotate(45)');
 * // [
 * //   { type: 'translate', values: [10, 20] },
 * //   { type: 'rotate', values: [45] }
 * // ]
 * ```
 */
export function parseTransform(transformString: string): Transform[] {
  const transforms: Transform[] = [];
  const regex = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;

  while ((match = regex.exec(transformString)) !== null) {
    const type = match[1] as Transform['type'];
    const valuesStr = match[2];
    // Handle empty values string
    const values = valuesStr ? valuesStr.split(/[,\s]+/).map(Number).filter((n) => !isNaN(n)) : [];

    transforms.push({ type, values });
  }

  return transforms;
}

/**
 * Convert transform to matrix
 *
 * @param transform - Transform object
 * @returns Transform matrix
 *
 * @example
 * ```typescript
 * const matrix = transformToMatrix({ type: 'translate', values: [10, 20] });
 * // [1, 0, 0, 1, 10, 20]
 * ```
 */
export function transformToMatrix(transform: Transform): TransformMatrix {
  const { type, values } = transform;

  switch (type) {
    case 'matrix': {
      // Pad array to 6 values with identity matrix defaults
      const matrix: TransformMatrix = [
        values[0] ?? 1,
        values[1] ?? 0,
        values[2] ?? 0,
        values[3] ?? 1,
        values[4] ?? 0,
        values[5] ?? 0,
      ];
      return matrix;
    }

    case 'translate': {
      const tx = values[0] || 0;
      const ty = values[1] || 0;
      return [1, 0, 0, 1, tx, ty];
    }

    case 'scale': {
      const sx = values[0] ?? 1;
      const sy = values[1] ?? sx;
      return [sx, 0, 0, sy, 0, 0];
    }

    case 'rotate': {
      const angle = (values[0] || 0) * (Math.PI / 180);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // If rotation center is provided
      if (values.length >= 3) {
        const cx = values[1] ?? 0;
        const cy = values[2] ?? 0;
        // Translate to origin, rotate, translate back
        const t1 = createTranslateMatrix(-cx, -cy);
        const r = [cos, sin, -sin, cos, 0, 0] as TransformMatrix;
        const t2 = createTranslateMatrix(cx, cy);
        return multiplyMatrices(multiplyMatrices(t2, r), t1);
      }

      return [cos, sin, -sin, cos, 0, 0];
    }

    case 'skewX': {
      const angle = (values[0] || 0) * (Math.PI / 180);
      const tan = Math.tan(angle);
      return [1, 0, tan, 1, 0, 0];
    }

    case 'skewY': {
      const angle = (values[0] || 0) * (Math.PI / 180);
      const tan = Math.tan(angle);
      return [1, tan, 0, 1, 0, 0];
    }

    default:
      // Identity matrix
      return [1, 0, 0, 1, 0, 0];
  }
}

/**
 * Create translation matrix
 */
function createTranslateMatrix(tx: number, ty: number): TransformMatrix {
  return [1, 0, 0, 1, tx, ty];
}

/**
 * Multiply two transform matrices
 *
 * @param m1 - First matrix
 * @param m2 - Second matrix
 * @returns Resulting matrix
 */
export function multiplyMatrices(m1: TransformMatrix, m2: TransformMatrix): TransformMatrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * Apply transform matrix to point
 *
 * @param matrix - Transform matrix
 * @param point - Point to transform
 * @returns Transformed point
 *
 * @example
 * ```typescript
 * const matrix = [2, 0, 0, 2, 10, 10]; // scale(2) translate(10, 10)
 * const point = applyTransform(matrix, { x: 5, y: 5 });
 * // { x: 20, y: 20 }
 * ```
 */
export function applyTransform(matrix: TransformMatrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;

  // Calculate transformations, treating 0 * Infinity as 0 (not NaN)
  const xTerm1 = a === 0 ? 0 : a * point.x;
  const xTerm2 = c === 0 ? 0 : c * point.y;
  const yTerm1 = b === 0 ? 0 : b * point.x;
  const yTerm2 = d === 0 ? 0 : d * point.y;

  return {
    x: xTerm1 + xTerm2 + e,
    y: yTerm1 + yTerm2 + f,
  };
}

/**
 * Compose multiple transforms into a single matrix
 *
 * @param transforms - Array of transform objects or strings
 * @returns Composed transform matrix
 *
 * @example
 * ```typescript
 * const matrix = composeTransforms([
 *   { type: 'translate', values: [10, 10] },
 *   { type: 'rotate', values: [45] },
 *   { type: 'scale', values: [2, 2] }
 * ]);
 * ```
 */
export function composeTransforms(transforms: Transform[]): TransformMatrix {
  let result: TransformMatrix = [1, 0, 0, 1, 0, 0]; // Identity matrix

  for (const transform of transforms) {
    const matrix = transformToMatrix(transform);
    result = multiplyMatrices(result, matrix);
  }

  return result;
}

/**
 * Convert matrix to transform string
 *
 * @param matrix - Transform matrix
 * @returns Transform string
 *
 * @example
 * ```typescript
 * const str = matrixToString([2, 0, 0, 2, 10, 10]);
 * // 'matrix(2, 0, 0, 2, 10, 10)'
 * ```
 */
export function matrixToString(matrix: TransformMatrix): string {
  return `matrix(${matrix.join(', ')})`;
}

/**
 * Decompose matrix into translate, rotate, scale
 *
 * @param matrix - Transform matrix
 * @returns Decomposed transform components
 *
 * @example
 * ```typescript
 * const components = decomposeMatrix([2, 0, 0, 2, 10, 10]);
 * // {
 * //   translate: [10, 10],
 * //   scale: [2, 2],
 * //   rotate: 0,
 * //   skew: 0
 * // }
 * ```
 */
export function decomposeMatrix(matrix: TransformMatrix): {
  translate: [number, number];
  scale: [number, number];
  rotate: number;
  skew: number;
} {
  const [a, b, c, d, e, f] = matrix;

  // Translation is straightforward
  const translate: [number, number] = [e, f];

  // Calculate scale
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const scale: [number, number] = [scaleX, scaleY];

  // Calculate rotation (in degrees)
  const rotate = (Math.atan2(b, a) * 180) / Math.PI;

  // Calculate skew
  const skew = (Math.atan2(c, d) * 180) / Math.PI - rotate;

  return {
    translate,
    scale,
    rotate,
    skew,
  };
}

/**
 * Invert transform matrix
 *
 * @param matrix - Transform matrix
 * @returns Inverted matrix
 *
 * @example
 * ```typescript
 * const inverted = invertMatrix([2, 0, 0, 2, 10, 10]);
 * // [0.5, 0, 0, 0.5, -5, -5]
 * ```
 */
export function invertMatrix(matrix: TransformMatrix): TransformMatrix {
  const [a, b, c, d, e, f] = matrix;

  const det = a * d - b * c;
  if (det === 0) {
    // Matrix is not invertible, return identity
    return [1, 0, 0, 1, 0, 0];
  }

  // Normalize -0 to 0 by adding 0
  const result: TransformMatrix = [
    d / det + 0,
    -b / det + 0,
    -c / det + 0,
    a / det + 0,
    (c * f - d * e) / det + 0,
    (b * e - a * f) / det + 0,
  ];

  return result;
}

/**
 * Check if matrix is identity matrix
 *
 * @param matrix - Transform matrix
 * @param tolerance - Tolerance for floating point comparison
 * @returns True if matrix is identity
 */
export function isIdentityMatrix(matrix: TransformMatrix, tolerance: number = 1e-9): boolean {
  const [a, b, c, d, e, f] = matrix;
  return (
    Math.abs(a - 1) < tolerance &&
    Math.abs(b) < tolerance &&
    Math.abs(c) < tolerance &&
    Math.abs(d - 1) < tolerance &&
    Math.abs(e) < tolerance &&
    Math.abs(f) < tolerance
  );
}

/**
 * Simplify transform string by removing redundant transforms
 *
 * @param transformString - SVG transform attribute value
 * @returns Simplified transform string
 *
 * @example
 * ```typescript
 * const simplified = simplifyTransform('translate(0, 0) scale(1, 1) rotate(0)');
 * // '' (empty string - all identity transforms removed)
 * ```
 */
export function simplifyTransform(transformString: string): string {
  const transforms = parseTransform(transformString);
  const matrix = composeTransforms(transforms);

  // If identity matrix, return empty string
  if (isIdentityMatrix(matrix)) {
    return '';
  }

  // Otherwise return matrix form
  return matrixToString(matrix);
}

/**
 * Create common transform objects
 */
export const createTransform = {
  translate: (x: number, y: number = 0): Transform => ({
    type: 'translate',
    values: [x, y],
  }),

  scale: (x: number, y?: number): Transform => ({
    type: 'scale',
    values: y !== undefined ? [x, y] : [x],
  }),

  rotate: (angle: number, cx?: number, cy?: number): Transform => ({
    type: 'rotate',
    values: cx !== undefined && cy !== undefined ? [angle, cx, cy] : [angle],
  }),

  skewX: (angle: number): Transform => ({
    type: 'skewX',
    values: [angle],
  }),

  skewY: (angle: number): Transform => ({
    type: 'skewY',
    values: [angle],
  }),

  matrix: (a: number, b: number, c: number, d: number, e: number, f: number): Transform => ({
    type: 'matrix',
    values: [a, b, c, d, e, f],
  }),
};
