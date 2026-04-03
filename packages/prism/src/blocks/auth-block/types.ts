/**
 * Auth Block Types
 *
 * Type definitions for authentication-related block components.
 *
 * @module @omnitron-dev/prism/blocks/auth-block
 */

import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import type { BoxProps } from '@mui/material/Box';
import type { ButtonProps } from '@mui/material/Button';
import type { TextFieldProps } from '@mui/material/TextField';
import type { z } from 'zod';

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Base props for all auth forms
 */
export interface AuthFormBaseProps {
  /** Called when form is submitted successfully */
  onSubmit: (data: Record<string, unknown>) => Promise<void> | void;
  /** Form loading state */
  loading?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Custom styling */
  sx?: SxProps<Theme>;
  /** Slot props for nested components */
  slotProps?: {
    /** Wrapper props */
    wrapper?: Partial<BoxProps>;
    /** Submit button props */
    submitButton?: Partial<ButtonProps>;
    /** Text field props */
    textField?: Partial<TextFieldProps>;
  };
}

// =============================================================================
// LOGIN FORM
// =============================================================================

/**
 * Login form field names
 */
export type LoginFormFields = 'email' | 'password';

/**
 * Login form data
 */
export interface LoginFormData {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * Props for LoginForm component
 */
export interface LoginFormProps extends Omit<AuthFormBaseProps, 'onSubmit'> {
  /** Called when form is submitted */
  onSubmit: (data: LoginFormData) => Promise<void> | void;
  /** Show "Remember me" checkbox */
  showRememberMe?: boolean;
  /** Show "Forgot password" link */
  showForgotPassword?: boolean;
  /** Forgot password link handler */
  onForgotPassword?: () => void;
  /** Show social login buttons */
  showSocialLogin?: boolean;
  /** Social login options */
  socialProviders?: Array<{
    id: string;
    name: string;
    icon: ReactNode;
    onClick: () => void;
  }>;
  /** Custom validation schema */
  schema?: z.ZodSchema<LoginFormData>;
  /** Labels customization */
  labels?: {
    email?: string;
    password?: string;
    rememberMe?: string;
    forgotPassword?: string;
    submit?: string;
    socialDivider?: string;
  };
}

// =============================================================================
// REGISTER FORM
// =============================================================================

/**
 * Register form data
 */
export interface RegisterFormData {
  email: string;
  password: string;
  confirmPassword: string;
  firstName?: string;
  lastName?: string;
  acceptTerms?: boolean;
}

/**
 * Props for RegisterForm component
 */
export interface RegisterFormProps extends Omit<AuthFormBaseProps, 'onSubmit'> {
  /** Called when form is submitted */
  onSubmit: (data: RegisterFormData) => Promise<void> | void;
  /** Show name fields */
  showNameFields?: boolean;
  /** Require terms acceptance */
  requireTerms?: boolean;
  /** Terms link handler */
  onTermsClick?: () => void;
  /** Privacy policy link handler */
  onPrivacyClick?: () => void;
  /** Minimum password length */
  minPasswordLength?: number;
  /** Custom validation schema */
  schema?: z.ZodSchema<RegisterFormData>;
  /** Labels customization */
  labels?: {
    email?: string;
    password?: string;
    confirmPassword?: string;
    firstName?: string;
    lastName?: string;
    acceptTerms?: string;
    termsLink?: string;
    privacyLink?: string;
    submit?: string;
  };
}

// =============================================================================
// FORGOT PASSWORD FORM
// =============================================================================

/**
 * Forgot password form data
 */
export interface ForgotPasswordFormData {
  email: string;
}

/**
 * Props for ForgotPasswordForm component
 */
export interface ForgotPasswordFormProps extends Omit<AuthFormBaseProps, 'onSubmit'> {
  /** Called when form is submitted */
  onSubmit: (data: ForgotPasswordFormData) => Promise<void> | void;
  /** Back to login handler */
  onBackToLogin?: () => void;
  /** Custom validation schema */
  schema?: z.ZodSchema<ForgotPasswordFormData>;
  /** Labels customization */
  labels?: {
    title?: string;
    description?: string;
    email?: string;
    submit?: string;
    backToLogin?: string;
  };
}

// =============================================================================
// RESET PASSWORD FORM
// =============================================================================

/**
 * Reset password form data
 */
export interface ResetPasswordFormData {
  password: string;
  confirmPassword: string;
}

/**
 * Props for ResetPasswordForm component
 */
export interface ResetPasswordFormProps extends Omit<AuthFormBaseProps, 'onSubmit'> {
  /** Called when form is submitted */
  onSubmit: (data: ResetPasswordFormData) => Promise<void> | void;
  /** Minimum password length */
  minPasswordLength?: number;
  /** Custom validation schema */
  schema?: z.ZodSchema<ResetPasswordFormData>;
  /** Labels customization */
  labels?: {
    title?: string;
    description?: string;
    password?: string;
    confirmPassword?: string;
    submit?: string;
  };
}

// =============================================================================
// VERIFY CODE FORM
// =============================================================================

/**
 * Verify code form data
 */
export interface VerifyCodeFormData {
  code: string;
}

/**
 * Props for VerifyCodeForm component
 */
export interface VerifyCodeFormProps extends Omit<AuthFormBaseProps, 'onSubmit'> {
  /** Called when form is submitted */
  onSubmit: (data: VerifyCodeFormData) => Promise<void> | void;
  /** Code length (default: 6) */
  codeLength?: number;
  /** Resend code handler */
  onResendCode?: () => void;
  /** Resend cooldown in seconds */
  resendCooldown?: number;
  /** Custom validation schema */
  schema?: z.ZodSchema<VerifyCodeFormData>;
  /** Labels customization */
  labels?: {
    title?: string;
    description?: string;
    resendCode?: string;
    resendIn?: string;
    submit?: string;
  };
}

// =============================================================================
// AUTH BLOCK COMPOUND
// =============================================================================

/**
 * Auth block variant
 */
export type AuthBlockVariant = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-code';

/**
 * Props for AuthBlock component (compound)
 */
export interface AuthBlockProps {
  /** Block variant */
  variant: AuthBlockVariant;
  /** Header content (logo, title) */
  header?: ReactNode;
  /** Footer content (links, additional info) */
  footer?: ReactNode;
  /** Form props based on variant */
  formProps:
    | (LoginFormProps & { variant: 'login' })
    | (RegisterFormProps & { variant: 'register' })
    | (ForgotPasswordFormProps & { variant: 'forgot-password' })
    | (ResetPasswordFormProps & { variant: 'reset-password' })
    | (VerifyCodeFormProps & { variant: 'verify-code' });
  /** Custom styling */
  sx?: SxProps<Theme>;
}
