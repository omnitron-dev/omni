/**
 * SVGIcon Component
 *
 * High-level component for rendering SVG icons with animation and optimization support
 */

import { defineComponent, signal, computed, effect } from '../../index.js';
import type { Signal } from '../../index.js';
import { getIconRegistry } from '../icons/IconRegistry.js';
import type { AnimationConfig } from '../animations/types.js';

// Size presets
const SIZE_PRESETS = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
  xl: 48,
} as const;

export interface SVGIconProps {
  // Icon source
  name?: string;                    // Icon name from registry
  src?: string;                      // URL or inline SVG
  path?: string | Signal<string>;   // Path data

  // Sizing
  size?: keyof typeof SIZE_PRESETS | number | Signal<number>;
  width?: string | number | Signal<string | number>;
  height?: string | number | Signal<string | number>;
  viewBox?: string;

  // Styling
  color?: string | Signal<string>;
  fill?: string | Signal<string>;
  stroke?: string | Signal<string>;
  strokeWidth?: string | number | Signal<string | number>;
  className?: string;
  style?: any;

  // Animation
  animate?: boolean | AnimationConfig;
  hover?: AnimationConfig;

  // Behavior
  spin?: boolean | number;           // Rotation animation
  pulse?: boolean;                   // Pulse animation
  flip?: 'horizontal' | 'vertical' | 'both';
  rotate?: number | Signal<number>;

  // Performance
  sprite?: boolean;                  // Use sprite sheet
  cache?: boolean;                   // Cache rendered SVG

  // Accessibility
  decorative?: boolean;              // aria-hidden for decorative icons
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  title?: string;
  desc?: string;

  // Events
  onLoad?: () => void;
  onError?: (e: Error) => void;
  onClick?: (e: MouseEvent) => void;
}

/**
 * SVGIcon component for rendering icons with various sources and options
 */
