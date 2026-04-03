'use client';

/**
 * Auth Block Component
 *
 * Reusable authentication forms: login, register, forgot password, etc.
 * Integrates with React Hook Form and Zod for validation.
 *
 * @module @omnitron-dev/prism/blocks/auth-block
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useForm, FormProvider, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import { Field } from '../../components/field/index.js';
import type {
  LoginFormProps,
  LoginFormData,
  RegisterFormProps,
  RegisterFormData,
  ForgotPasswordFormProps,
  ForgotPasswordFormData,
  ResetPasswordFormProps,
  ResetPasswordFormData,
  VerifyCodeFormProps,
  VerifyCodeFormData,
} from './types.js';

// =============================================================================
// ICONS (inline SVG to avoid dependencies)
// =============================================================================

function EyeIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// =============================================================================
// ERROR SANITIZATION
// =============================================================================

/**
 * Patterns that indicate a server-internal error message that should not
 * be shown to the user (e.g., stack traces, connection strings, file paths).
 */
const UNSAFE_ERROR_PATTERNS = [
  /at\s+\w+\s*\(/i, // stack trace frames
  /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b/, // Node.js system errors
  /\b(SELECT|INSERT|UPDATE|DELETE)\b.*\bFROM\b/i, // SQL fragments
  /\/[a-z_-]+\/[a-z_-]+\//i, // Unix file paths
  /[A-Z]:\\[^\s]+/, // Windows file paths
  /password|secret|token|key/i, // sensitive keywords in error context
];

const DEFAULT_AUTH_ERROR = 'An error occurred. Please try again.';

/**
 * Sanitize error messages to prevent information disclosure.
 * Passes through safe, user-facing messages while replacing
 * server-internal details with a generic fallback.
 */
function sanitizeErrorMessage(err: unknown, fallback: string = DEFAULT_AUTH_ERROR): string {
  if (!(err instanceof Error)) return fallback;

  const message = err.message;

  // Reject messages that look like internal server errors
  for (const pattern of UNSAFE_ERROR_PATTERNS) {
    if (pattern.test(message)) return fallback;
  }

  // Reject overly long messages (likely stack traces or debug info)
  if (message.length > 200) return fallback;

  return message;
}

// =============================================================================
// DEFAULT SCHEMAS
// =============================================================================

const defaultLoginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

const createRegisterSchema = (minPasswordLength: number = 8, requireTerms: boolean = true) =>
  z
    .object({
      email: z.string().email('Please enter a valid email'),
      password: z.string().min(minPasswordLength, `Password must be at least ${minPasswordLength} characters`),
      confirmPassword: z.string(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      acceptTerms: requireTerms
        ? z.boolean().refine((val) => val === true, { message: 'You must accept the terms' })
        : z.boolean().optional(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    });

const defaultForgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});

const createResetPasswordSchema = (minPasswordLength: number = 8) =>
  z
    .object({
      password: z.string().min(minPasswordLength, `Password must be at least ${minPasswordLength} characters`),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    });

const createVerifyCodeSchema = (codeLength: number = 6) =>
  z.object({
    code: z.string().length(codeLength, `Code must be ${codeLength} digits`),
  });

// =============================================================================
// LOGIN FORM
// =============================================================================

/**
 * Login form component with email/password authentication.
 *
 * @example
 * ```tsx
 * <LoginForm
 *   onSubmit={async (data) => {
 *     await signIn(data.email, data.password);
 *   }}
 *   showRememberMe
 *   showForgotPassword
 *   onForgotPassword={() => navigate('/forgot-password')}
 * />
 * ```
 */
export function LoginForm({
  onSubmit,
  loading = false,
  disabled = false,
  showRememberMe = true,
  showForgotPassword = true,
  onForgotPassword,
  showSocialLogin = false,
  socialProviders = [],
  schema,
  labels = {},
  sx,
  slotProps,
}: LoginFormProps): ReactNode {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useForm<LoginFormData>({
    resolver: zodResolver(schema ?? (defaultLoginSchema as any)) as Resolver<LoginFormData>,
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
  });

  const handleSubmit = methods.handleSubmit(async (data: LoginFormData) => {
    setError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      setError(sanitizeErrorMessage(err));
    }
  });

  return (
    <FormProvider {...methods}>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={[{ display: 'flex', flexDirection: 'column', gap: 2.5 }, ...(Array.isArray(sx) ? sx : [sx])]}
        {...slotProps?.wrapper}
      >
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Field.Text
          name="email"
          label={labels.email ?? 'Email'}
          type="email"
          autoComplete="email"
          disabled={disabled || loading}
          {...slotProps?.textField}
        />

        <Field.Text
          name="password"
          label={labels.password ?? 'Password'}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          disabled={disabled || loading}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          {...slotProps?.textField}
        />

        {(showRememberMe || showForgotPassword) && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {showRememberMe && (
              <Field.Checkbox
                name="rememberMe"
                label={labels.rememberMe ?? 'Remember me'}
                disabled={disabled || loading}
              />
            )}
            {showForgotPassword && (
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={onForgotPassword}
                sx={{ textDecoration: 'none' }}
              >
                {labels.forgotPassword ?? 'Forgot password?'}
              </Link>
            )}
          </Box>
        )}

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={disabled || loading}
          {...slotProps?.submitButton}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : (labels.submit ?? 'Sign In')}
        </Button>

        {showSocialLogin && socialProviders.length > 0 && (
          <>
            <Divider>
              <Typography variant="body2" color="text.secondary">
                {labels.socialDivider ?? 'or continue with'}
              </Typography>
            </Divider>
            <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center' }}>
              {socialProviders.map((provider) => (
                <IconButton
                  key={provider.id}
                  onClick={provider.onClick}
                  disabled={disabled || loading}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1,
                  }}
                  aria-label={`Sign in with ${provider.name}`}
                >
                  {provider.icon}
                </IconButton>
              ))}
            </Box>
          </>
        )}
      </Box>
    </FormProvider>
  );
}

