/**
 * Registration Form Example
 *
 * Demonstrates:
 * - Multi-field form with complex validation
 * - Password confirmation validation
 * - bindValue() and bindChecked() for different input types
 * - Cross-field validation (passwords match)
 * - Checkbox with terms acceptance
 * - Form-level validation state
 *
 * Usage:
 * ```tsx
 * <RegistrationForm
 *   onRegister={(data) => console.log('Register:', data)}
 * />
 * ```
 */

import { defineComponent, Show } from '@omnitron-dev/aether';
import { signal, computed } from '@omnitron-dev/aether/reactivity';
import { bindValue, bindChecked, preventStop, classes } from '@omnitron-dev/aether/utils';

/**
 * Registration data type
 */
export interface RegistrationData {
  name: string;
  email: string;
  password: string;
  agreeToTerms: boolean;
}

/**
 * Registration Form Props
 */
export interface RegistrationFormProps {
  /** Callback when registration is submitted */
  onRegister?: (data: RegistrationData) => void | Promise<void>;

  /** Whether form is in loading state */
  loading?: boolean;

  /** Error message to display */
  error?: string;

  /** Success message to display */
  success?: string;
}

/**
 * Registration Form Component
 *
 * A comprehensive registration form with multiple fields and validation rules.
 */
export const RegistrationForm = defineComponent<RegistrationFormProps>((props) => {
  // Form state
  const name = signal('');
  const email = signal('');
  const password = signal('');
  const confirmPassword = signal('');
  const agreeToTerms = signal(false);
  const isSubmitting = signal(false);

  // Touch state for each field
  const touched = signal({
    name: false,
    email: false,
    password: false,
    confirmPassword: false,
    agreeToTerms: false,
  });

  // Name validation
  const nameError = computed(() => {
    if (!touched().name) return null;
    const value = name();
    if (!value) return 'Name is required';
    if (value.length < 2) return 'Name must be at least 2 characters';
    return null;
  });

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
    if (!/[A-Z]/.test(value)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(value)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(value)) {
      return 'Password must contain at least one number';
    }
    return null;
  });

  // Confirm password validation
  const confirmPasswordError = computed(() => {
    if (!touched().confirmPassword) return null;
    const value = confirmPassword();
    if (!value) return 'Please confirm your password';
    if (value !== password()) {
      return 'Passwords do not match';
    }
    return null;
  });

  // Terms validation
  const termsError = computed(() => {
    if (!touched().agreeToTerms) return null;
    if (!agreeToTerms()) {
      return 'You must agree to the terms and conditions';
    }
    return null;
  });

  // Form validity
  const isFormValid = computed(() => {
    return (
      name() &&
      email() &&
      password() &&
      confirmPassword() &&
      agreeToTerms() &&
      !nameError() &&
      !emailError() &&
      !passwordError() &&
      !confirmPasswordError() &&
      !termsError() &&
      !isSubmitting() &&
      !props.loading
    );
  });

  // Password strength indicator
  const passwordStrength = computed(() => {
    const pwd = password();
    if (!pwd) return { level: 0, label: 'None' };

    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[A-Z]/.test(pwd)) strength++;
    if (/[a-z]/.test(pwd)) strength++;
    if (/[0-9]/.test(pwd)) strength++;
    if (/[^A-Za-z0-9]/.test(pwd)) strength++;

    if (strength <= 2) return { level: 1, label: 'Weak', color: '#f44' };
    if (strength <= 4) return { level: 2, label: 'Medium', color: '#fa4' };
    return { level: 3, label: 'Strong', color: '#4a4' };
  });

  // Mark field as touched
  const markTouched = (field: keyof typeof touched._value) => {
    touched.set({ ...touched(), [field]: true });
  };

  // Handle form submission
  const handleSubmit = async () => {
    // Mark all fields as touched
    touched.set({
      name: true,
      email: true,
      password: true,
      confirmPassword: true,
      agreeToTerms: true,
    });

    if (!isFormValid()) return;

    isSubmitting.set(true);
    try {
      await props.onRegister?.({
        name: name(),
        email: email(),
        password: password(),
        agreeToTerms: agreeToTerms(),
      });
    } finally {
      isSubmitting.set(false);
    }
  };

  return () => (
    <form
      onSubmit={preventStop(handleSubmit)}
      className="registration-form"
      style={{
        maxWidth: '500px',
        margin: '0 auto',
        padding: '2rem',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Create Account</h2>

      {/* Success message */}
      <Show when={props.success}>
        <div
          className="success-banner"
          style={{
            padding: '0.75rem',
            marginBottom: '1rem',
            backgroundColor: '#efe',
            border: '1px solid #cfc',
            borderRadius: '0.25rem',
            color: '#070',
          }}
        >
          {props.success}
        </div>
      </Show>

      {/* Error message */}
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

      {/* Name field */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label
          htmlFor="name"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}
        >
          Full Name
        </label>
        <input
          id="name"
          type="text"
          {...bindValue(name)}
          onBlur={() => markTouched('name')}
          className={classes('input', { 'input-error': !!nameError() })}
          style={{
            width: '100%',
            padding: '0.5rem',
            border: nameError() ? '1px solid #f44' : '1px solid #ddd',
            borderRadius: '0.25rem',
            fontSize: '1rem',
          }}
          placeholder="John Doe"
          disabled={isSubmitting() || props.loading}
        />
        <Show when={nameError()}>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
            {nameError()}
          </p>
        </Show>
      </div>

      {/* Email field */}
      <div style={{ marginBottom: '1.25rem' }}>
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
          className={classes('input', { 'input-error': !!emailError() })}
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
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
            {emailError()}
          </p>
        </Show>
      </div>

      {/* Password field */}
      <div style={{ marginBottom: '1.25rem' }}>
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
          className={classes('input', { 'input-error': !!passwordError() })}
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

        {/* Password strength indicator */}
        <Show when={password() && !passwordError()}>
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.25rem' }}>
              <div
                style={{
                  flex: 1,
                  height: '4px',
                  backgroundColor:
                    passwordStrength().level >= 1
                      ? passwordStrength().color
                      : '#ddd',
                  borderRadius: '2px',
                }}
              />
              <div
                style={{
                  flex: 1,
                  height: '4px',
                  backgroundColor:
                    passwordStrength().level >= 2
                      ? passwordStrength().color
                      : '#ddd',
                  borderRadius: '2px',
                }}
              />
              <div
                style={{
                  flex: 1,
                  height: '4px',
                  backgroundColor:
                    passwordStrength().level >= 3
                      ? passwordStrength().color
                      : '#ddd',
                  borderRadius: '2px',
                }}
              />
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '0.75rem',
                color: passwordStrength().color,
              }}
            >
              Password strength: {passwordStrength().label}
            </p>
          </div>
        </Show>

        <Show when={passwordError()}>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
            {passwordError()}
          </p>
        </Show>
      </div>

      {/* Confirm password field */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label
          htmlFor="confirmPassword"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}
        >
          Confirm Password
        </label>
        <input
          id="confirmPassword"
          type="password"
          {...bindValue(confirmPassword)}
          onBlur={() => markTouched('confirmPassword')}
          className={classes('input', { 'input-error': !!confirmPasswordError() })}
          style={{
            width: '100%',
            padding: '0.5rem',
            border: confirmPasswordError() ? '1px solid #f44' : '1px solid #ddd',
            borderRadius: '0.25rem',
            fontSize: '1rem',
          }}
          placeholder="••••••••"
          disabled={isSubmitting() || props.loading}
        />
        <Show when={confirmPasswordError()}>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
            {confirmPasswordError()}
          </p>
        </Show>
      </div>

      {/* Terms and conditions */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            {...bindChecked(agreeToTerms)}
            onBlur={() => markTouched('agreeToTerms')}
            disabled={isSubmitting() || props.loading}
            style={{ marginRight: '0.5rem' }}
          />
          <span style={{ fontSize: '0.875rem' }}>
            I agree to the{' '}
            <a href="/terms" style={{ color: '#3b82f6', textDecoration: 'underline' }}>
              Terms and Conditions
            </a>
          </span>
        </label>
        <Show when={termsError()}>
          <p style={{ margin: '0.25rem 0 0 1.5rem', fontSize: '0.875rem', color: '#c00' }}>
            {termsError()}
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
        {isSubmitting() || props.loading ? 'Creating account...' : 'Create Account'}
      </button>
    </form>
  );
});

