'use client';

/**
 * Alert Component
 *
 * Enhanced alert with custom styling and variants.
 *
 * @module @omnitron-dev/prism/components/alert
 */

import { useEffect, useRef, type ReactNode } from 'react';
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

/**
 * Props for FormAlert component.
 */
export interface FormAlertProps {
  /** Severity — defaults to 'error' since this primitive is most
   * commonly used to surface form submission failures. */
  severity?: AlertSeverity;
  /** Optional heading rendered above the message. Use for a short
   * categorisation ("Couldn't save") when the message body is a
   * detailed reason. */
  title?: ReactNode;
  /** The alert body. Pass `null` to keep the slot rendered but
   * empty — useful for conditional rendering without unmounting. */
  children?: ReactNode;
  /** Renders a close (x) icon button when provided. Should clear the
   * underlying error state in the parent. */
  onClose?: () => void;
  /** When true, scroll the alert into view on mount so the user
   * sees it even if the dialog content has been scrolled away from
   * the top. Default: true. */
  autoScroll?: boolean;
  /** Custom sx overrides for niche layouts. */
  sx?: SxProps<Theme>;
}

/**
 * FormAlert — the platform's canonical surface for **form-level**
 * errors inside dialogs and inline forms.
 *
 * UX policy (see CLAUDE.md "Error UX"):
 *
 *   Form submission failure → `<FormAlert>` at the top of the form
 *   Background / cross-cutting event → `toast`
 *
 * Why a dedicated primitive vs. plain `<Alert>`:
 *
 *   - `role="alert"` + `aria-live="assertive"` so screen readers
 *     immediately announce the message, not just visually-sighted
 *     users.
 *   - Auto-scrolls into view on mount — a form often has fields
 *     below the fold; surfacing an error you can't see is a dark
 *     pattern. (Disable with `autoScroll={false}` if your dialog
 *     manages focus differently.)
 *   - Sensible defaults: `severity='error'`, top margin baked in so
 *     it sits naturally above the first field, `flex-start`
 *     alignment so multi-line messages don't push the close button
 *     out of place.
 *
 * @example
 * ```tsx
 * const [error, setError] = useState<string | null>(null);
 *
 * <DialogContent>
 *   {error && <FormAlert onClose={() => setError(null)}>{error}</FormAlert>}
 *   <TextField ... />
 * </DialogContent>
 * ```
 */
export function FormAlert({
  severity = 'error',
  title,
  children,
  onClose,
  autoScroll = true,
  sx,
}: FormAlertProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll) return;
    // Schedule after paint so we measure the alert in its final
    // position. `nearest` keeps the dialog stable instead of
    // jumping to the very top, which would feel jarring if the
    // alert is already visible.
    const id = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [autoScroll]);

  return (
    <MuiAlert
      ref={ref}
      severity={severity}
      onClose={onClose}
      // role/aria-live are normally set by MUI based on severity, but
      // form-level surfacing of submission errors warrants assertive
      // announcement regardless of severity. aria-atomic ensures the
      // whole alert is read together (title + body), not piecewise.
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      sx={{
        alignItems: 'flex-start',
        mb: 2,
        ...sx,
      }}
    >
      {title && <AlertTitle sx={{ mb: 0.5 }}>{title}</AlertTitle>}
      {children}
    </MuiAlert>
  );
}
