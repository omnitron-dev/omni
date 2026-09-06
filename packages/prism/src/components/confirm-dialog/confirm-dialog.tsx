'use client';

/**
 * Confirm Dialog Component
 *
 * Reusable confirmation dialog with customizable actions.
 * Implements WCAG 2.1 accessibility with proper ARIA attributes.
 *
 * @module components/confirm-dialog
 */

import { useId, useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when dialog should close */
  onClose: () => void;
  /** Called when user confirms */
  onConfirm: () => void | Promise<void>;
  /** Dialog title */
  title?: string;
  /** Dialog content/message */
  content?: ReactNode;
  /** Confirm button text */
  confirmLabel?: string;
  /** Cancel button text */
  cancelLabel?: string;
  /** Confirm button color */
  confirmColor?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  /** Loading state for async confirm */
  loading?: boolean;
  /** Disable confirm button */
  disabled?: boolean;
  /** Maximum width of dialog */
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
  /** Additional styles for dialog */
  sx?: SxProps<Theme>;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * ConfirmDialog - Reusable confirmation dialog.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * <ConfirmDialog
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   onConfirm={handleDelete}
 *   title="Delete item?"
 *   content="This action cannot be undone."
 *   confirmColor="error"
 *   confirmLabel="Delete"
 * />
 * ```
 *
 * @example
 * ```tsx
 * // With async confirm
 * <ConfirmDialog
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   onConfirm={async () => {
 *     await deleteItem();
 *     setOpen(false);
 *   }}
 *   loading={isDeleting}
 *   title="Confirm deletion"
 * />
 * ```
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirm',
  content,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = 'primary',
  loading = false,
  disabled = false,
  maxWidth = 'xs',
  sx,
}: ConfirmDialogProps): ReactNode {
  const titleId = useId();
  const descriptionId = useId();

  // Re-entry guard for the destructive action.
  //
  // The only thing standing between a double-click and two deletions used to
  // be the caller's `loading` prop — and most callers don't thread one
  // through, because the dialog's own example doesn't. An impatient operator
  // clicking twice fired `onConfirm` twice.
  //
  // Tracked here rather than relying on the caller: this component knows when
  // the action it started is still running.
  const [confirming, setConfirming] = useState(false);
  const busy = loading || confirming;

  const handleConfirm = () => {
    if (busy) return;

    const result = onConfirm();
    if (!(result instanceof Promise)) return;

    setConfirming(true);
    result
      .catch(() => {
        // The parent owns error reporting; the dialog only owns the button
        // state. Swallowing here prevents an unhandled rejection, and the
        // `finally` below makes sure a failure leaves the operator able to
        // retry instead of stuck behind a spinner.
      })
      .finally(() => setConfirming(false));
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth={maxWidth}
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={content ? descriptionId : undefined}
      sx={sx}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>

      {content && (
        <DialogContent>
          {typeof content === 'string' ? (
            <DialogContentText id={descriptionId}>{content}</DialogContentText>
          ) : (
            <div id={descriptionId}>{content}</div>
          )}
        </DialogContent>
      )}

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy} variant="outlined">
          {cancelLabel}
        </Button>

        <Button onClick={handleConfirm} color={confirmColor} variant="contained" loading={busy} disabled={disabled}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// DELETE DIALOG
// =============================================================================

export interface DeleteDialogProps extends Omit<ConfirmDialogProps, 'title' | 'confirmLabel' | 'confirmColor'> {
  /** Name of the item being deleted */
  itemName?: string;
}

/**
 * DeleteDialog - Specialized confirmation for delete actions.
 *
 * @example
 * ```tsx
 * <DeleteDialog
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   onConfirm={handleDelete}
 *   itemName="Project Alpha"
 * />
 * ```
 */
export function DeleteDialog({ itemName, content, ...props }: DeleteDialogProps): ReactNode {
  return (
    <ConfirmDialog
      title={itemName ? `Delete "${itemName}"?` : 'Delete item?'}
      content={content ?? 'This action cannot be undone. Are you sure you want to proceed?'}
      confirmLabel="Delete"
      confirmColor="error"
      {...props}
    />
  );
}
