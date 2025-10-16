/**
 * Styled Component Factory
 *
 * Factory for creating styled components with:
 * - Base styles and variants
 * - Compound variants
 * - Type-safe props
 * - Style composition
 * - Support for both components and HTML elements
 */

import { defineComponent, type Component } from '../core/component/index.js';
import { computed } from '../core/reactivity/index.js';
import { injectStyles } from './runtime.js';
import { cx } from './css.js';
import { jsx } from '../jsx-runtime.js';

/**
 * CSS property value (primitive types)
 */
export type CSSPrimitiveValue = string | number | boolean | undefined;

/**
 * CSS properties object (supports nested properties for pseudo-selectors and media queries)
 */
export type CSSProperties = {
  [K: string]: CSSPrimitiveValue | CSSProperties;
};

/**
 * CSS property value
 */
export type CSSValue = string | number | boolean | CSSProperties;

/**
 * Variant configuration
 */
export interface VariantConfig {
  [variantName: string]: {
    [variantValue: string]: CSSProperties;
  };
}

/**
 * Compound variant rule
 */
export interface CompoundVariant {
  [key: string]: string | boolean | CSSProperties;
  css: CSSProperties;
}

/**
 * Default variants
 */
export type DefaultVariants<V extends VariantConfig> = {
  [K in keyof V]?: keyof V[K] | boolean;
};

/**
 * Style configuration
 */
export interface StyleConfig<V extends VariantConfig = VariantConfig> {
  base?: CSSProperties;
  variants?: V;
  compoundVariants?: CompoundVariant[];
  defaultVariants?: DefaultVariants<V>;
}

/**
 * Extract variant props type from variant config
 */
export type VariantProps<V extends VariantConfig> = {
  [K in keyof V]?: keyof V[K];
};

/**
 * Styled component props
 */
export type StyledProps<V extends VariantConfig = VariantConfig> = VariantProps<V> & {
  class?: string;
  className?: string;
  css?: CSSProperties;
  [key: string]: any;
};

/**
 * Check if compound variant matches current props
 */
