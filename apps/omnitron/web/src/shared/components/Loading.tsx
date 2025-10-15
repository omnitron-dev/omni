/**
 * Loading Component
 *
 * A versatile loading indicator with multiple variants and customization options.
 *
 * @example
 * ```tsx
 * <Loading variant="spinner" size="md" text="Loading..." />
 * <Loading variant="dots" overlay />
 * <Loading variant="pulse" fullscreen />
 * ```
 */

import { defineComponent } from '@omnitron-dev/aether';
import { jsx } from '@omnitron-dev/aether/jsx-runtime';

// ============================================================================
// Types
// ============================================================================

export type LoadingVariant = 'spinner' | 'dots' | 'pulse' | 'bars' | 'ring';
export type LoadingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface LoadingProps {
  /** Loading variant */
  variant?: LoadingVariant;

  /** Loading size */
  size?: LoadingSize;

  /** Loading text */
  text?: string;

  /** Whether to show as overlay */
  overlay?: boolean;

  /** Whether to show fullscreen */
  fullscreen?: boolean;

  /** Animation speed */
  speed?: 'slow' | 'normal' | 'fast';

  /** Color (CSS color value) */
  color?: string;

  /** Additional CSS class */
  class?: string;

  /** ARIA label */
  'aria-label'?: string;

  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Loading Component
// ============================================================================

export const Loading = defineComponent<LoadingProps>((props) => () => {
  const {
    variant = 'spinner',
    size = 'md',
    text,
    overlay = false,
    fullscreen = false,
    speed = 'normal',
    color,
    class: className = '',
    'aria-label': ariaLabel,
    ...rest
  } = props;

  const renderSpinner = () =>
    jsx('svg', {
      'data-loading-svg': '',
      viewBox: '0 0 50 50',
      children: jsx('circle', {
        'data-loading-circle': '',
        cx: '25',
        cy: '25',
        r: '20',
        fill: 'none',
        stroke: color || 'currentColor',
        'stroke-width': '4',
        'stroke-dasharray': '80, 200',
        'stroke-dashoffset': '0',
      }),
    });

  const renderDots = () =>
    jsx('div', {
      'data-loading-dots': '',
      children: [
        jsx('div', { 'data-loading-dot': '', style: color ? { background: color } : undefined }),
        jsx('div', { 'data-loading-dot': '', style: color ? { background: color } : undefined }),
        jsx('div', { 'data-loading-dot': '', style: color ? { background: color } : undefined }),
      ],
    });

  const renderPulse = () =>
    jsx('div', {
      'data-loading-pulse': '',
      style: color ? { background: color } : undefined,
    });

  const renderBars = () =>
    jsx('div', {
      'data-loading-bars': '',
      children: [
        jsx('div', { 'data-loading-bar': '', style: color ? { background: color } : undefined }),
        jsx('div', { 'data-loading-bar': '', style: color ? { background: color } : undefined }),
        jsx('div', { 'data-loading-bar': '', style: color ? { background: color } : undefined }),
        jsx('div', { 'data-loading-bar': '', style: color ? { background: color } : undefined }),
      ],
    });

  const renderRing = () =>
    jsx('div', {
      'data-loading-ring': '',
      style: color ? { borderColor: `${color} transparent transparent transparent` } : undefined,
    });

  const renderContent = () => {
    switch (variant) {
      case 'spinner':
        return renderSpinner();
      case 'dots':
        return renderDots();
      case 'pulse':
        return renderPulse();
      case 'bars':
        return renderBars();
      case 'ring':
        return renderRing();
      default:
        return renderSpinner();
    }
  };

  const loadingElement = jsx('div', {
    ...rest,
    'data-loading': '',
    'data-variant': variant,
    'data-size': size,
    'data-speed': speed,
    'data-overlay': overlay || undefined,
    'data-fullscreen': fullscreen || undefined,
    class: `loading ${className}`,
    role: 'status',
    'aria-label': ariaLabel || text || 'Loading',
    'aria-live': 'polite',
    'aria-busy': 'true',
    children: [
      // Loading indicator
      jsx('div', {
        'data-loading-indicator': '',
        children: renderContent(),
      }),

      // Loading text
      text &&
        jsx('div', {
          'data-loading-text': '',
          children: text,
        }),

      // Screen reader only message
      !text &&
        jsx('span', {
          'data-loading-sr': '',
          style: {
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: '0',
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            borderWidth: '0',
          },
          children: ariaLabel || 'Loading',
        }),
    ],
  });

  // Wrap in overlay container if needed
  if (overlay || fullscreen) {
    return jsx('div', {
      'data-loading-overlay': '',
      'data-fullscreen': fullscreen || undefined,
      children: loadingElement,
    });
  }

  return loadingElement;
});

// Display name
Loading.displayName = 'Loading';
