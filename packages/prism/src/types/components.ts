/**
 * Component Type Definitions
 *
 * @module @omnitron/prism/types/components
 */

import type { VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

/**
 * Component size variants.
 */
export type ComponentSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Component color variants.
 */
export type ComponentColor = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';

/**
 * Button variants.
 */
export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';

/**
 * Base props for polymorphic components.
 */
export type PolymorphicComponentProps<C extends ElementType, Props = object> = Props &
  Omit<ComponentPropsWithoutRef<C>, keyof Props> & {
    as?: C;
  };

/**
 * Slot props for component customization.
 */
export interface SlotProps<T = object> {
  /** Custom slot content */
  slotProps?: {
    root?: T;
    [key: string]: T | undefined;
  };
}

/**
 * Common component props.
 */
export interface CommonComponentProps {
  /** Additional CSS classes */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Component children */
  children?: ReactNode;
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
}

/**
 * Props for components with icon support.
 */
export interface WithIconProps {
  /** Icon at start */
  startIcon?: ReactNode;
  /** Icon at end */
  endIcon?: ReactNode;
  /** Icon only (no text) */
  iconOnly?: boolean;
}

/**
 * Props for form field components.
 */
export interface FormFieldProps {
  /** Field name for form registration */
  name: string;
  /** Field label */
  label?: ReactNode;
  /** Helper text */
  helperText?: ReactNode;
  /** Required field */
  required?: boolean;
  /** Error state */
  error?: boolean;
  /** Error message */
  errorMessage?: string;
  /** Full width */
  fullWidth?: boolean;
}

/**
 * Props for input components.
 */
export interface InputProps extends FormFieldProps {
  /** Placeholder text */
  placeholder?: string;
  /** Input type */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
  /** Auto-focus */
  autoFocus?: boolean;
  /** Auto-complete */
  autoComplete?: string;
  /** Read-only */
  readOnly?: boolean;
}

/**
 * Props for select/dropdown components.
 */
export interface SelectOption<T = string> {
  /** Option value */
  value: T;
  /** Display label */
  label: string;
  /** Disabled option */
  disabled?: boolean;
  /** Group name for grouped options */
  group?: string;
  /** Optional icon */
  icon?: ReactNode;
}

/**
 * Props for data display components.
 */
export interface DataDisplayProps<T = unknown> {
  /** Data to display */
  data: T;
  /** Loading state */
  loading?: boolean;
  /** Error state */
  error?: Error | null;
  /** Empty state message */
  emptyMessage?: string;
}

/**
 * Props for layout components.
 */
export interface LayoutProps {
  /** Gap between items */
  gap?: number | string;
  /** Padding */
  padding?: number | string;
  /** Max width */
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
}

/**
 * Extract variant props from cva definition.
 */
export type ExtractVariantProps<T extends (...args: unknown[]) => unknown> = VariantProps<T>;
