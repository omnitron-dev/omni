/**
 * SVG Viewport Utilities
 *
 * Utilities for calculating and manipulating SVG viewBox and viewports.
 *
 * @module svg/utils/viewport
 */

/**
 * ViewBox definition
 */
export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Viewport dimensions
 */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * Aspect ratio alignment
 */
export type AspectRatioAlign =
  | 'none'
  | 'xMinYMin'
  | 'xMidYMin'
  | 'xMaxYMin'
  | 'xMinYMid'
  | 'xMidYMid'
  | 'xMaxYMid'
  | 'xMinYMax'
  | 'xMidYMax'
  | 'xMaxYMax';

/**
 * Aspect ratio meet or slice
 */
export type AspectRatioMeetOrSlice = 'meet' | 'slice';

/**
 * PreserveAspectRatio configuration
 */
export interface PreserveAspectRatio {
  align: AspectRatioAlign;
  meetOrSlice: AspectRatioMeetOrSlice;
}

/**
 * Parse viewBox string
 *
 * @param viewBox - ViewBox string (e.g., "0 0 100 100")
 * @returns ViewBox object
 *
 * @example
 * ```typescript
 * const vb = parseViewBox('0 0 100 100');
 * // { x: 0, y: 0, width: 100, height: 100 }
 * ```
 */
export function parseViewBox(viewBox: string): ViewBox {
  // Split by spaces or commas, filter out empty strings
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .filter((p) => p !== '')
    .map(Number);

  if (parts.length !== 4 || parts.some((n) => isNaN(n) || !isFinite(n))) {
    throw new Error(`Invalid viewBox: ${viewBox}`);
  }

  return {
    x: parts[0] ?? 0,
    y: parts[1] ?? 0,
    width: parts[2] ?? 0,
    height: parts[3] ?? 0,
  };
}

/**
 * Format viewBox object to string
 *
 * @param viewBox - ViewBox object
 * @returns ViewBox string
 *
 * @example
 * ```typescript
 * const str = formatViewBox({ x: 0, y: 0, width: 100, height: 100 });
 * // "0 0 100 100"
 * ```
 */
export function formatViewBox(viewBox: ViewBox): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

/**
 * Parse preserveAspectRatio attribute
 *
 * @param preserveAspectRatio - preserveAspectRatio string
 * @returns PreserveAspectRatio object
 *
 * @example
 * ```typescript
 * const par = parsePreserveAspectRatio('xMidYMid meet');
 * // { align: 'xMidYMid', meetOrSlice: 'meet' }
 * ```
 */
export function parsePreserveAspectRatio(preserveAspectRatio: string): PreserveAspectRatio {
  const parts = preserveAspectRatio.trim().split(/\s+/);

  const align = (parts[0] || 'xMidYMid') as AspectRatioAlign;
  const meetOrSlice = (parts[1] || 'meet') as AspectRatioMeetOrSlice;

  return { align, meetOrSlice };
}

/**
 * Calculate viewBox from element bounds
 *
 * @param bounds - Element bounds {x, y, width, height}
 * @param padding - Optional padding around bounds
 * @returns ViewBox object
 *
 * @example
 * ```typescript
 * const vb = calculateViewBox(
 *   { x: 10, y: 10, width: 80, height: 80 },
 *   10
 * );
 * // { x: 0, y: 0, width: 100, height: 100 }
 * ```
 */
