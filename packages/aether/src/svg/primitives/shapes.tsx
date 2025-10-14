/**
 * SVG Shape Primitives
 *
 * Core shape elements with reactive attribute support
 */

import { defineComponent } from '../../index.js';
import type { Signal } from '../../index.js';
import type { JSX } from '../../core/component/types.js';

// Utility to resolve signal values
const resolveValue = <T,>(value: T | Signal<T> | undefined): T | undefined => {
  if (value === undefined) return undefined;
  return typeof value === 'function' ? (value as Signal<T>)() : value;
};

const getNumericValue = (value: string | number | Signal<string | number> | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const resolved = resolveValue(value);
  return typeof resolved === 'number' ? `${resolved}` : resolved;
};

/**
 * Circle primitive
 */
export interface CircleProps extends Omit<JSX.SVGAttributes<SVGCircleElement>, 'cx' | 'cy' | 'r'> {
  cx?: string | number | Signal<string | number>;
  cy?: string | number | Signal<string | number>;
  r?: string | number | Signal<string | number>;
}

export const Circle = defineComponent<CircleProps>((props) => () => (
  <circle
    {...props}
    cx={getNumericValue(props.cx)}
    cy={getNumericValue(props.cy)}
    r={getNumericValue(props.r)}
  />
));

/**
 * Rectangle primitive
 */
export interface RectProps extends Omit<JSX.SVGAttributes<SVGRectElement>, 'x' | 'y' | 'width' | 'height' | 'rx' | 'ry'> {
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
  rx?: string | number | Signal<string | number>;
  ry?: string | number | Signal<string | number>;
}

export const Rect = defineComponent<RectProps>((props) => () => (
  <rect
    {...props}
    x={getNumericValue(props.x)}
    y={getNumericValue(props.y)}
    width={getNumericValue(props.width)}
    height={getNumericValue(props.height)}
    rx={getNumericValue(props.rx)}
    ry={getNumericValue(props.ry)}
  />
));

/**
 * Path primitive - the most versatile SVG element
 */
export interface PathProps extends Omit<JSX.SVGAttributes<SVGPathElement>, 'd' | 'pathLength'> {
  d?: string | Signal<string>;
  pathLength?: number | Signal<number>;
}

export const Path = defineComponent<PathProps>((props) => () => (
  <path
    {...props}
    d={resolveValue(props.d)}
    pathLength={resolveValue(props.pathLength)}
  />
));

/**
 * Line primitive
 */
export interface LineProps extends Omit<JSX.SVGAttributes<SVGLineElement>, 'x1' | 'y1' | 'x2' | 'y2'> {
  x1?: string | number | Signal<string | number>;
  y1?: string | number | Signal<string | number>;
  x2?: string | number | Signal<string | number>;
  y2?: string | number | Signal<string | number>;
}

export const Line = defineComponent<LineProps>((props) => () => (
  <line
    {...props}
    x1={getNumericValue(props.x1)}
    y1={getNumericValue(props.y1)}
    x2={getNumericValue(props.x2)}
    y2={getNumericValue(props.y2)}
  />
));

/**
 * Polygon primitive
 */
export interface PolygonProps extends Omit<JSX.SVGAttributes<SVGPolygonElement>, 'points'> {
  points?: string | Signal<string>;
}

export const Polygon = defineComponent<PolygonProps>((props) => () => (
  <polygon
    {...props}
    points={resolveValue(props.points)}
  />
));

/**
 * Polyline primitive
 */
export interface PolylineProps extends Omit<JSX.SVGAttributes<SVGPolylineElement>, 'points'> {
  points?: string | Signal<string>;
}

export const Polyline = defineComponent<PolylineProps>((props) => () => (
  <polyline
    {...props}
    points={resolveValue(props.points)}
  />
));

/**
 * Ellipse primitive
 */
export interface EllipseProps extends Omit<JSX.SVGAttributes<SVGEllipseElement>, 'cx' | 'cy' | 'rx' | 'ry'> {
  cx?: string | number | Signal<string | number>;
  cy?: string | number | Signal<string | number>;
  rx?: string | number | Signal<string | number>;
  ry?: string | number | Signal<string | number>;
}

export const Ellipse = defineComponent<EllipseProps>((props) => () => (
  <ellipse
    {...props}
    cx={getNumericValue(props.cx)}
    cy={getNumericValue(props.cy)}
    rx={getNumericValue(props.rx)}
    ry={getNumericValue(props.ry)}
  />
));

/**
 * Group element for grouping SVG elements
 */
export interface GroupProps extends JSX.SVGAttributes<SVGGElement> {
  children?: JSX.Element;
}

export const G = defineComponent<GroupProps>((props) => () => <g {...props}>{props.children}</g>);

/**
 * Use element for reusing SVG elements
 */
export interface UseProps extends Omit<JSX.SVGAttributes<SVGUseElement>, 'x' | 'y' | 'width' | 'height'> {
  href?: string | Signal<string>;
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
}

export const Use = defineComponent<UseProps>((props) => () => (
  <use
    {...props}
    href={resolveValue(props.href)}
    x={getNumericValue(props.x)}
    y={getNumericValue(props.y)}
    width={getNumericValue(props.width)}
    height={getNumericValue(props.height)}
  />
));

/**
 * Symbol element for defining reusable SVG elements
 */
export interface SymbolProps extends Omit<JSX.SVGAttributes<SVGSymbolElement>, 'viewBox'> {
  id: string;
  viewBox?: string | Signal<string>;
  preserveAspectRatio?: string | Signal<string>;
  children?: JSX.Element;
}

export const Symbol = defineComponent<SymbolProps>((props) => () => (
  <symbol
    {...props}
    id={props.id}
    viewBox={resolveValue(props.viewBox)}
    preserveAspectRatio={resolveValue(props.preserveAspectRatio)}
  >
    {props.children}
  </symbol>
));

/**
 * Defs element for defining reusable elements
 */
export interface DefsProps extends JSX.SVGAttributes<SVGDefsElement> {
  children?: JSX.Element;
}

export const Defs = defineComponent<DefsProps>((props) => () => <defs {...props}>{props.children}</defs>);