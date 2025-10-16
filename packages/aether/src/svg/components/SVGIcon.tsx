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
  name?: string; // Icon name from registry
  src?: string; // URL or inline SVG
  path?: string | Signal<string>; // Path data

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
  spin?: boolean | number; // Rotation animation
  pulse?: boolean; // Pulse animation
  flip?: 'horizontal' | 'vertical' | 'both';
  rotate?: number | Signal<number>;

  // Performance
  sprite?: boolean; // Use sprite sheet
  cache?: boolean; // Cache rendered SVG

  // Accessibility
  decorative?: boolean; // aria-hidden for decorative icons
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

  // Calculate dimensions as separate computed signals for reactivity
  const width = computed(() => {
    if (props.width) {
      return resolveValue(props.width);
    }
    const size = resolveValue(props.size);
    if (size) {
      return typeof size === 'string' ? SIZE_PRESETS[size] : size;
    }
    return 24; // Default size
  });

  const height = computed(() => {
    if (props.height) {
      return resolveValue(props.height);
    }
    const size = resolveValue(props.size);
    if (size) {
      return typeof size === 'string' ? SIZE_PRESETS[size] : size;
    }
    return 24; // Default size
  });

  // Load icon from registry
  effect(() => {
    (async () => {
      if (props.name) {
        try {
          const registry = getIconRegistry();
          const icon = await registry.get(props.name);
          if (icon) {
            // Use nullish coalescing to preserve empty strings
            iconData.set(icon.content ?? icon.path ?? null);
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
    const w = width();
    const h = height();
    const centerX = Number(w) / 2;
    const centerY = Number(h) / 2;

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
      if (scaleX === -1) transforms.push(`translate(${-Number(w)} 0)`);
      if (scaleY === -1) transforms.push(`translate(0 ${-Number(h)})`);
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

  // Calculate viewBox as computed signal (created once, not on every render)
  const viewBox = computed(() => props.viewBox || `0 0 ${width()} ${height()}`);

  // Determine fill/stroke values (pass signals when possible)
  const fill = computed(() => {
    const f = resolveValue(props.fill);
    const c = resolveValue(props.color);
    return f || c || 'currentColor';
  });

  const stroke = computed(() => resolveValue(props.stroke));
  const strokeWidth = computed(() => resolveValue(props.strokeWidth));

  return () => {
    // Merge styles at render time (animations + custom styles)
    const mergedStyles = { ...animationStyles(), ...props.style };

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

    // Determine state
    const hasError = error() !== null;
    const hasPath = props.path !== undefined;
    const hasIconData = iconData() !== null;
    const loaded = isLoaded();

    // Error state
    if (hasError) {
      return (
        <svg
          width={width as any}
          height={height as any}
          className={props.className}
          style={mergedStyles}
          {...accessibilityProps}
        >
          <rect width={width as any} height={height as any} fill="none" stroke="red" strokeWidth="2" />
          <line x1="0" y1="0" x2={width as any} y2={height as any} stroke="red" strokeWidth="2" />
          <line x1={width as any} y1="0" x2="0" y2={height as any} stroke="red" strokeWidth="2" />
        </svg>
      );
    }

    // Path state - use JSX to enable reactivity
    if (hasPath) {
      return (
        <svg
          width={width as any}
          height={height as any}
          viewBox={viewBox as any}
          className={props.className}
          transform={buildTransform as any}
          onClick={props.onClick}
          style={mergedStyles}
          {...accessibilityProps}
        >
          <path d={props.path as any} fill={fill as any} stroke={stroke as any} strokeWidth={strokeWidth as any} />
        </svg>
      );
    }

    // Icon data state
    if (hasIconData) {
      const iconContent = iconData();

      // Handle empty or invalid data - render empty SVG
      if (!iconContent || iconContent.trim() === '') {
        return (
          <svg
            width={width as any}
            height={height as any}
            viewBox={viewBox as any}
            className={props.className}
            style={mergedStyles}
            {...accessibilityProps}
          />
        );
      }

      // Check if it's a full SVG string or just path data
      const isFullSVG = iconContent.trim().startsWith('<svg') || iconContent.trim().startsWith('<');

      if (isFullSVG) {
        // Parse full SVG content
        const temp = document.createElement('div');
        temp.innerHTML = iconContent;
        const child = temp.firstElementChild;
        if (child) {
          // Apply dimensions and styles
          if (child.tagName.toLowerCase() === 'svg') {
            child.setAttribute('width', String(width()));
            child.setAttribute('height', String(height()));
            Object.assign((child as HTMLElement).style, mergedStyles);
            if (props.className) child.setAttribute('class', props.className);
          }
          return child as any;
        }
      } else {
        // It's just path data - render as SVG with path element
        return (
          <svg
            width={width as any}
            height={height as any}
            viewBox={viewBox as any}
            className={props.className}
            transform={buildTransform as any}
            onClick={props.onClick}
            style={mergedStyles}
            {...accessibilityProps}
          >
            <path d={iconContent} fill={fill as any} stroke={stroke as any} strokeWidth={strokeWidth as any} />
          </svg>
        );
      }
    }

    // Loading state
    if (!loaded) {
      return (
        <svg
          width={width as any}
          height={height as any}
          className={props.className}
          style={{ opacity: 0.3, ...mergedStyles }}
          {...accessibilityProps}
        >
          <rect width={width as any} height={height as any} fill={fill as any} opacity="0.1" />
        </svg>
      );
    }

    // Empty state
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
