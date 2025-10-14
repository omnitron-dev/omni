/**
 * SVG Gradient and Pattern Primitives
 *
 * Elements for creating gradients, patterns, and fills
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
 * LinearGradient element
 */
export interface LinearGradientProps extends Omit<JSX.SVGAttributes<SVGLinearGradientElement>, 'x1' | 'y1' | 'x2' | 'y2' | 'gradientTransform'> {
  id: string;
  x1?: string | Signal<string>;
  y1?: string | Signal<string>;
  x2?: string | Signal<string>;
  y2?: string | Signal<string>;
  gradientUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  gradientTransform?: string | Signal<string>;
  spreadMethod?: 'pad' | 'reflect' | 'repeat';
  children?: JSX.Element;
}

export const LinearGradient = defineComponent<LinearGradientProps>((props) => () => (
  <linearGradient
    {...props}
    id={props.id}
    x1={props.x1}
    y1={props.y1}
    x2={props.x2}
    y2={props.y2}
    gradientUnits={props.gradientUnits}
    gradientTransform={props.gradientTransform}
    spreadMethod={props.spreadMethod}
  >
    {props.children}
  </linearGradient>
));

/**
 * RadialGradient element
 */
export interface RadialGradientProps extends Omit<JSX.SVGAttributes<SVGRadialGradientElement>, 'cx' | 'cy' | 'r' | 'fx' | 'fy' | 'fr' | 'gradientTransform'> {
  id: string;
  cx?: string | Signal<string>;
  cy?: string | Signal<string>;
  r?: string | Signal<string>;
  fx?: string | Signal<string>;
  fy?: string | Signal<string>;
  fr?: string | Signal<string>;
  gradientUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  gradientTransform?: string | Signal<string>;
  spreadMethod?: 'pad' | 'reflect' | 'repeat';
  children?: JSX.Element;
}

export const RadialGradient = defineComponent<RadialGradientProps>((props) => () => (
  <radialGradient
    {...props}
    id={props.id}
    cx={props.cx}
    cy={props.cy}
    r={props.r}
    fx={props.fx}
    fy={props.fy}
    fr={props.fr}
    gradientUnits={props.gradientUnits}
    gradientTransform={props.gradientTransform}
    spreadMethod={props.spreadMethod}
  >
    {props.children}
  </radialGradient>
));

/**
 * Stop element for gradient color stops
 */
export interface StopProps extends Omit<JSX.SVGAttributes<SVGStopElement>, 'offset' | 'stopColor' | 'stopOpacity'> {
  offset?: string | number | Signal<string | number>;
  stopColor?: string | Signal<string>;
  stopOpacity?: string | number | Signal<string | number>;
}

export const Stop = defineComponent<StopProps>((props) => () => (
  <stop
    {...props}
    offset={props.offset}
    stopColor={props.stopColor}
    stopOpacity={props.stopOpacity}
  />
));

/**
 * Pattern element for creating repeating patterns
 */
export interface PatternProps extends Omit<JSX.SVGAttributes<SVGPatternElement>, 'x' | 'y' | 'width' | 'height' | 'patternTransform'> {
  id: string;
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
  patternUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  patternContentUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  patternTransform?: string | Signal<string>;
  children?: JSX.Element;
}

export const Pattern = defineComponent<PatternProps>((props) => () => (
  <pattern
    {...props}
    id={props.id}
    x={props.x}
    y={props.y}
    width={props.width}
    height={props.height}
    patternUnits={props.patternUnits}
    patternContentUnits={props.patternContentUnits}
    patternTransform={props.patternTransform}
  >
    {props.children}
  </pattern>
));

/**
 * Mask element for masking
 */
export interface MaskProps extends Omit<JSX.SVGAttributes<SVGMaskElement>, 'x' | 'y' | 'width' | 'height'> {
  id: string;
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
  maskUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  maskContentUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  children?: JSX.Element;
}

export const Mask = defineComponent<MaskProps>((props) => () => (
  <mask
    {...props}
    id={props.id}
    x={props.x}
    y={props.y}
    width={props.width}
    height={props.height}
    maskUnits={props.maskUnits}
    maskContentUnits={props.maskContentUnits}
  >
    {props.children}
  </mask>
));

/**
 * ClipPath element for clipping
 */
export interface ClipPathProps extends JSX.SVGAttributes<SVGClipPathElement> {
  id: string;
  clipPathUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  children?: JSX.Element;
}

export const ClipPath = defineComponent<ClipPathProps>((props) => () => (
  <clipPath
    {...props}
    id={props.id}
    clipPathUnits={props.clipPathUnits}
  >
    {props.children}
  </clipPath>
));