// =============================================================================
// REGISTER FORM
// =============================================================================

/**
 * Registration form component.
 *
 * @example
 * ```tsx
 * <RegisterForm
 *   onSubmit={async (data) => {
 *     await signUp(data);
 *   }}
 *   showNameFields
 *   requireTerms
 *   onTermsClick={() => window.open('/terms')}
 * />
 * ```
 */
export function RegisterForm({
  onSubmit,
  loading = false,
  disabled = false,
  showNameFields = false,
  requireTerms = true,
  onTermsClick,
  onPrivacyClick,
  minPasswordLength = 8,
  schema,
  labels = {},
  sx,
  slotProps,
}: RegisterFormProps): ReactNode {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useForm<RegisterFormData>({
    resolver: zodResolver(
      schema ?? (createRegisterSchema(minPasswordLength, requireTerms) as any)
    ) as Resolver<RegisterFormData>,
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
      acceptTerms: false,
    },
  });

  const handleSubmit = methods.handleSubmit(async (data: RegisterFormData) => {
    setError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      setError(sanitizeErrorMessage(err));
    }
  });

  return (
    <FormProvider {...methods}>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={[{ display: 'flex', flexDirection: 'column', gap: 2.5 }, ...(Array.isArray(sx) ? sx : [sx])]}
        {...slotProps?.wrapper}
      >
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {showNameFields && (
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Field.Text
              name="firstName"
              label={labels.firstName ?? 'First Name'}
              autoComplete="given-name"
              disabled={disabled || loading}
              {...slotProps?.textField}
            />
            <Field.Text
              name="lastName"
              label={labels.lastName ?? 'Last Name'}
              autoComplete="family-name"
              disabled={disabled || loading}
              {...slotProps?.textField}
            />
          </Box>
        )}

        <Field.Text
          name="email"
          label={labels.email ?? 'Email'}
          type="email"
          autoComplete="email"
          disabled={disabled || loading}
          {...slotProps?.textField}
        />

        <Field.Text
          name="password"
          label={labels.password ?? 'Password'}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          disabled={disabled || loading}
          helperText={`At least ${minPasswordLength} characters`}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          {...slotProps?.textField}
        />

        <Field.Text
          name="confirmPassword"
          label={labels.confirmPassword ?? 'Confirm Password'}
          type={showConfirmPassword ? 'text' : 'password'}
          autoComplete="new-password"
          disabled={disabled || loading}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    edge="end"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          {...slotProps?.textField}
        />

        {requireTerms && (
          <Field.Checkbox
            name="acceptTerms"
            disabled={disabled || loading}
            label={
              <Typography variant="body2" component="span">
                {labels.acceptTerms ?? 'I agree to the '}
                <Link component="button" type="button" onClick={onTermsClick}>
                  {labels.termsLink ?? 'Terms of Service'}
                </Link>
                {' and '}
                <Link component="button" type="button" onClick={onPrivacyClick}>
                  {labels.privacyLink ?? 'Privacy Policy'}
                </Link>
              </Typography>
            }
          />
        )}

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={disabled || loading}
          {...slotProps?.submitButton}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : (labels.submit ?? 'Create Account')}
        </Button>
      </Box>
    </FormProvider>
  );
}