/**
 * Usage Examples
 */

// Basic usage
export const BasicRegistrationExample = defineComponent(() => {
  const handleRegister = async (data: RegistrationData) => {
    console.log('Registration attempt:', data);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log('Registration successful!');
  };

  return () => <RegistrationForm onRegister={handleRegister} />;
});

// With full error/success handling
export const FullRegistrationExample = defineComponent(() => {
  const error = signal<string | undefined>(undefined);
  const success = signal<string | undefined>(undefined);
  const loading = signal(false);

  const handleRegister = async (data: RegistrationData) => {
    error.set(undefined);
    success.set(undefined);
    loading.set(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulate duplicate email error
      if (data.email === 'taken@example.com') {
        throw new Error('Email already registered');
      }

      success.set('Account created successfully! Redirecting...');

      // Simulate redirect after 2 seconds
      setTimeout(() => {
        console.log('Redirect to dashboard');
      }, 2000);
    } catch (err) {
      error.set(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      loading.set(false);
    }
  };

  return () => (
    <RegistrationForm
      onRegister={handleRegister}
      loading={loading()}
      error={error()}
      success={success()}
    />
  );
});

/**
 * Key Takeaways:
 *
 * 1. **Multiple Fields**: Handling multiple input types (text, email, password, checkbox)
 * 2. **Cross-Field Validation**: Password confirmation checks against password
 * 3. **Password Strength**: Computed visual indicator for password strength
 * 4. **bindChecked()**: For checkbox inputs
 * 5. **Complex Validation**: Multiple rules per field (length, format, character types)
 * 6. **Touch State**: Per-field touch tracking for better UX
 * 7. **Conditional Messages**: Success and error banners
 * 8. **Type Safety**: Full TypeScript types for registration data
 */
