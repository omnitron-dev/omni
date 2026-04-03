'use client';

/**
 * Snackbar Component
 *
 * Enhanced snackbar with context-based API for easy notifications.
 *
 * @module @omnitron-dev/prism/components/snackbar
 */

import type { ReactNode } from 'react';
import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import type { AlertColor } from '@mui/material/Alert';
import type { SnackbarOrigin } from '@mui/material/Snackbar';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface SnackbarOptions {
  /** Message to display */
  message: string;
  /** Severity/type of the snackbar */
  severity?: AlertColor;
  /** Auto-hide duration in milliseconds */
  duration?: number;
  /** Position on screen */
  position?: SnackbarOrigin;
  /** Action button */
  action?: ReactNode;
  /** Unique key for the snackbar */
  key?: string | number;
}

export interface SnackbarContextValue {
  /** Show a snackbar notification */
  show: (options: SnackbarOptions | string) => void;
  /** Show a success notification */
  success: (message: string, options?: Partial<SnackbarOptions>) => void;
  /** Show an error notification */
  error: (message: string, options?: Partial<SnackbarOptions>) => void;
  /** Show a warning notification */
  warning: (message: string, options?: Partial<SnackbarOptions>) => void;
  /** Show an info notification */
  info: (message: string, options?: Partial<SnackbarOptions>) => void;
  /** Close the current snackbar */
  close: () => void;
}

export interface SnackbarProviderProps {
  /** Children to wrap */
  children: ReactNode;
  /** Default auto-hide duration */
  defaultDuration?: number;
  /** Default position */
  defaultPosition?: SnackbarOrigin;
  /** Maximum number of snackbars to show */
  maxSnackbars?: number;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

// =============================================================================
// HOOK
// =============================================================================

/**
 * useSnackbar - Hook for showing snackbar notifications.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const snackbar = useSnackbar();
 *
 *   const handleSave = async () => {
 *     try {
 *       await saveData();
 *       snackbar.success('Data saved successfully!');
 *     } catch (err) {
 *       snackbar.error('Failed to save data');
 *     }
 *   };
 * }
 * ```
 */
export function useSnackbar(): SnackbarContextValue {
  const context = useContext(SnackbarContext);

  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }

  return context;
}

// =============================================================================
// PROVIDER
// =============================================================================

interface SnackbarState {
  open: boolean;
  message: string;
  severity: AlertColor;
  duration: number;
  position: SnackbarOrigin;
  action?: ReactNode;
  key: string | number;
}

const defaultState: SnackbarState = {
  open: false,
  message: '',
  severity: 'info',
  duration: 5000,
  position: { vertical: 'bottom', horizontal: 'left' },
  key: 0,
};

/**
 * SnackbarProvider - Provider for snackbar notifications.
 *
 * @example
 * ```tsx
 * // Wrap your app with the provider
 * function App() {
 *   return (
 *     <SnackbarProvider>
 *       <MyApp />
 *     </SnackbarProvider>
 *   );
 * }
 * ```
 */
export function SnackbarProvider({
  children,
  defaultDuration = 5000,
  defaultPosition = { vertical: 'bottom', horizontal: 'left' },
  sx,
}: SnackbarProviderProps): ReactNode {
  const [state, setState] = useState<SnackbarState>({
    ...defaultState,
    duration: defaultDuration,
    position: defaultPosition,
  });

  const show = useCallback(
    (options: SnackbarOptions | string) => {
      const opts = typeof options === 'string' ? { message: options } : options;

      setState((prev) => ({
        open: true,
        message: opts.message,
        severity: opts.severity ?? 'info',
        duration: opts.duration ?? defaultDuration,
        position: opts.position ?? defaultPosition,
        action: opts.action,
        key: opts.key ?? Date.now(),
      }));
    },
    [defaultDuration, defaultPosition]
  );

  const success = useCallback(
    (message: string, options?: Partial<SnackbarOptions>) => {
      show({ message, severity: 'success', ...options });
    },
    [show]
  );

  const error = useCallback(
    (message: string, options?: Partial<SnackbarOptions>) => {
      show({ message, severity: 'error', ...options });
    },
    [show]
  );

  const warning = useCallback(
    (message: string, options?: Partial<SnackbarOptions>) => {
      show({ message, severity: 'warning', ...options });
    },
    [show]
  );

  const info = useCallback(
    (message: string, options?: Partial<SnackbarOptions>) => {
      show({ message, severity: 'info', ...options });
    },
    [show]
  );

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  const handleClose = useCallback(
    (_event?: React.SyntheticEvent | Event, reason?: string) => {
      if (reason === 'clickaway') return;
      close();
    },
    [close]
  );

  const value = useMemo<SnackbarContextValue>(
    () => ({
      show,
      success,
      error,
      warning,
      info,
      close,
    }),
    [show, success, error, warning, info, close]
  );

  return (
    <SnackbarContext.Provider value={value}>
      {children}

      <Snackbar
        key={state.key}
        open={state.open}
        autoHideDuration={state.duration}
        onClose={handleClose}
        anchorOrigin={state.position}
        sx={sx}
      >
        <Alert
          severity={state.severity}
          variant="filled"
          onClose={handleClose}
          action={
            state.action || (
              <IconButton size="small" aria-label="close" color="inherit" onClick={close}>
                <CloseIcon fontSize="small" />
              </IconButton>
            )
          }
          sx={{ width: '100%', alignItems: 'center' }}
        >
          {state.message}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

// =============================================================================
// STANDALONE SNACKBAR
// =============================================================================

export interface SimpleSnackbarProps {
  /** Whether the snackbar is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Message to display */
  message: string;
  /** Severity/type */
  severity?: AlertColor;
  /** Auto-hide duration in milliseconds */
  duration?: number;
  /** Position on screen */
  position?: SnackbarOrigin;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

/**
 * SimpleSnackbar - Standalone snackbar component (without context).
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * <SimpleSnackbar
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   message="Changes saved!"
 *   severity="success"
 * />
 * ```
 */
export function SimpleSnackbar({
  open,
  onClose,
  message,
  severity = 'info',
  duration = 5000,
  position = { vertical: 'bottom', horizontal: 'left' },
  sx,
}: SimpleSnackbarProps): ReactNode {
  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    onClose();
  };

  return (
    <Snackbar open={open} autoHideDuration={duration} onClose={handleClose} anchorOrigin={position} sx={sx}>
      <Alert severity={severity} variant="filled" onClose={handleClose} sx={{ width: '100%' }}>
        {message}
      </Alert>
    </Snackbar>
  );
}
