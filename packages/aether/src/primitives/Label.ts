/**
 * Label Component
 *
 * A label component for associating text with form controls.
 * Provides proper ARIA associations and click-to-focus behavior.
 *
 * @example
 * ```tsx
 * <Label for="email">Email</Label>
 * <input id="email" type="email" />
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface LabelProps {
  /**
   * The ID of the form control this label is associated with
   */
  for?: string;

  /**
   * Children content
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

/**
 * Label
 *
 * Associates a text label with a form control.
 *
 * Features:
 * - Automatic click-to-focus behavior
 * - ARIA associations via `for` attribute
 * - Works with any form control
 */
export const Label = defineComponent<LabelProps>((props) => () => {
    const { for: htmlFor, children, ...restProps } = props;

    return jsx('label', {
      ...restProps,
      htmlFor,
      'data-label': '',
      children,
    });
  });

// Attach sub-components for dot notation
Label.displayName = 'Label';
