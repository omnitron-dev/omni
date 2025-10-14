/**
 * SVG Text Primitives
 *
 * Text rendering elements with full reactive support
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
 * Text element for rendering text in SVG
 */
export interface TextProps extends Omit<JSX.SVGAttributes<SVGTextElement>, 'x' | 'y' | 'dx' | 'dy' | 'rotate' | 'textLength'> {
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  dx?: string | number | Signal<string | number>;
  dy?: string | number | Signal<string | number>;
  rotate?: string | Signal<string>;
  lengthAdjust?: 'spacing' | 'spacingAndGlyphs';
  textLength?: string | number | Signal<string | number>;
  children?: JSX.Element;
}

export const Text = defineComponent<TextProps>((props) => () => (
  <text
    {...props}
    x={getNumericValue(props.x)}
    y={getNumericValue(props.y)}
    dx={getNumericValue(props.dx)}
    dy={getNumericValue(props.dy)}
    rotate={resolveValue(props.rotate)}
    lengthAdjust={props.lengthAdjust}
    textLength={getNumericValue(props.textLength)}
  >
    {props.children}
  </text>
));

/**
 * TSpan element for text spans within Text elements
 */
export interface TSpanProps extends Omit<JSX.SVGAttributes<SVGTSpanElement>, 'x' | 'y' | 'dx' | 'dy' | 'rotate' | 'textLength'> {
  x?: string | number | Signal<string | number>;
  y?: string | number | Signal<string | number>;
  dx?: string | number | Signal<string | number>;
  dy?: string | number | Signal<string | number>;
  rotate?: string | Signal<string>;
  lengthAdjust?: 'spacing' | 'spacingAndGlyphs';
  textLength?: string | number | Signal<string | number>;
  children?: JSX.Element;
}

export const TSpan = defineComponent<TSpanProps>((props) => () => (
  <tspan
    {...props}
    x={getNumericValue(props.x)}
    y={getNumericValue(props.y)}
    dx={getNumericValue(props.dx)}
    dy={getNumericValue(props.dy)}
    rotate={resolveValue(props.rotate)}
    lengthAdjust={props.lengthAdjust}
    textLength={getNumericValue(props.textLength)}
  >
    {props.children}
  </tspan>
));

/**
 * TextPath element for rendering text along a path
 */
export interface TextPathProps extends Omit<JSX.SVGAttributes<SVGTextPathElement>, 'startOffset'> {
  href?: string;
  method?: 'align' | 'stretch';
  spacing?: 'auto' | 'exact';
  startOffset?: string | number | Signal<string | number>;
  children?: JSX.Element;
}

export const TextPath = defineComponent<TextPathProps>((props) => () => (
  <textPath
    {...props}
    href={props.href}
    method={props.method}
    spacing={props.spacing}
    startOffset={getNumericValue(props.startOffset)}
  >
    {props.children}
  </textPath>
));