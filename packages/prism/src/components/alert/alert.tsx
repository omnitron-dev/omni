'use client';

/**
 * Alert Component
 *
 * Enhanced alert with custom styling and variants.
 *
 * @module @omnitron/prism/components/alert
 */

import type { ReactNode } from 'react';
import MuiAlert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Alert severity levels.
 */
export type AlertSeverity = 'success' | 'info' | 'warning' | 'error';

/**
 * Alert variants.
 */
export type AlertVariant = 'standard' | 'filled' | 'outlined' | 'soft';

/**
 * Props for Alert component.
 */
export interface AlertProps {
  /** Alert severity */
  severity?: AlertSeverity;
  /** Alert variant */
  variant?: AlertVariant;
  /** Alert title */
  title?: ReactNode;
  /** Alert content */
  children?: ReactNode;
  /** On close handler */
  onClose?: () => void;
  /** Show close button */
  closable?: boolean;
  /** Custom icon */
  icon?: ReactNode | false;
  /** Custom action */
  action?: ReactNode;
  /** Custom sx props */
  sx?: SxProps<Theme>;
}

/**
 * Alert - Enhanced alert with custom styling.
 *
 * @example
 * ```tsx
 * <Alert severity="success" title="Success!">
 *   Your changes have been saved.
 * </Alert>
 *
 * <Alert severity="error" variant="filled" closable onClose={() => {}}>
 *   An error occurred.
 * </Alert>
 * ```
 */
export function Alert({
  severity = 'info',
  variant = 'standard',
  title,
  children,
  onClose,
  closable = false,
  icon,
  action,
  sx,
}: AlertProps): ReactNode {
  // Map 'soft' variant to 'standard' with custom styling
  const muiVariant = variant === 'soft' ? 'standard' : variant;

  return (
    <MuiAlert
      severity={severity}
      variant={muiVariant}
      onClose={closable ? onClose : undefined}
      icon={icon}
      action={action}
      sx={{
        ...(variant === 'soft' && {
          backgroundColor: (theme) => alpha(theme.palette[severity].main, theme.palette.mode === 'light' ? 0.12 : 0.16),
          color: (theme) =>
            theme.palette.mode === 'light' ? theme.palette[severity].dark : theme.palette[severity].light,
          '& .MuiAlert-icon': {
            color: 'inherit',
          },
        }),
        ...sx,
      }}
    >
      {title && <AlertTitle>{title}</AlertTitle>}
      {children}
    </MuiAlert>
  );
}

/**
 * Props for InlineAlert component.
 */
export interface InlineAlertProps {
  /** Alert severity */
  severity?: AlertSeverity;
  /** Alert message */
  message: ReactNode;
  /** Icon to display */
  icon?: ReactNode;
}

/**
 * InlineAlert - Compact inline alert for form feedback.
 *
 * @example
 * ```tsx
 * <InlineAlert severity="error" message="This field is required" />
 * ```
 */
export function InlineAlert({ severity = 'info', message, icon }: InlineAlertProps): ReactNode {
  return (
    <MuiAlert
      severity={severity}
      icon={icon}
      sx={{
        py: 0,
        px: 1,
        '& .MuiAlert-message': {
          py: 0.5,
        },
      }}
    >
      {message}
    </MuiAlert>
  );
}