export function calculateViewBox(
  bounds: { x: number; y: number; width: number; height: number },
  padding: number = 0
): ViewBox {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

/**
 * Fit viewBox to viewport maintaining aspect ratio
 *
 * @param viewBox - ViewBox to fit
 * @param viewport - Target viewport dimensions
 * @param preserveAspectRatio - Aspect ratio preservation config
 * @returns Transform to apply { scale, translateX, translateY }
 *
 * @example
 * ```typescript
 * const transform = fitToViewport(
 *   { x: 0, y: 0, width: 200, height: 100 },
 *   { width: 100, height: 100 },
 *   { align: 'xMidYMid', meetOrSlice: 'meet' }
 * );
 * // { scale: 0.5, translateX: 0, translateY: 25 }
 * ```
 */
export function fitToViewport(
  viewBox: ViewBox,
  viewport: Viewport,
  preserveAspectRatio: PreserveAspectRatio = { align: 'xMidYMid', meetOrSlice: 'meet' }
): {
  scale: number;
  translateX: number;
  translateY: number;
} {
  const { align, meetOrSlice } = preserveAspectRatio;

  // Calculate scale factors
  const scaleX = viewport.width / viewBox.width;
  const scaleY = viewport.height / viewBox.height;

  // Handle 'none' alignment (no aspect ratio preservation)
  if (align === 'none') {
    return {
      scale: 1,
      translateX: -viewBox.x,
      translateY: -viewBox.y,
    };
  }

  // Determine uniform scale based on meet or slice
  const scale = meetOrSlice === 'meet' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  // Calculate scaled viewBox dimensions
  const scaledWidth = viewBox.width * scale;
  const scaledHeight = viewBox.height * scale;

  // Calculate available space
  const availableWidth = viewport.width - scaledWidth;
  const availableHeight = viewport.height - scaledHeight;

  // Determine alignment offsets
  let alignX = 0;
  let alignY = 0;

  // Horizontal alignment
  if (align.startsWith('xMin')) {
    alignX = 0;
  } else if (align.startsWith('xMid')) {
    alignX = availableWidth / 2;
  } else if (align.startsWith('xMax')) {
    alignX = availableWidth;
  }

  // Vertical alignment
  if (align.includes('YMin')) {
    alignY = 0;
  } else if (align.includes('YMid')) {
    alignY = availableHeight / 2;
  } else if (align.includes('YMax')) {
    alignY = availableHeight;
  }

  return {
    scale,
    translateX: -viewBox.x * scale + alignX,
    translateY: -viewBox.y * scale + alignY,
  };
}

/**
 * Scale viewBox while maintaining aspect ratio
 *
 * @param viewBox - Original viewBox
 * @param scaleFactor - Scale factor
 * @param anchor - Anchor point for scaling ('center', 'topLeft', etc.)
 * @returns Scaled viewBox
 *
 * @example
 * ```typescript
 * const scaled = scaleViewBox(
 *   { x: 0, y: 0, width: 100, height: 100 },
 *   2,
 *   'center'
 * );
 * // { x: -50, y: -50, width: 200, height: 200 }
 * ```
 */
export function scaleViewBox(
  viewBox: ViewBox,
  scaleFactor: number,
  anchor: 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' = 'center'
): ViewBox {
  const newWidth = viewBox.width * scaleFactor;
  const newHeight = viewBox.height * scaleFactor;
  const deltaWidth = newWidth - viewBox.width;
  const deltaHeight = newHeight - viewBox.height;

  let x = viewBox.x;
  let y = viewBox.y;

  switch (anchor) {
    case 'center':
      x -= deltaWidth / 2;
      y -= deltaHeight / 2;
      break;
    case 'topRight':
      x -= deltaWidth;
      break;
    case 'bottomLeft':
      y -= deltaHeight;
      break;
    case 'bottomRight':
      x -= deltaWidth;
      y -= deltaHeight;
      break;
    case 'topLeft':
    default:
      // No offset needed
      break;
  }

  return {
    x,
    y,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Pan viewBox by offset
 *
 * @param viewBox - Original viewBox
 * @param deltaX - Horizontal offset
 * @param deltaY - Vertical offset
 * @returns Panned viewBox
 *
 * @example
 * ```typescript
 * const panned = panViewBox(
 *   { x: 0, y: 0, width: 100, height: 100 },
 *   10,
 *   10
 * );
 * // { x: 10, y: 10, width: 100, height: 100 }
 * ```
 */
export function panViewBox(viewBox: ViewBox, deltaX: number, deltaY: number): ViewBox {
  return {
    ...viewBox,
    x: viewBox.x + deltaX,
    y: viewBox.y + deltaY,
  };
}

/**
 * Calculate aspect ratio of viewBox
 *
 * @param viewBox - ViewBox object
 * @returns Aspect ratio (width / height)
 *
 * @example
 * ```typescript
 * const ratio = getAspectRatio({ x: 0, y: 0, width: 200, height: 100 });
 * // 2
 * ```
 */
export function getAspectRatio(viewBox: ViewBox): number {
  return viewBox.width / viewBox.height;
}

/**
 * Constrain viewBox to bounds
 *
 * @param viewBox - ViewBox to constrain
 * @param bounds - Bounding viewBox
 * @returns Constrained viewBox
 *
 * @example
 * ```typescript
 * const constrained = constrainViewBox(
 *   { x: -10, y: -10, width: 120, height: 120 },
 *   { x: 0, y: 0, width: 100, height: 100 }
 * );
 * // { x: 0, y: 0, width: 100, height: 100 }
 * ```
 */
export function constrainViewBox(viewBox: ViewBox, bounds: ViewBox): ViewBox {
  let { x, y, width, height } = viewBox;

  // Constrain position
  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height));

  // Constrain dimensions
  width = Math.min(width, bounds.width);
  height = Math.min(height, bounds.height);

  return { x, y, width, height };
}

/**
 * Convert viewport coordinates to viewBox coordinates
 *
 * @param point - Point in viewport coordinates
 * @param viewBox - ViewBox
 * @param viewport - Viewport dimensions
 * @param preserveAspectRatio - Aspect ratio preservation config
 * @returns Point in viewBox coordinates
 *
 * @example
 * ```typescript
 * const vbPoint = viewportToViewBox(
 *   { x: 50, y: 50 },
 *   { x: 0, y: 0, width: 100, height: 100 },
 *   { width: 200, height: 200 },
 *   { align: 'xMidYMid', meetOrSlice: 'meet' }
 * );
 * ```
 */
export function viewportToViewBox(
  point: { x: number; y: number },
  viewBox: ViewBox,
  viewport: Viewport,
  preserveAspectRatio: PreserveAspectRatio = { align: 'xMidYMid', meetOrSlice: 'meet' }
): { x: number; y: number } {
  const { scale, translateX, translateY } = fitToViewport(viewBox, viewport, preserveAspectRatio);

  return {
    x: (point.x - translateX) / scale + viewBox.x,
    y: (point.y - translateY) / scale + viewBox.y,
  };
}

/**
 * Convert viewBox coordinates to viewport coordinates
 *
 * @param point - Point in viewBox coordinates
 * @param viewBox - ViewBox
 * @param viewport - Viewport dimensions
 * @param preserveAspectRatio - Aspect ratio preservation config
 * @returns Point in viewport coordinates
 */
export function viewBoxToViewport(
  point: { x: number; y: number },
  viewBox: ViewBox,
  viewport: Viewport,
  preserveAspectRatio: PreserveAspectRatio = { align: 'xMidYMid', meetOrSlice: 'meet' }
): { x: number; y: number } {
  const { scale, translateX, translateY } = fitToViewport(viewBox, viewport, preserveAspectRatio);

  return {
    x: (point.x - viewBox.x) * scale + translateX,
    y: (point.y - viewBox.y) * scale + translateY,
  };
}