// =============================================================================
// FORGOT PASSWORD FORM
// =============================================================================

/**
 * Forgot password form component.
 *
 * @example
 * ```tsx
 * <ForgotPasswordForm
 *   onSubmit={async (data) => {
 *     await sendPasswordResetEmail(data.email);
 *   }}
 *   onBackToLogin={() => navigate('/login')}
 * />
 * ```
 */
export function ForgotPasswordForm({
  onSubmit,
  loading = false,
  disabled = false,
  onBackToLogin,
  schema,
  labels = {},
  sx,
  slotProps,
}: ForgotPasswordFormProps): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const methods = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(schema ?? (defaultForgotPasswordSchema as any)) as Resolver<ForgotPasswordFormData>,
    defaultValues: {
      email: '',
    },
  });

  const handleSubmit = methods.handleSubmit(async (data: ForgotPasswordFormData) => {
    setError(null);
    try {
      await onSubmit(data);
      setSuccess(true);
    } catch (err) {
      setError(sanitizeErrorMessage(err));
    }
  });

  if (success) {
    return (
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>
          Check your email
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          We sent a password reset link to your email address.
        </Typography>
        {onBackToLogin && (
          <Button variant="text" onClick={onBackToLogin}>
            {labels.backToLogin ?? 'Back to login'}
          </Button>
        )}
      </Box>
    );
  }

  return (
    <FormProvider {...methods}>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={[{ display: 'flex', flexDirection: 'column', gap: 2.5 }, ...(Array.isArray(sx) ? sx : [sx])]}
        {...slotProps?.wrapper}
      >
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h6" gutterBottom>
            {labels.title ?? 'Forgot password?'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {labels.description ?? "Enter your email and we'll send you a reset link."}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Field.Text
          name="email"
          label={labels.email ?? 'Email'}
          type="email"
          autoComplete="email"
          disabled={disabled || loading}
          {...slotProps?.textField}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={disabled || loading}
          {...slotProps?.submitButton}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : (labels.submit ?? 'Send Reset Link')}
        </Button>

        {onBackToLogin && (
          <Button variant="text" onClick={onBackToLogin} disabled={loading}>
            {labels.backToLogin ?? 'Back to login'}
          </Button>
        )}
      </Box>
    </FormProvider>
  );
}

// =============================================================================
// RESET PASSWORD FORM
// =============================================================================

/**
 * Reset password form component.
 *
 * @example
 * ```tsx
 * <ResetPasswordForm
 *   onSubmit={async (data) => {
 *     await resetPassword(token, data.password);
 *   }}
 * />
 * ```
 */
