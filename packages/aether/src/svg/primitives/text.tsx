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

// Convert camelCase to kebab-case for SVG attributes
const toKebabCase = (str: string): string => str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

// Process props to handle camelCase to kebab-case conversion
const processProps = (inputProps: any, excludeKeys: string[] = []) => {
  const processed: any = {};
  for (const key in inputProps) {
    if (Object.prototype.hasOwnProperty.call(inputProps, key)) {
      const value = inputProps[key];
      // Skip excluded keys and children
      if (excludeKeys.includes(key) || key === 'children') {
        continue;
      }
      // Convert camelCase to kebab-case for SVG attributes
      const kebabKey = toKebabCase(key);
      processed[kebabKey] = value;
    }
  }
  return processed;
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

export const Text = defineComponent<TextProps>((props) => () => {
  const processedProps = processProps(props, ['x', 'y', 'dx', 'dy', 'rotate', 'lengthAdjust', 'textLength']);

  return (
    <text
      {...processedProps}
      x={props.x}
      y={props.y}
      dx={props.dx}
      dy={props.dy}
      rotate={props.rotate}
      lengthAdjust={props.lengthAdjust}
      textLength={props.textLength}
    >
      {props.children}
    </text>
  );
});

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

export const TSpan = defineComponent<TSpanProps>((props) => () => {
  const processedProps = processProps(props, ['x', 'y', 'dx', 'dy', 'rotate', 'lengthAdjust', 'textLength']);

  return (
    <tspan
      {...processedProps}
      x={props.x}
      y={props.y}
      dx={props.dx}
      dy={props.dy}
      rotate={props.rotate}
      lengthAdjust={props.lengthAdjust}
      textLength={props.textLength}
    >
      {props.children}
    </tspan>
  );
});

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

export const TextPath = defineComponent<TextPathProps>((props) => () => {
  const processedProps = processProps(props, ['href', 'method', 'spacing', 'startOffset']);

  return (
    <textPath
      {...processedProps}
      href={props.href}
      method={props.method}
      spacing={props.spacing}
      startOffset={props.startOffset}
    >
      {props.children}
    </textPath>
  );
});