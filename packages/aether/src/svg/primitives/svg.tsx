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
      return props.placeholder || <div style={{ width: getNumericValue(props.width), height: getNumericValue(props.height) }} />;
    }

    const width = getNumericValue(props.width);
    const height = getNumericValue(props.height);
    const viewBox = resolveValue(props.viewBox);
    const className = resolveValue(props.className);
    const style = resolveValue(props.style);

    // Create title and desc elements for accessibility
    const accessibilityElements: JSX.Element[] = [];
    if (props.title) {
      accessibilityElements.push(<title>{props.title}</title>);
    }
    if (props.desc) {
      accessibilityElements.push(<desc>{props.desc}</desc>);
    }

    // Cast to any to bypass strict type checking for Signal props
    const svgProps = {
      ...props,
      width,
      height,
      viewBox,
      className,
      style,
      preserveAspectRatio: resolveValue(props.preserveAspectRatio),
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