export function ResetPasswordForm({
  onSubmit,
  loading = false,
  disabled = false,
  minPasswordLength = 8,
  schema,
  labels = {},
  sx,
  slotProps,
}: ResetPasswordFormProps): ReactNode {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useForm<ResetPasswordFormData>({
    resolver: zodResolver(
      schema ?? (createResetPasswordSchema(minPasswordLength) as any)
    ) as Resolver<ResetPasswordFormData>,
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  const handleSubmit = methods.handleSubmit(async (data: ResetPasswordFormData) => {
    setError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      setError(sanitizeErrorMessage(err));
    }
  });

  return (
    <FormProvider {...methods}>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={[{ display: 'flex', flexDirection: 'column', gap: 2.5 }, ...(Array.isArray(sx) ? sx : [sx])]}
        {...slotProps?.wrapper}
      >
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h6" gutterBottom>
            {labels.title ?? 'Set new password'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {labels.description ?? 'Create a new password for your account.'}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Field.Text
          name="password"
          label={labels.password ?? 'New Password'}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          disabled={disabled || loading}
          helperText={`At least ${minPasswordLength} characters`}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          {...slotProps?.textField}
        />

        <Field.Text
          name="confirmPassword"
          label={labels.confirmPassword ?? 'Confirm Password'}
          type={showConfirmPassword ? 'text' : 'password'}
          autoComplete="new-password"
          disabled={disabled || loading}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    edge="end"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          {...slotProps?.textField}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={disabled || loading}
          {...slotProps?.submitButton}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : (labels.submit ?? 'Reset Password')}
        </Button>
      </Box>
    </FormProvider>
  );
}

// =============================================================================
// VERIFY CODE FORM
// =============================================================================

/**
 * Verify code form component (OTP verification).
 *
 * @example
 * ```tsx
 * <VerifyCodeForm
 *   onSubmit={async (data) => {
 *     await verifyCode(data.code);
 *   }}
 *   onResendCode={async () => {
 *     await resendVerificationCode();
 *   }}
 *   resendCooldown={60}
 * />
 * ```
 */
export function VerifyCodeForm({
  onSubmit,
  loading = false,
  disabled = false,
  codeLength = 6,
  onResendCode,
  resendCooldown = 60,
  schema,
  labels = {},
  sx,
  slotProps,
}: VerifyCodeFormProps): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const methods = useForm<VerifyCodeFormData>({
    resolver: zodResolver(schema ?? (createVerifyCodeSchema(codeLength) as any)) as Resolver<VerifyCodeFormData>,
    defaultValues: {
      code: '',
    },
  });

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [cooldown]);

  const handleResendCode = useCallback(async () => {
    if (cooldown > 0 || !onResendCode) return;
    try {
      await onResendCode();
      setCooldown(resendCooldown);
    } catch (err) {
      setError(sanitizeErrorMessage(err, 'Failed to resend code'));
    }
  }, [cooldown, onResendCode, resendCooldown]);

  const handleSubmit = methods.handleSubmit(async (data: VerifyCodeFormData) => {
    setError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      setError(sanitizeErrorMessage(err));
    }
  });

  return (
    <FormProvider {...methods}>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={[
          { display: 'flex', flexDirection: 'column', gap: 2.5, alignItems: 'center' },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...slotProps?.wrapper}
      >
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h6" gutterBottom>
            {labels.title ?? 'Enter verification code'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {labels.description ?? 'We sent a verification code to your email.'}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
            {error}
          </Alert>
        )}

        <Field.Code name="code" length={codeLength} autoFocus disabled={disabled || loading} />

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={disabled || loading}
          {...slotProps?.submitButton}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : (labels.submit ?? 'Verify')}
        </Button>

        {onResendCode && (
          <Box sx={{ textAlign: 'center' }}>
            {cooldown > 0 ? (
              <Typography variant="body2" color="text.secondary">
                {labels.resendIn ?? 'Resend code in'} {cooldown}s
              </Typography>
            ) : (
              <Link component="button" type="button" variant="body2" onClick={handleResendCode} disabled={loading}>
                {labels.resendCode ?? "Didn't receive the code? Resend"}
              </Link>
            )}
          </Box>
        )}
      </Box>
    </FormProvider>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * AuthBlock namespace for auth-related forms.
 */
export const AuthBlock = {
  Login: LoginForm,
  Register: RegisterForm,
  ForgotPassword: ForgotPasswordForm,
  ResetPassword: ResetPasswordForm,
  VerifyCode: VerifyCodeForm,
} as const;
