/**
 * Login Form Example
 *
 * Demonstrates:
 * - Simple form with email and password
 * - Real-time validation with computed()
 * - bindValue() for two-way binding
 * - preventStop() for form submission
 * - Conditional error messages with Show
 * - Disabled submit until valid
 *
 * Usage:
 * ```tsx
 * <LoginForm onLogin={(credentials) => console.log(credentials)} />
 * ```
 */

import { defineComponent, Show } from '@omnitron-dev/aether';
import { signal, computed } from '@omnitron-dev/aether/reactivity';
import { bindValue, preventStop, classes } from '@omnitron-dev/aether/utils';

/**
 * Login Form Props
 */
export interface LoginFormProps {
  /** Callback when login is submitted */
  onLogin?: (credentials: { email: string; password: string }) => void | Promise<void>;

  /** Whether form is in loading state */
  loading?: boolean;

  /** Error message to display */
  error?: string;
}

/**
 * Login Form Component
 *
 * A simple login form with email and password validation.
 */
export const LoginForm = defineComponent<LoginFormProps>((props) => {
  const email = signal('');
  const password = signal('');
  const touched = signal({ email: false, password: false });
  const isSubmitting = signal(false);

  // Email validation
  const emailError = computed(() => {
    if (!touched().email) return null;
    const value = email();
    if (!value) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'Invalid email format';
    }
    return null;
  });

  // Password validation
  const passwordError = computed(() => {
    if (!touched().password) return null;
    const value = password();
    if (!value) return 'Password is required';
    if (value.length < 8) {
      return 'Password must be at least 8 characters';
    }
    return null;
  });

  // Form validity
  const isFormValid = computed(() => {
    return (
      email() &&
      password() &&
      !emailError() &&
      !passwordError() &&
      !isSubmitting() &&
      !props.loading
    );
  });

  // Mark field as touched
  const markTouched = (field: 'email' | 'password') => {
    touched.set({ ...touched(), [field]: true });
  };

  // Handle form submission
  const handleSubmit = async () => {
    // Mark all fields as touched
    touched.set({ email: true, password: true });

    if (!isFormValid()) return;

    isSubmitting.set(true);
    try {
      await props.onLogin?.({
        email: email(),
        password: password(),
      });
    } finally {
      isSubmitting.set(false);
    }
  };

  return () => (
    <form
      onSubmit={preventStop(handleSubmit)}
      className="login-form"
      style={{
        maxWidth: '400px',
        margin: '0 auto',
        padding: '2rem',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Login</h2>

      {/* Global error message */}
      <Show when={props.error}>
        <div
          className="error-banner"
          style={{
            padding: '0.75rem',
            marginBottom: '1rem',
            backgroundColor: '#fee',
            border: '1px solid #fcc',
            borderRadius: '0.25rem',
            color: '#c00',
          }}
        >
          {props.error}
        </div>
      </Show>

      {/* Email field */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="email"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          {...bindValue(email)}
          onBlur={() => markTouched('email')}
          className={classes('input', {
            'input-error': !!emailError(),
          })}
          style={{
            width: '100%',
            padding: '0.5rem',
            border: emailError() ? '1px solid #f44' : '1px solid #ddd',
            borderRadius: '0.25rem',
            fontSize: '1rem',
          }}
          placeholder="you@example.com"
          disabled={isSubmitting() || props.loading}
        />
        <Show when={emailError()}>
          <p
            className="error-message"
            style={{
              margin: '0.25rem 0 0',
              fontSize: '0.875rem',
              color: '#c00',
            }}
          >
            {emailError()}
          </p>
        </Show>
      </div>

      {/* Password field */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="password"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          {...bindValue(password)}
          onBlur={() => markTouched('password')}
          className={classes('input', {
            'input-error': !!passwordError(),
          })}
          style={{
            width: '100%',
            padding: '0.5rem',
            border: passwordError() ? '1px solid #f44' : '1px solid #ddd',
            borderRadius: '0.25rem',
            fontSize: '1rem',
          }}
          placeholder="••••••••"
          disabled={isSubmitting() || props.loading}
        />
        <Show when={passwordError()}>
          <p
            className="error-message"
            style={{
              margin: '0.25rem 0 0',
              fontSize: '0.875rem',
              color: '#c00',
            }}
          >
            {passwordError()}
          </p>
        </Show>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={!isFormValid()}
        style={{
          width: '100%',
          padding: '0.75rem',
          backgroundColor: isFormValid() ? '#3b82f6' : '#94a3b8',
          color: 'white',
          border: 'none',
          borderRadius: '0.25rem',
          fontSize: '1rem',
          fontWeight: 500,
          cursor: isFormValid() ? 'pointer' : 'not-allowed',
          transition: 'background-color 0.15s',
        }}
      >
        {isSubmitting() || props.loading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
});

/**
 * Usage Examples
 */

// Basic usage
export const BasicLoginExample = defineComponent(() => {
  const handleLogin = async (credentials: { email: string; password: string }) => {
    console.log('Login attempt:', credentials);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('Login successful!');
  };

  return () => <LoginForm onLogin={handleLogin} />;
});

// With error handling
export const LoginWithErrorExample = defineComponent(() => {
  const error = signal<string | undefined>(undefined);
  const loading = signal(false);

  const handleLogin = async (credentials: { email: string; password: string }) => {
    error.set(undefined);
    loading.set(true);

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Simulate error
      if (credentials.email === 'error@example.com') {
        throw new Error('Invalid credentials');
      }

      console.log('Login successful!');
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Login failed');
    } finally {
      loading.set(false);
    }
  };

  return () => (
    <LoginForm onLogin={handleLogin} loading={loading()} error={error()} />
  );
});

/**
 * Key Takeaways:
 *
 * 1. **Two-Way Binding**: bindValue() for simple input binding
 * 2. **Validation**: computed() for derived validation state
 * 3. **Touch State**: Track which fields user has interacted with
 * 4. **Form Submission**: preventStop() to handle submit properly
 * 5. **Conditional UI**: Show component for error messages
 * 6. **Disabled State**: Button disabled until form is valid
 * 7. **Loading State**: Visual feedback during submission
 * 8. **Type Safety**: Full TypeScript types for props and credentials
 */
