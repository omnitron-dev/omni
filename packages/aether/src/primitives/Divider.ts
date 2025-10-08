/**
 * Divider - Visual separator with label support
 *
 * Features:
 * - Horizontal and vertical dividers
 * - Label/text support (positioned start/center/end)
 * - Dashed, solid, or dotted styles
 * - Configurable thickness and color
 * - Semantic HTML with proper ARIA
 * - Enhanced version of Separator
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type DividerOrientation = 'horizontal' | 'vertical';
export type DividerVariant = 'solid' | 'dashed' | 'dotted';
export type DividerLabelPosition = 'start' | 'center' | 'end';

export interface DividerProps {
  /** Orientation (default: 'horizontal') */
  orientation?: DividerOrientation;
  /** Label/text to display */
  label?: string;
  /** Label children (alternative to label prop) */
  children?: any;
  /** Label position (default: 'center') */
  labelPosition?: DividerLabelPosition;
  /** Border style (default: 'solid') */
  variant?: DividerVariant;
  /** Thickness in pixels (default: 1) */
  thickness?: number;
  /** Color (CSS color value) */
  color?: string;
  /** Spacing around label (default: 16) */
  labelSpacing?: number;
  /** Decorative only (no semantic meaning) */
  decorative?: boolean;
  /** Additional CSS class */
  class?: string;
  /** Inline styles */
  style?: Record<string, any>;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Divider Component
// ============================================================================

/**
 * Divider creates a visual separator with optional label support.
 * Enhanced version of Separator with more features.
 *
 * @example
 * ```tsx
 * // Basic horizontal divider
 * <Divider />
 *
 * // Divider with centered label
 * <Divider label="OR" />
 * <Divider>OR</Divider>
 *
 * // Divider with label positioned
 * <Divider label="Section Title" labelPosition="start" />
 *
 * // Dashed divider
 * <Divider variant="dashed" color="#e0e0e0" />
 *
 * // Vertical divider
 * <Divider orientation="vertical" />
 *
 * // Thick divider with custom color
 * <Divider thickness={2} color="#2196f3" />
 * ```
 */
export const Divider = defineComponent<DividerProps>((props) => () => {
    const orientation = props.orientation ?? 'horizontal';
    const variant = props.variant ?? 'solid';
    const thickness = props.thickness ?? 1;
    const labelPosition = props.labelPosition ?? 'center';
    const labelSpacing = props.labelSpacing ?? 16;
    const isHorizontal = orientation === 'horizontal';
    const hasLabel = !!(props.label || props.children);

    const {
      orientation: _orientation,
      label,
      children,
      labelPosition: _labelPosition,
      variant: _variant,
      thickness: _thickness,
      color,
      labelSpacing: _labelSpacing,
      decorative,
      class: className,
      style,
      ...restProps
    } = props;

    // Without label - simple line
    if (!hasLabel) {
      const lineStyles: Record<string, any> = {
        border: 'none',
        ...(isHorizontal
          ? {
              borderTopWidth: `${thickness}px`,
              borderTopStyle: variant,
              ...(color && { borderTopColor: color }),
              width: '100%',
              height: '0',
            }
          : {
              borderLeftWidth: `${thickness}px`,
              borderLeftStyle: variant,
              ...(color && { borderLeftColor: color }),
              height: '100%',
              width: '0',
            }),
        ...style,
      };

      return jsx('hr', {
        role: decorative ? 'presentation' : 'separator',
        'aria-orientation': orientation,
        class: className,
        style: lineStyles,
        ...restProps,
      });
    }

    // With label - flex container with lines and label
    const containerStyles: Record<string, any> = {
      display: 'flex',
      alignItems: 'center',
      ...(isHorizontal
        ? {
            flexDirection: 'row',
            width: '100%',
          }
        : {
            flexDirection: 'column',
            height: '100%',
          }),
      ...style,
    };

    const lineStyles: Record<string, any> = {
      border: 'none',
      ...(isHorizontal
        ? {
            borderTopWidth: `${thickness}px`,
            borderTopStyle: variant,
            ...(color && { borderTopColor: color }),
            height: '0',
          }
        : {
            borderLeftWidth: `${thickness}px`,
            borderLeftStyle: variant,
            ...(color && { borderLeftColor: color }),
            width: '0',
          }),
    };

    const labelStyles: Record<string, any> = {
      flexShrink: 0,
      ...(isHorizontal
        ? {
            paddingLeft: `${labelSpacing}px`,
            paddingRight: `${labelSpacing}px`,
          }
        : {
            paddingTop: `${labelSpacing}px`,
            paddingBottom: `${labelSpacing}px`,
          }),
    };

    // Determine flex values for lines based on label position
    const startLineFlex =
      labelPosition === 'start' ? '0 0 auto' : labelPosition === 'center' ? '1 1 0%' : '1 1 0%';
    const endLineFlex = labelPosition === 'end' ? '0 0 auto' : labelPosition === 'center' ? '1 1 0%' : '1 1 0%';

    const dividerChildren = [];

    // Start line
    if (labelPosition !== 'start') {
      dividerChildren.push(
        jsx('hr', {
          key: 'line-start',
          style: { ...lineStyles, flex: startLineFlex },
          'aria-hidden': 'true',
        }),
      );
    }

    // Label
    dividerChildren.push(
      jsx(
        'span',
        {
          key: 'label',
          style: labelStyles,
        },
        label ?? children,
      ),
    );

    // End line
    if (labelPosition !== 'end') {
      dividerChildren.push(
        jsx('hr', {
          key: 'line-end',
          style: { ...lineStyles, flex: endLineFlex },
          'aria-hidden': 'true',
        }),
      );
    }

    return jsx('div', {
      role: decorative ? 'presentation' : 'separator',
      'aria-orientation': orientation,
      'aria-label': typeof label === 'string' ? label : undefined,
      class: className,
      style: containerStyles,
      ...restProps,
      children: dividerChildren,
    });
  });
