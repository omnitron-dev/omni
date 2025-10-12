/**
 * Alert Component
 *
 * A banner for displaying important messages, warnings, or notifications.
 *
 * @example
 * ```tsx
 * <Alert variant="warning">
 *   <Alert.Icon>
 *     <WarningIcon />
 *   </Alert.Icon>
 *   <Alert.Title>Warning</Alert.Title>
 *   <Alert.Description>
 *     This action cannot be undone.
 *   </Alert.Description>
 * </Alert>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface AlertProps {
  /**
   * Alert variant
   */
  variant?: 'default' | 'info' | 'success' | 'warning' | 'error';

  /**
   * ARIA role
   */
  role?: 'alert' | 'status';

  children?: any;
  [key: string]: any;
}

export interface AlertIconProps {
  children?: any;
  [key: string]: any;
}

export interface AlertTitleProps {
  /**
   * Heading level
   */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  children?: any;
  [key: string]: any;
}

export interface AlertDescriptionProps {
  children?: any;
  [key: string]: any;
}

/**
 * Alert Root
 *
 * Container for alert content.
 */
export const Alert = defineComponent<AlertProps>((props) => () => {
  const { variant = 'default', role = 'alert', children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    role,
    'data-alert': '',
    'data-variant': variant,
    children,
  });
});

/**
 * Alert Icon
 *
 * Icon for the alert (typically placed at the start).
 */
export const AlertIcon = defineComponent<AlertIconProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-alert-icon': '',
    'aria-hidden': 'true',
    children,
  });
});

/**
 * Alert Title
 *
 * Alert heading.
 */
export const AlertTitle = defineComponent<AlertTitleProps>((props) => () => {
  const { as = 'h5', children, ...restProps } = props;

  return jsx(as, {
    ...restProps,
    'data-alert-title': '',
    children,
  });
});

/**
 * Alert Description
 *
 * Alert description text.
 */
export const AlertDescription = defineComponent<AlertDescriptionProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-alert-description': '',
    children,
  });
});

// Attach sub-components
(Alert as any).Icon = AlertIcon;
(Alert as any).Title = AlertTitle;
(Alert as any).Description = AlertDescription;

// Display names
Alert.displayName = 'Alert';
AlertIcon.displayName = 'Alert.Icon';
AlertTitle.displayName = 'Alert.Title';
AlertDescription.displayName = 'Alert.Description';
