/**
 * SVG Base Element
 *
 * Core SVG container with full reactive support
 */

import { defineComponent, signal, effect } from '../../index.js';
import type { Signal } from '../../index.js';
import type { JSX } from '../../core/component/types.js';

export interface SVGProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'style' | 'className' | 'preserveAspectRatio'> {
  // Viewport
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
  viewBox?: string | Signal<string>;
  preserveAspectRatio?: string | Signal<string>;

  // Styling
  className?: string | Signal<string>;
  style?: JSX.CSSProperties | Signal<JSX.CSSProperties>;

  // Accessibility
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  title?: string;
  desc?: string;

  // Performance
  lazy?: boolean;
  placeholder?: JSX.Element;

  // Children
  children?: JSX.Element;
}

/**
 * SVG base component with reactive attribute support
 */
export const SVG = defineComponent<SVGProps>((props) => {
  const resolveValue = <T,>(value: T | Signal<T>): T => typeof value === 'function' ? (value as Signal<T>)() : value;

  const getNumericValue = (value: string | number | Signal<string | number> | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const resolved = resolveValue(value);
    return typeof resolved === 'number' ? `${resolved}` : resolved;
  };

  // Convert camelCase to kebab-case for SVG attributes
  const toKebabCase = (str: string): string => str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

  // Process props to handle camelCase to kebab-case conversion
  const processProps = (inputProps: any) => {
    const processed: any = {};
    const specialProps = ['children', 'lazy', 'placeholder', 'title', 'desc', 'width', 'height', 'viewBox', 'className', 'style', 'preserveAspectRatio', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby'];

    for (const key in inputProps) {
      if (Object.prototype.hasOwnProperty.call(inputProps, key)) {
        const value = inputProps[key];
        // Skip special props that are handled explicitly
        if (specialProps.includes(key)) {
          continue;
        }
        // Pass through event handlers (functions that start with 'on')
        if (key.startsWith('on') && typeof value === 'function') {
          processed[key] = value;
          continue;
        }
        // Convert camelCase to kebab-case for SVG attributes
        const kebabKey = toKebabCase(key);
        processed[kebabKey] = value;
      }
    }
    return processed;
  };

  const isVisible = signal(!props.lazy);

  if (props.lazy && typeof window !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        isVisible.set(true);
        observer.disconnect();
      }
    });

    effect(() => {
      const element = document.currentScript?.parentElement;
      if (element) {
        observer.observe(element);
      }
    });
  }

  return () => {
    if (props.lazy && !isVisible()) {
      if (props.placeholder) {
        return props.placeholder;
      }

      // Create default placeholder with proper numeric values
      const width = getNumericValue(props.width);
      const height = getNumericValue(props.height);
      return <div style={{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : undefined }} />;
    }

    // Create title and desc elements for accessibility
    const accessibilityElements: JSX.Element[] = [];
    if (props.title) {
      accessibilityElements.push(<title>{props.title}</title>);
    }
    if (props.desc) {
      accessibilityElements.push(<desc>{props.desc}</desc>);
    }

    // Process all props and convert camelCase to kebab-case
    const processedProps = processProps(props);

    // Pass signals directly to JSX for reactive tracking
    const svgProps = {
      ...processedProps,
      width: props.width,
      height: props.height,
      viewBox: props.viewBox,
      className: props.className,
      style: props.style,
      preserveAspectRatio: props.preserveAspectRatio,
      role: props.role || (props['aria-label'] ? 'img' : undefined),
      'aria-label': props['aria-label'],
      'aria-labelledby': props['aria-labelledby'],
      'aria-describedby': props['aria-describedby'],
    } as any;

    return (
      <svg {...svgProps}>
        {accessibilityElements}
        {props.children}
      </svg>
    );
  };
});

// Export type for external use
export type SVGComponent = typeof SVG;