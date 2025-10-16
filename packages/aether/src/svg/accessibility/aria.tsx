/**
 * ARIA Support for SVG
 *
 * Implements comprehensive accessibility features for SVG elements
 * following WCAG 2.1 AA guidelines
 */

import type { Signal } from '../../core/reactivity/index.js';
import type { JSX } from '../../core/component/types.js';

/**
 * Accessible SVG properties
 */
export interface AccessibleSVGProps {
  // Labeling
  title?: string;
  desc?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;

  // Role
  role?: 'img' | 'presentation' | 'graphics-document' | string;

  // State
  ariaHidden?: boolean;
  ariaLive?: 'polite' | 'assertive' | 'off';
  ariaBusy?: boolean;

  // Decorative mode (sets aria-hidden and role=presentation)
  decorative?: boolean;

  // Focus
  focusable?: boolean;
  tabIndex?: number;
}

/**
 * Accessibility options for makeAccessible utility
 */
export interface AccessibilityOptions extends AccessibleSVGProps {
  // Element to apply attributes to
  element?: SVGElement;

  // Auto-generate IDs if needed
  autoGenerateIds?: boolean;
}

/**
 * Create accessible SVG element with proper ARIA attributes
 */
export function createAccessibleSVG(
  props: AccessibleSVGProps & {
    children?: JSX.Element;
    [key: string]: any;
  }
): JSX.Element {
  const {
    title,
    desc,
    ariaLabel,
    ariaLabelledBy,
    ariaDescribedBy,
    role,
    ariaHidden,
    ariaLive,
    ariaBusy,
    decorative,
    focusable,
    tabIndex,
    children,
    ...rest
  } = props;

  // Generate IDs for title and desc if needed
  const titleId = title && !ariaLabelledBy ? `svg-title-${generateId()}` : undefined;
  const descId = desc && !ariaDescribedBy ? `svg-desc-${generateId()}` : undefined;

  // Build aria-labelledby and aria-describedby
  const labelledBy = ariaLabelledBy || (titleId ? titleId : undefined);
  const describedBy = ariaDescribedBy || (descId ? descId : undefined);

  // Determine role
  let finalRole = role;
  if (decorative) {
    finalRole = 'presentation';
  } else if (!finalRole && (ariaLabel || labelledBy)) {
    finalRole = 'img';
  }

  // Build aria attributes
  const ariaAttrs: Record<string, any> = {};

  if (ariaLabel) ariaAttrs['aria-label'] = ariaLabel;
  if (labelledBy) ariaAttrs['aria-labelledby'] = labelledBy;
  if (describedBy) ariaAttrs['aria-describedby'] = describedBy;
  if (ariaHidden !== undefined) ariaAttrs['aria-hidden'] = ariaHidden;
  if (ariaLive) ariaAttrs['aria-live'] = ariaLive;
  if (ariaBusy !== undefined) ariaAttrs['aria-busy'] = ariaBusy;
  if (decorative) ariaAttrs['aria-hidden'] = true;

  // Build focus attributes
  const focusAttrs: Record<string, any> = {};
  if (focusable !== undefined) {
    focusAttrs['focusable'] = focusable ? 'true' : 'false';
  }
  if (tabIndex !== undefined) {
    focusAttrs['tabIndex'] = tabIndex;
  }

  // Create accessibility elements
  const accessibilityElements: JSX.Element[] = [];
  if (title) {
    accessibilityElements.push(<title id={titleId}>{title}</title>);
  }
  if (desc) {
    accessibilityElements.push(<desc id={descId}>{desc}</desc>);
  }

  const svgProps: any = {
    ...rest,
    ...ariaAttrs,
    ...focusAttrs,
    role: finalRole,
  };

  return (
    <svg {...svgProps}>
      {accessibilityElements}
      {children}
    </svg>
  );
}

/**
 * Make an existing SVG element accessible by adding ARIA attributes
 */
