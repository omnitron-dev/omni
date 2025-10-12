/**
 * Toast Primitive
 *
 * Display temporary notifications/messages to users.
 * Supports multiple toasts, auto-dismiss, actions, and accessibility.
 *
 * Based on WAI-ARIA alert pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/alert/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { effect } from '../core/reactivity/effect.js';
import { Portal } from '../control-flow/Portal.js';
import { jsx, Fragment } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ToastData {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ToastProps {
  /**
   * Toast data
   */
  toast: ToastData;

  /**
   * Callback when toast is dismissed
   */
  onDismiss?: (id: string) => void;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface ToastProviderProps {
  /**
   * Maximum number of visible toasts
   * @default 3
   */
  maxToasts?: number;

  /**
   * Default duration (ms) before auto-dismiss
   * @default 5000
   */
  duration?: number;

  /**
   * Children
   */
  children?: any;
}

export interface ToastViewportProps {
  /**
   * Hotkey to focus toasts
   * @default "F8"
   */
  hotkey?: string;

  /**
   * Viewport label for screen readers
   * @default "Notifications"
   */
  label?: string;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface ToastContextValue {
  toasts: () => ToastData[];
  addToast: (toast: Omit<ToastData, 'id'>) => string;
  removeToast: (id: string) => void;
  maxToasts: number;
  duration: number;
}

const noopGetter = () => [];
const noop = () => {};
const noopAdd = () => '';

export const ToastContext = createContext<ToastContextValue>(
  {
    toasts: noopGetter,
    addToast: noopAdd,
    removeToast: noop,
    maxToasts: 3,
    duration: 5000,
  },
  'Toast'
);

// ============================================================================
// Components
// ============================================================================

/**
 * Toast Provider
 *
 * Manages toast state and provides context.
 * Must wrap your app or the part where toasts are used.
 */
export const ToastProvider = defineComponent<ToastProviderProps>((props) => {
  const toasts: WritableSignal<ToastData[]> = signal<ToastData[]>([]);
  const maxToasts = props.maxToasts ?? 3;
  const duration = props.duration ?? 5000;

  const addToast = (toast: Omit<ToastData, 'id'>): string => {
    const id = generateId('toast');
    const newToast: ToastData = {
      ...toast,
      id,
      duration: toast.duration ?? duration,
    };

    // Add toast
    toasts.update((current) => {
      const updated = [...current, newToast];
      // Keep only maxToasts
      return updated.slice(-maxToasts);
    });

    // Auto-dismiss after duration
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, newToast.duration);
    }

    return id;
  };

  const removeToast = (id: string) => {
    toasts.update((current) => current.filter((t) => t.id !== id));
  };

  const contextValue: ToastContextValue = {
    toasts: () => toasts(),
    addToast,
    removeToast,
    maxToasts,
    duration,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(ToastContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    // Return children in a Fragment (no wrapper element)
    // Context is provided via provideContext, not Context.Provider
    return jsx(Fragment, { children });
  };
});

/**
 * Toast Viewport
 *
 * Container for rendering toasts.
 * Usually placed at the end of your app.
 *
 * Uses Pattern 18 - Reactive List Rendering for dynamic toast updates.
 */
export const ToastViewport = defineComponent<ToastViewportProps>((props) => {
  const ctx = useContext(ToastContext);

  const handleHotkey = (e: KeyboardEvent) => {
    const hotkey = props.hotkey || 'F8';
    if (e.key === hotkey) {
      e.preventDefault();
      // Focus first toast
      const firstToast = document.querySelector('[data-toast]') as HTMLElement;
      firstToast?.focus();
    }
  };

  // Register hotkey
  if (typeof window !== 'undefined') {
    document.addEventListener('keydown', handleHotkey);
  }

  return () => {
    // Extract props for reactivity
    const { label, hotkey, ...restProps } = props;
    const viewportLabel = label || 'Notifications';

    // Create container element
    const container = jsx('ol', {
      ...restProps,
      'data-toast-viewport': '',
      role: 'region',
      'aria-label': viewportLabel,
      tabIndex: -1,
    }) as HTMLOListElement;

    // Pattern 18: Reactive List Rendering
    // Effect reactively updates DOM when toast list changes
    effect(() => {
      const currentToasts = ctx.toasts(); // Track signal dependency

      // Clear container
      container.innerHTML = '';

      // Render each toast and append to container
      currentToasts.forEach((toast) => {
        // Use jsx to properly render toast component
        const toastElement = jsx(Toast, {
          toast,
          onDismiss: ctx.removeToast,
        });

        // Append to container
        container.appendChild(toastElement as Node);
      });
    });

    // Return container wrapped in Portal
    return jsx(Portal, { children: container });
  };
});

/**
 * Toast component
 *
 * Individual toast notification.
 */
export const Toast = defineComponent<ToastProps>((props) => {
  const { toast, onDismiss } = props;

  const handleDismiss = () => {
    onDismiss?.(toast.id);
  };

  return () =>
    jsx('li', {
      'data-toast': '',
      'data-variant': toast.variant || 'default',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      children: [
        toast.title &&
          jsx('div', {
            'data-toast-title': '',
            children: toast.title,
          }),
        toast.description &&
          jsx('div', {
            'data-toast-description': '',
            children: toast.description,
          }),
        toast.action &&
          jsx('button', {
            'data-toast-action': '',
            onClick: (e: Event) => {
              e.preventDefault();
              toast.action!.onClick();
              handleDismiss();
            },
            children: toast.action.label,
          }),
        jsx('button', {
          'data-toast-close': '',
          'aria-label': 'Close',
          onClick: handleDismiss,
          children: '×',
        }),
      ],
    });
});

/**
 * Hook to use toasts
 *
 * @example
 * ```tsx
 * const toastContext = useContext(ToastContext);
 *
 * const showToast = () => {
 *   toastContext.addToast({
 *     title: 'Success!',
 *     description: 'Your changes have been saved.',
 *     variant: 'success',
 *   });
 * };
 * ```
 */
