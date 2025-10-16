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
export interface CircleProps extends Omit<JSX.SVGAttributes, 'cx' | 'cy' | 'r'> {
  cx?: string | number | Signal<string | number>;
  cy?: string | number | Signal<string | number>;
  r?: string | number | Signal<string | number>;
}

export const Circle = defineComponent<CircleProps>((props) => () => (
  <circle {...props} cx={props.cx as any} cy={props.cy as any} r={props.r as any} />
));

/**
 * Rectangle primitive
 */
export interface RectProps extends Omit<JSX.SVGAttributes, 'x' | 'y' | 'width' | 'height' | 'rx' | 'ry'> {
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
    x={props.x as any}
    y={props.y as any}
    width={props.width as any}
    height={props.height as any}
    rx={props.rx as any}
    ry={props.ry as any}
  />
));

/**
 * Path primitive - the most versatile SVG element
 */
export interface PathProps extends Omit<JSX.SVGAttributes, 'd' | 'pathLength'> {
  d?: string | Signal<string>;
  pathLength?: number | Signal<number>;
}

export const Path = defineComponent<PathProps>((props) => () => (
  <path {...props} d={props.d as any} pathLength={props.pathLength as any} />
));

/**
 * Line primitive
 */
export interface LineProps extends Omit<JSX.SVGAttributes, 'x1' | 'y1' | 'x2' | 'y2'> {
  x1?: string | number | Signal<string | number>;
  y1?: string | number | Signal<string | number>;
  x2?: string | number | Signal<string | number>;
  y2?: string | number | Signal<string | number>;
}

export const Line = defineComponent<LineProps>((props) => () => (
  <line {...props} x1={props.x1 as any} y1={props.y1 as any} x2={props.x2 as any} y2={props.y2 as any} />
));

/**
 * Polygon primitive
 */
export interface PolygonProps extends Omit<JSX.SVGAttributes, 'points'> {
  points?: string | Signal<string>;
}

export const Polygon = defineComponent<PolygonProps>((props) => () => (
  <polygon {...props} points={props.points as any} />
));

/**
 * Polyline primitive
 */
export interface PolylineProps extends Omit<JSX.SVGAttributes, 'points'> {
  points?: string | Signal<string>;
}

export const Polyline = defineComponent<PolylineProps>((props) => () => (
  <polyline {...props} points={props.points as any} />
));

/**
 * Ellipse primitive
 */
export interface EllipseProps extends Omit<JSX.SVGAttributes, 'cx' | 'cy' | 'rx' | 'ry'> {
  cx?: string | number | Signal<string | number>;
  cy?: string | number | Signal<string | number>;
  rx?: string | number | Signal<string | number>;
  ry?: string | number | Signal<string | number>;
}

export const Ellipse = defineComponent<EllipseProps>((props) => () => (
  <ellipse {...props} cx={props.cx as any} cy={props.cy as any} rx={props.rx as any} ry={props.ry as any} />
));

/**
 * Group element for grouping SVG elements
 */
export interface GroupProps extends JSX.SVGAttributes {
  children?: JSX.Element;
}

export const G = defineComponent<GroupProps>((props) => () => <g {...props}>{props.children}</g>);

/**
 * Use element for reusing SVG elements
 */
export interface UseProps extends Omit<JSX.SVGAttributes, 'x' | 'y' | 'width' | 'height' | 'href'> {
  href?: string | Signal<string>;
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
}

export const Use = defineComponent<UseProps>((props) => () => (
  <use
    {...props}
    href={props.href as any}
    x={props.x as any}
    y={props.y as any}
    width={props.width as any}
    height={props.height as any}
  />
));

/**
 * Symbol element for defining reusable SVG elements
 */
export interface SymbolProps extends Omit<JSX.SVGAttributes, 'viewBox' | 'preserveAspectRatio'> {
  id: string;
  viewBox?: string | Signal<string>;
  preserveAspectRatio?: string | Signal<string>;
  children?: JSX.Element;
}

export const Symbol = defineComponent<SymbolProps>((props) => () => (
  <symbol
    {...props}
    id={props.id}
    viewBox={props.viewBox as any}
    preserveAspectRatio={props.preserveAspectRatio as any}
  >
    {props.children}
  </symbol>
));

/**
 * Defs element for defining reusable elements
 */
export interface DefsProps extends JSX.SVGAttributes {
  children?: JSX.Element;
}

export const Defs = defineComponent<DefsProps>((props) => () => <defs {...props}>{props.children}</defs>);