export const SVGIcon = defineComponent<SVGIconProps>((props) => {
  const isLoaded = signal(false);
  const error = signal<Error | null>(null);
  const iconData = signal<string | null>(null);
  const _isHovered = signal(false);

  // Resolve value from signal or static value
  const resolveValue = <T,>(value: T | Signal<T> | undefined): T | undefined => {
    if (value === undefined) return undefined;
    return typeof value === 'function' ? (value as Signal<T>)() : value;
  };

  // Calculate dimensions
  const dimensions = computed(() => {
    if (props.width && props.height) {
      return {
        width: resolveValue(props.width),
        height: resolveValue(props.height),
      };
    }

    const size = resolveValue(props.size);
    if (size) {
      const sizeValue = typeof size === 'string' ? SIZE_PRESETS[size] : size;
      return { width: sizeValue, height: sizeValue };
    }

    return { width: 24, height: 24 }; // Default size
  });

  // Load icon from registry
  effect(() => {
    (async () => {
      if (props.name) {
        try {
          const registry = getIconRegistry();
          const icon = await registry.get(props.name);
          if (icon) {
            iconData.set(icon.content || icon.path || null);
            isLoaded.set(true);
            props.onLoad?.();
          } else {
            throw new Error(`Icon "${props.name}" not found in registry`);
          }
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          error.set(err);
          props.onError?.(err);
        }
      } else if (props.src) {
        // Load from URL
        if (props.src.startsWith('http') || props.src.startsWith('/')) {
          try {
            const response = await fetch(props.src);
            const svg = await response.text();
            iconData.set(svg);
            isLoaded.set(true);
            props.onLoad?.();
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            error.set(err);
            props.onError?.(err);
          }
        } else {
          // Inline SVG
          iconData.set(props.src);
          isLoaded.set(true);
          props.onLoad?.();
        }
      } else if (props.path) {
        isLoaded.set(true);
        props.onLoad?.();
      }
    })();
  });

  // Build transform string
  const buildTransform = computed(() => {
    const transforms: string[] = [];
    const { width, height } = dimensions();
    const centerX = Number(width) / 2;
    const centerY = Number(height) / 2;

    // Rotation
    const rotate = resolveValue(props.rotate);
    if (rotate) {
      transforms.push(`rotate(${rotate} ${centerX} ${centerY})`);
    }

    // Flip
    if (props.flip) {
      const scaleX = props.flip === 'horizontal' || props.flip === 'both' ? -1 : 1;
      const scaleY = props.flip === 'vertical' || props.flip === 'both' ? -1 : 1;
      transforms.push(`scale(${scaleX} ${scaleY})`);
      if (scaleX === -1) transforms.push(`translate(${-Number(width)} 0)`);
      if (scaleY === -1) transforms.push(`translate(0 ${-Number(height)})`);
    }

    return transforms.length > 0 ? transforms.join(' ') : undefined;
  });

  // Build animation styles
  const animationStyles = computed(() => {
    const styles: any = {};

    if (props.spin) {
      const duration = typeof props.spin === 'number' ? props.spin : 2;
      styles.animation = `aether-spin ${duration}s linear infinite`;
    }

    if (props.pulse) {
      styles.animation = `aether-pulse 2s ease-in-out infinite`;
    }

    return styles;
  });

  return () => {
    const { width, height } = dimensions();
    // Pass color/fill/stroke as signals for reactivity, with fallback logic
    const fill = props.fill || props.color || 'currentColor';
    const stroke = props.stroke;
    const strokeWidth = props.strokeWidth;
    const transform = buildTransform();
    const styles = { ...animationStyles(), ...props.style };

    // Build accessibility props
    const accessibilityProps: any = {
      role: props.decorative ? 'presentation' : props.role,
      'aria-hidden': props.decorative ? 'true' : undefined,
      'aria-label': props['aria-label'],
      'aria-labelledby': props['aria-labelledby'],
      'aria-describedby': props['aria-describedby'],
      title: props.title,
      desc: props.desc,
    };

    // Create all possible SVG states manually
    const errorSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    errorSvg.setAttribute('width', String(width));
    errorSvg.setAttribute('height', String(height));
    if (props.className) errorSvg.setAttribute('class', props.className);
    Object.assign(errorSvg.style, styles);
    Object.entries(accessibilityProps).forEach(([key, value]) => {
      if (value !== undefined) errorSvg.setAttribute(key, String(value));
    });
    const errorRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    errorRect.setAttribute('width', String(width));
    errorRect.setAttribute('height', String(height));
    errorRect.setAttribute('fill', 'none');
    errorRect.setAttribute('stroke', 'red');
    errorRect.setAttribute('stroke-width', '2');
    errorSvg.appendChild(errorRect);
    const errorLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    errorLine1.setAttribute('x1', '0');
    errorLine1.setAttribute('y1', '0');
    errorLine1.setAttribute('x2', String(width));
    errorLine1.setAttribute('y2', String(height));
    errorLine1.setAttribute('stroke', 'red');
    errorLine1.setAttribute('stroke-width', '2');
    errorSvg.appendChild(errorLine1);
    const errorLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    errorLine2.setAttribute('x1', String(width));
    errorLine2.setAttribute('y1', '0');
    errorLine2.setAttribute('x2', '0');
    errorLine2.setAttribute('y2', String(height));
    errorLine2.setAttribute('stroke', 'red');
    errorLine2.setAttribute('stroke-width', '2');
    errorSvg.appendChild(errorLine2);

    const pathSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pathSvg.setAttribute('width', String(width));
    pathSvg.setAttribute('height', String(height));
    pathSvg.setAttribute('viewBox', props.viewBox || `0 0 ${width} ${height}`);
    if (props.className) pathSvg.setAttribute('class', props.className);
    if (transform) pathSvg.setAttribute('transform', transform);
    if (props.onClick) pathSvg.addEventListener('click', props.onClick as any);
    Object.assign(pathSvg.style, styles);
    Object.entries(accessibilityProps).forEach(([key, value]) => {
      if (value !== undefined) pathSvg.setAttribute(key, String(value));
    });
    if (props.path) {
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const pathValue = typeof props.path === 'function' ? props.path() : props.path;
      pathEl.setAttribute('d', pathValue || '');
      pathEl.setAttribute('fill', typeof fill === 'function' ? fill() : fill);
      if (stroke) pathEl.setAttribute('stroke', typeof stroke === 'function' ? stroke() : stroke);
      if (strokeWidth) pathEl.setAttribute('strokeWidth', String(strokeWidth));
      pathSvg.appendChild(pathEl);
    }

    const loadingSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    loadingSvg.setAttribute('width', String(width));
    loadingSvg.setAttribute('height', String(height));
    if (props.className) loadingSvg.setAttribute('class', props.className);
    Object.assign(loadingSvg.style, { opacity: 0.3, ...styles });
    Object.entries(accessibilityProps).forEach(([key, value]) => {
      if (value !== undefined) loadingSvg.setAttribute(key, String(value));
    });
    const loadingRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    loadingRect.setAttribute('width', String(width));
    loadingRect.setAttribute('height', String(height));
    loadingRect.setAttribute('fill', typeof fill === 'function' ? fill() : fill);
    loadingRect.setAttribute('opacity', '0.1');
    loadingSvg.appendChild(loadingRect);

    // Create container
    const container = document.createElement('div');
    container.style.display = 'contents';

    // Helper to set current SVG
    const setCurrentSvg = (svg: SVGElement | null) => {
      // Remove all children
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      // Add the new SVG if provided
      if (svg) {
        container.appendChild(svg);
      }
    };

    // Helper to render iconData as HTML
    const renderIconData = () => {
      const svgString = iconData();
      if (svgString) {
        // Create a temp div to parse the HTML
        const temp = document.createElement('div');
        temp.innerHTML = svgString;
        // Get the first child (should be SVG or wrapper)
        const child = temp.firstElementChild;
        if (child) {
          // Apply dimensions and styles
          if (child.tagName.toLowerCase() === 'svg') {
            child.setAttribute('width', String(width));
            child.setAttribute('height', String(height));
            Object.assign((child as HTMLElement).style, styles);
            if (props.className) child.setAttribute('class', props.className);
          }
          return child;
        }
      }
      return null;
    };

    // Determine initial state and set appropriate element
    const hasError = error() !== null;
    const hasPath = props.path !== undefined;
    const hasIconData = iconData() !== null;
    const loaded = isLoaded();

    if (hasError) {
      setCurrentSvg(errorSvg);
    } else if (hasPath) {
      setCurrentSvg(pathSvg);
    } else if (hasIconData) {
      const iconElement = renderIconData();
      if (iconElement) {
        container.appendChild(iconElement);
      }
    } else if (!loaded) {
      setCurrentSvg(loadingSvg);
    }

    // Set up reactive effect to swap elements when state changes
    effect(() => {
      const hasError = error() !== null;
      const hasPath = props.path !== undefined;
      const hasIconData = iconData() !== null;
      const loaded = isLoaded();

      if (hasError) {
        setCurrentSvg(errorSvg);
      } else if (hasPath) {
        setCurrentSvg(pathSvg);
      } else if (hasIconData) {
        const iconElement = renderIconData();
        if (iconElement) {
          // Remove all children
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
          container.appendChild(iconElement);
        }
      } else if (!loaded) {
        setCurrentSvg(loadingSvg);
      } else {
        setCurrentSvg(null);
      }
    });

    return container;
  };
});

// Add global styles for animations
if (typeof document !== 'undefined' && !document.querySelector('#aether-svg-animations')) {
  const style = document.createElement('style');
  style.id = 'aether-svg-animations';
  style.textContent = `
    @keyframes aether-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes aether-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
}