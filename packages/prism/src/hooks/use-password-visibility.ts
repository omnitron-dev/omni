'use client';

/**
 * usePasswordVisibility Hook
 *
 * Manages password field visibility toggle state.
 * Commonly used in login, register, and password reset forms.
 *
 * @module @omnitron-dev/prism/hooks/use-password-visibility
 */

import { useCallback, useState, useMemo } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Return type for usePasswordVisibility hook.
 */
export interface UsePasswordVisibilityReturn {
  /** Whether password is visible (text) or hidden (password) */
  visible: boolean;
  /** Toggle visibility */
  toggle: () => void;
  /** Show password */
  show: () => void;
  /** Hide password */
  hide: () => void;
  /** Input type based on visibility ('text' | 'password') */
  type: 'text' | 'password';
}

/**
 * Options for usePasswordVisibility hook.
 */
export interface UsePasswordVisibilityOptions {
  /** Initial visibility state (default: false) */
  initialVisible?: boolean;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * usePasswordVisibility - Manage password field visibility toggle.
 *
 * Returns state and handlers for password visibility toggle,
 * commonly used with InputAdornment in MUI TextField.
 *
 * @example
 * ```tsx
 * function LoginForm() {
 *   const password = usePasswordVisibility();
 *
 *   return (
 *     <TextField
 *       type={password.type}
 *       InputProps={{
 *         endAdornment: (
 *           <InputAdornment position="end">
 *             <IconButton onClick={password.toggle}>
 *               {password.visible ? <VisibilityOff /> : <Visibility />}
 *             </IconButton>
 *           </InputAdornment>
 *         ),
 *       }}
 *     />
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With confirm password field
 * function RegisterForm() {
 *   const password = usePasswordVisibility();
 *   const confirmPassword = usePasswordVisibility();
 *
 *   return (
 *     <Box>
 *       <TextField
 *         label="Password"
 *         type={password.type}
 *         InputProps={{ endAdornment: <PasswordToggle {...password} /> }}
 *       />
 *       <TextField
 *         label="Confirm Password"
 *         type={confirmPassword.type}
 *         InputProps={{ endAdornment: <PasswordToggle {...confirmPassword} /> }}
 *       />
 *     </Box>
 *   );
 * }
 * ```
 *
 * @param options - Hook options
 * @returns Visibility state, toggle handlers, and input type
 */
export function usePasswordVisibility(options: UsePasswordVisibilityOptions = {}): UsePasswordVisibilityReturn {
  const { initialVisible = false } = options;

  const [visible, setVisible] = useState(initialVisible);

  const toggle = useCallback(() => {
    setVisible((prev) => !prev);
  }, []);

  const show = useCallback(() => {
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(
    () => ({
      visible,
      toggle,
      show,
      hide,
      type: visible ? 'text' : 'password',
    }),
    [visible, toggle, show, hide]
  );
}
