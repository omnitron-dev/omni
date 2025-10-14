/**
 * SVGIcon Component
 *
 * High-level component for rendering SVG icons with animation and optimization support
 */

import { defineComponent, signal, computed, effect, onCleanup } from '../../index.js';
import type { Signal } from '../../index.js';
import { SVG } from '../primitives/svg.js';
import { Path } from '../primitives/shapes.js';
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
  const isHovered = signal(false);

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
  effect(async () => {
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
    const color = resolveValue(props.color);
    const fill = resolveValue(props.fill) ?? color ?? 'currentColor';
    const stroke = resolveValue(props.stroke);
    const strokeWidth = resolveValue(props.strokeWidth);
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

    // Handle error state - return error indicator
    if (error()) {
      return SVG({
        width,
        height,
        className: props.className,
        style: styles,
        ...accessibilityProps,
        children: () => {
          const errorMarkup = `
            <rect width="${width}" height="${height}" fill="none" stroke="red" stroke-width="2" />
            <line x1="0" y1="0" x2="${width}" y2="${height}" stroke="red" stroke-width="2" />
            <line x1="${width}" y1="0" x2="0" y2="${height}" stroke="red" stroke-width="2" />
          `;
          return errorMarkup;
        }
      });
    }

    // Render path
    const pathData = resolveValue(props.path);
    if (pathData) {
      return SVG({
        width,
        height,
        viewBox: props.viewBox || `0 0 ${width} ${height}`,
        className: props.className,
        style: styles,
        transform,
        onClick: props.onClick,
        ...accessibilityProps,
        children: () => Path({
          d: pathData,
          fill,
          stroke,
          strokeWidth,
        })
      });
    }

    // Render loaded icon data
    if (iconData()) {
      // For now, we return raw SVG as HTML
      // In a real implementation, this would parse and render properly
      const svgString = iconData();
      if (svgString) {
        // Create wrapper div with proper dimensions and styles
        const wrapperStyles = {
          width: `${width}px`,
          height: `${height}px`,
          display: 'inline-block',
          ...styles,
        };

        // Return wrapper element
        // This is a simplified approach - in production would parse and render SVG properly
        return `<div style="${Object.entries(wrapperStyles).map(([k, v]) => `${k}: ${v}`).join('; ')}">${svgString}</div>`;
      }
    }

    // Loading state
    if (!isLoaded()) {
      return SVG({
        width,
        height,
        className: props.className,
        style: { opacity: 0.3, ...styles },
        ...accessibilityProps,
        children: () => `<rect width="${width}" height="${height}" fill="${fill}" opacity="0.1" />`
      });
    }

    return null;
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