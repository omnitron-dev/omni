/**
 * SVG Shape Primitives
 *
 * Core shape elements with reactive attribute support
 */

import { defineComponent } from '../../index.js';
import type { Signal } from '../../index.js';
import type { JSX } from '../../core/component/types.js';

/**
 * Circle primitive
 *
 * Supports reactive attributes via signals. The JSX runtime and reconciler
 * will automatically set up reactive bindings for signal props.
 */
export interface CircleProps extends Omit<JSX.SVGAttributes<SVGCircleElement>, 'cx' | 'cy' | 'r'> {
  cx?: string | number | Signal<string | number>;
  cy?: string | number | Signal<string | number>;
  r?: string | number | Signal<string | number>;
}

export const Circle = defineComponent<CircleProps>((props) => () => (
  <circle {...props} cx={props.cx} cy={props.cy} r={props.r} />
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
  <rect {...props} x={props.x} y={props.y} width={props.width} height={props.height} rx={props.rx} ry={props.ry} />
));

/**
 * Path primitive - the most versatile SVG element
 */
export interface PathProps extends Omit<JSX.SVGAttributes<SVGPathElement>, 'd' | 'pathLength'> {
  d?: string | Signal<string>;
  pathLength?: number | Signal<number>;
}

export const Path = defineComponent<PathProps>((props) => () => (
  <path {...props} d={props.d} pathLength={props.pathLength} />
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
  <line {...props} x1={props.x1} y1={props.y1} x2={props.x2} y2={props.y2} />
));

/**
 * Polygon primitive
 */
export interface PolygonProps extends Omit<JSX.SVGAttributes<SVGPolygonElement>, 'points'> {
  points?: string | Signal<string>;
}

export const Polygon = defineComponent<PolygonProps>((props) => () => (
  <polygon {...props} points={props.points} />
));

/**
 * Polyline primitive
 */
export interface PolylineProps extends Omit<JSX.SVGAttributes<SVGPolylineElement>, 'points'> {
  points?: string | Signal<string>;
}

export const Polyline = defineComponent<PolylineProps>((props) => () => (
  <polyline {...props} points={props.points} />
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
  <ellipse {...props} cx={props.cx} cy={props.cy} rx={props.rx} ry={props.ry} />
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
export interface UseProps extends Omit<JSX.SVGAttributes<SVGUseElement>, 'x' | 'y' | 'width' | 'height' | 'href'> {
  href?: string | Signal<string>;
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
}

export const Use = defineComponent<UseProps>((props) => () => (
  <use {...props} href={props.href} x={props.x} y={props.y} width={props.width} height={props.height} />
));

/**
 * Symbol element for defining reusable SVG elements
 */
export interface SymbolProps extends Omit<JSX.SVGAttributes<SVGSymbolElement>, 'viewBox' | 'preserveAspectRatio'> {
  id: string;
  viewBox?: string | Signal<string>;
  preserveAspectRatio?: string | Signal<string>;
  children?: JSX.Element;
}

export const Symbol = defineComponent<SymbolProps>((props) => () => (
  <symbol {...props} id={props.id} viewBox={props.viewBox} preserveAspectRatio={props.preserveAspectRatio}>
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