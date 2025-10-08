/**
 * Spinner - Loading spinner component
 *
 * Features:
 * - Multiple sizes (xs, sm, md, lg, xl)
 * - Color variants
 * - Label support for accessibility
 * - Customizable speed
 * - Multiple spinner styles (circular, dots, bars)
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerVariant = 'circular' | 'dots' | 'bars';

export interface SpinnerProps {
  /** Size of the spinner */
  size?: SpinnerSize;
  /** Visual variant */
  variant?: SpinnerVariant;
  /** Loading label (for screen readers) */
  label?: string;
  /** Animation speed */
  speed?: 'slow' | 'normal' | 'fast';
  /** Whether to show the label visibly */
  showLabel?: boolean;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Spinner
// ============================================================================

export const Spinner = defineComponent<SpinnerProps>((props) => () => {
    const {
      size = 'md',
      variant = 'circular',
      label = 'Loading...',
      speed = 'normal',
      showLabel = false,
      ...rest
    } = props;

    return jsx('div', {
      'data-spinner': '',
      'data-size': size,
      'data-variant': variant,
      'data-speed': speed,
      role: 'status',
      'aria-label': label,
      'aria-live': 'polite',
      'aria-busy': 'true',
      ...rest,
      children: [
        // Circular spinner
        variant === 'circular' &&
          jsx('svg', {
            'data-spinner-svg': '',
            viewBox: '0 0 50 50',
            children: jsx('circle', {
              'data-spinner-circle': '',
              cx: '25',
              cy: '25',
              r: '20',
              fill: 'none',
              strokeWidth: '4',
            }),
          }),

        // Dots spinner
        variant === 'dots' &&
          jsx('div', {
            'data-spinner-dots': '',
            children: [
              jsx('div', { 'data-spinner-dot': '' }),
              jsx('div', { 'data-spinner-dot': '' }),
              jsx('div', { 'data-spinner-dot': '' }),
            ],
          }),

        // Bars spinner
        variant === 'bars' &&
          jsx('div', {
            'data-spinner-bars': '',
            children: [
              jsx('div', { 'data-spinner-bar': '' }),
              jsx('div', { 'data-spinner-bar': '' }),
              jsx('div', { 'data-spinner-bar': '' }),
              jsx('div', { 'data-spinner-bar': '' }),
            ],
          }),

        // Label
        showLabel &&
          jsx('span', {
            'data-spinner-label': '',
            children: label,
          }),

        // Screen reader only label
        !showLabel &&
          jsx('span', {
            'data-spinner-label-sr': '',
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
            children: label,
          }),
      ],
    });
  });
