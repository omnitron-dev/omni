/**
 * SVG Primitives Index
 *
 * Export all SVG primitive components
 */

// Base SVG element
export { SVG, type SVGProps, type SVGComponent } from './svg.js';

// Shape primitives
export {
  Circle,
  Rect,
  Path,
  Line,
  Polygon,
  Polyline,
  Ellipse,
  G,
  Use,
  Symbol,
  Defs,
  type CircleProps,
  type RectProps,
  type PathProps,
  type LineProps,
  type PolygonProps,
  type PolylineProps,
  type EllipseProps,
  type GroupProps,
  type UseProps,
  type SymbolProps,
  type DefsProps,
} from './shapes.js';

// Text primitives
export { Text, TSpan, TextPath, type TextProps, type TSpanProps, type TextPathProps } from './text.js';

// Gradients and patterns
export {
  LinearGradient,
  RadialGradient,
  Stop,
  Pattern,
  Mask,
  ClipPath,
  type LinearGradientProps,
  type RadialGradientProps,
  type StopProps,
  type PatternProps,
  type MaskProps,
  type ClipPathProps,
} from './gradients.js';