export function makeAccessible(svg: SVGElement, options: AccessibilityOptions): void {
  const {
    title,
    desc,
    ariaLabel,
    ariaLabelledBy,
    ariaDescribedBy,
    role,
    ariaHidden,
    ariaLive,
    ariaBusy,
    decorative,
    focusable,
    tabIndex,
    autoGenerateIds = true,
  } = options;

  // Create and append title element if provided
  if (title) {
    let titleElement = svg.querySelector('title') as SVGTitleElement | null;
    if (!titleElement) {
      titleElement = document.createElementNS('http://www.w3.org/2000/svg', 'title') as SVGTitleElement;
      svg.insertBefore(titleElement, svg.firstChild);
    }
    titleElement.textContent = title;

    if (autoGenerateIds && !titleElement.id) {
      titleElement.id = `svg-title-${generateId()}`;
    }

    // Set aria-labelledby if not already set
    if (!ariaLabelledBy && !svg.hasAttribute('aria-labelledby') && titleElement.id) {
      svg.setAttribute('aria-labelledby', titleElement.id);
    }
  }

  // Create and append desc element if provided
  if (desc) {
    let descElement = svg.querySelector('desc') as SVGDescElement | null;
    if (!descElement) {
      descElement = document.createElementNS('http://www.w3.org/2000/svg', 'desc') as SVGDescElement;
      const titleElement = svg.querySelector('title');
      if (titleElement && titleElement.nextSibling) {
        svg.insertBefore(descElement, titleElement.nextSibling);
      } else {
        svg.insertBefore(descElement, svg.firstChild);
      }
    }
    descElement.textContent = desc;

    if (autoGenerateIds && !descElement.id) {
      descElement.id = `svg-desc-${generateId()}`;
    }

    // Set aria-describedby if not already set
    if (!ariaDescribedBy && !svg.hasAttribute('aria-describedby') && descElement.id) {
      svg.setAttribute('aria-describedby', descElement.id);
    }
  }

  // Handle decorative mode
  if (decorative) {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('role', 'presentation');
    return;
  }

  // Set ARIA attributes
  if (ariaLabel) {
    svg.setAttribute('aria-label', ariaLabel);
  }
  if (ariaLabelledBy) {
    svg.setAttribute('aria-labelledby', ariaLabelledBy);
  }
  if (ariaDescribedBy) {
    svg.setAttribute('aria-describedby', ariaDescribedBy);
  }
  if (ariaHidden !== undefined) {
    svg.setAttribute('aria-hidden', String(ariaHidden));
  }
  if (ariaLive) {
    svg.setAttribute('aria-live', ariaLive);
  }
  if (ariaBusy !== undefined) {
    svg.setAttribute('aria-busy', String(ariaBusy));
  }

  // Set role
  if (role) {
    svg.setAttribute('role', role);
  } else if (ariaLabel || svg.hasAttribute('aria-labelledby')) {
    // Auto-set role to img if there's a label
    svg.setAttribute('role', 'img');
  }

  // Set focus attributes
  if (focusable !== undefined) {
    svg.setAttribute('focusable', focusable ? 'true' : 'false');
  }
  if (tabIndex !== undefined) {
    svg.setAttribute('tabindex', String(tabIndex));
  }
}

/**
 * Generate unique ID for accessibility elements
 */
let idCounter = 0;
function generateId(): string {
  return `a11y-${Date.now()}-${++idCounter}`;
}

/**
 * Helper to resolve signal or static value
 */
export function resolveValue<T>(value: T | Signal<T>): T {
  return typeof value === 'function' ? (value as Signal<T>)() : value;
}

/**
 * Apply accessible SVG props to an element's attributes
 */
export function applyAccessibleProps(element: SVGElement, props: AccessibleSVGProps): void {
  makeAccessible(element, props);
}

/**
 * Higher-order component to add ARIA attributes to an SVG component
 *
 * @example
 * ```tsx
 * const AccessibleIcon = withARIA(MyIcon, {
 *   role: 'img',
 *   ariaLabel: 'Home icon'
 * });
 * ```
 */
export function withARIA<P extends Record<string, any>>(
  Component: (props: P) => JSX.Element,
  ariaProps: AccessibleSVGProps
): (props: P) => JSX.Element {
  return (props: P): JSX.Element => {
    const mergedProps = {
      ...props,
      ...ariaProps,
    };
    return Component(mergedProps);
  };
}

/**
 * Ensure unique ID for ARIA references
 *
 * Generates a unique ID if one doesn't exist, or returns existing ID
 */
export function ensureUniqueId(element: Element, prefix = 'aria'): string {
  if (element.id) {
    return element.id;
  }

  const id = `${prefix}-${generateId()}`;
  element.id = id;
  return id;
}

/**
 * Validate ARIA attributes for development warnings
 *
 * Checks for common ARIA mistakes and logs warnings in development mode
 */
export function validateARIA(element: SVGElement): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const issues: string[] = [];

  // Check for aria-labelledby pointing to non-existent IDs
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    ids.forEach((id) => {
      if (!document.getElementById(id)) {
        issues.push(`aria-labelledby references non-existent ID: ${id}`);
      }
    });
  }

  // Check for aria-describedby pointing to non-existent IDs
  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy) {
    const ids = describedBy.split(/\s+/);
    ids.forEach((id) => {
      if (!document.getElementById(id)) {
        issues.push(`aria-describedby references non-existent ID: ${id}`);
      }
    });
  }

  // Check for conflicting aria-hidden and role
  const ariaHidden = element.getAttribute('aria-hidden');
  const role = element.getAttribute('role');
  if (ariaHidden === 'true' && role && role !== 'presentation' && role !== 'none') {
    issues.push(`aria-hidden="true" with role="${role}" may be confusing. Consider role="presentation"`);
  }

  // Check for aria-label without role
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && !role && ariaHidden !== 'true') {
    issues.push('aria-label without role attribute. Consider adding role="img"');
  }

  // Check for focusable="false" with tabindex
  const focusable = element.getAttribute('focusable');
  const tabIndex = element.getAttribute('tabindex');
  if (focusable === 'false' && tabIndex && tabIndex !== '-1') {
    issues.push('focusable="false" conflicts with tabindex. Element may not be keyboard accessible');
  }

  // Log issues
  if (issues.length > 0) {
    console.warn(`[Aether SVG A11y] Issues found in SVG element:`, element);
    issues.forEach((issue) => {
      console.warn(`  - ${issue}`);
    });
  }
}