function matchesCompoundVariant<V extends VariantConfig>(compound: CompoundVariant, props: VariantProps<V>): boolean {
  for (const [key, value] of Object.entries(compound)) {
    if (key === 'css') continue;

    const propValue = (props as any)[key];

    if (typeof value === 'boolean') {
      // Boolean prop check
      if (!!propValue !== value) return false;
    } else if (propValue !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Merge CSS properties
 */
function mergeCSS(...cssObjects: (CSSProperties | undefined)[]): CSSProperties {
  const result: CSSProperties = {};

  for (const css of cssObjects) {
    if (!css) continue;
    Object.assign(result, css);
  }

  return result;
}

/**
 * Create a styled component from a base component
 *
 * @template P - Component props type
 * @template V - Variant configuration type (inferred from styleConfig)
 */
export function styled<P = any, V extends VariantConfig = VariantConfig>(
  component: Component<any> | string,
  styleConfig: StyleConfig<V>
): Component<any> {
  const { base = {}, variants = {} as V, compoundVariants = [], defaultVariants = {} } = styleConfig;

  return defineComponent<P & StyledProps<V>>((props: any) => {
    // Compute final styles based on props
    const finalStyles = computed(() => {
      const currentProps = props as StyledProps<V>;

      // Start with base styles
      let styles = { ...base };

      // Apply variant styles
      for (const [variantName, variantValues] of Object.entries(variants)) {
        const selectedValue = (currentProps as any)[variantName] ?? (defaultVariants as any)[variantName];

        if (selectedValue && variantValues[selectedValue as string]) {
          styles = mergeCSS(styles, variantValues[selectedValue as string]);
        }
      }

      // Apply compound variants
      for (const compound of compoundVariants) {
        if (matchesCompoundVariant(compound, currentProps)) {
          styles = mergeCSS(styles, compound.css);
        }
      }

      // Apply inline CSS prop
      if (currentProps.css) {
        styles = mergeCSS(styles, currentProps.css);
      }

      return styles;
    });

    // Generate class name from styles
    const styledClassName = computed(() => {
      const styles = finalStyles();
      if (Object.keys(styles).length === 0) return '';

      // Convert CSSProperties to plain style object
      const flatStyles: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(styles)) {
        if (typeof value === 'string' || typeof value === 'number') {
          flatStyles[key] = value;
        } else if (typeof value === 'boolean') {
          // Skip boolean values
          continue;
        }
      }

      return injectStyles(flatStyles);
    });

    // Merge class names
    const finalClassName = computed(() => {
      const classes = [styledClassName()];

      const currentProps = props as StyledProps<V>;
      if (currentProps.class) classes.push(currentProps.class);
      if (currentProps.className) classes.push(currentProps.className);

      return cx(...classes);
    });

    // Clean props (remove styling props)
    const cleanProps = computed(() => {
      const currentProps = props as StyledProps<V>;
      const clean: Record<string, any> = {};

      for (const [key, value] of Object.entries(currentProps)) {
        // Skip styling-related props
        if (key === 'css' || key === 'class' || key === 'className') continue;
        if (variants && key in variants) continue;

        clean[key] = value;
      }

      // Add final className
      if (finalClassName()) {
        clean.class = finalClassName();
      }

      return clean;
    });

    // Render component or element
    return () => {
      const propsToUse = cleanProps();

      if (typeof component === 'string') {
        // HTML element - use jsx() to create proper VNode or DOM element
        // jsx() expects (type, props, key) where props includes children
        return jsx(component, propsToUse, undefined);
      } else {
        // Component
        return (component as any)(propsToUse);
      }
    };
  });
}

/**
 * Create styled HTML element factories
 */
type HTMLElements =
  | 'div'
  | 'span'
  | 'a'
  | 'button'
  | 'input'
  | 'textarea'
  | 'select'
  | 'label'
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'li'
  | 'section'
  | 'article'
  | 'header'
  | 'footer'
  | 'main'
  | 'nav'
  | 'aside'
  | 'form'
  | 'img'
  | 'video'
  | 'audio'
  | 'canvas'
  | 'svg'
  | 'path'
  | 'circle'
  | 'rect'
  | 'line'
  | 'polygon'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'td'
  | 'th';

/**
 * Styled HTML elements
 */
type StyledHTML = {
  [K in HTMLElements]: <V extends VariantConfig = VariantConfig>(
    styleConfig: StyleConfig<V>
  ) => Component<StyledProps<V>>;
};

/**
 * Create styled element factory
 */
function createStyledElement(element: string) {
  return <V extends VariantConfig = VariantConfig>(styleConfig: StyleConfig<V>) => styled<any, V>(element, styleConfig);
}

/**
 * HTML element factories
 */
const htmlElements: HTMLElements[] = [
  'div',
  'span',
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'nav',
  'aside',
  'form',
  'img',
  'video',
  'audio',
  'canvas',
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polygon',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
];

// Attach HTML element factories to styled function
const styledWithElements = styled as typeof styled & StyledHTML;

for (const element of htmlElements) {
  (styledWithElements as any)[element] = createStyledElement(element);
}

export { styledWithElements };
export default styledWithElements;

/**
 * Type helper to extract variant props from a styled component
 */
export type ExtractVariantProps<T> = T extends Component<infer P> ? P : never;

/**
 * Create a style variant (helper for cleaner variant definitions)
 */
export function createVariant<V extends VariantConfig>(variantConfig: V): V {
  return variantConfig;
}

/**
 * Compose multiple style configs
 */
export function composeStyles<V1 extends VariantConfig, V2 extends VariantConfig>(
  config1: StyleConfig<V1>,
  config2: StyleConfig<V2>
): StyleConfig<V1 & V2> {
  return {
    base: mergeCSS(config1.base, config2.base),
    variants: { ...config1.variants, ...config2.variants } as V1 & V2,
    compoundVariants: [...(config1.compoundVariants || []), ...(config2.compoundVariants || [])],
    defaultVariants: { ...config1.defaultVariants, ...config2.defaultVariants } as DefaultVariants<V1 & V2>,
  };
}
