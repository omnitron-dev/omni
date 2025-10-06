# 34. Error Handling

## Table of Contents
- [Overview](#overview)
- [Error Boundaries](#error-boundaries)
- [Try/Catch Patterns](#trycatch-patterns)
- [Async Error Handling](#async-error-handling)
- [Network Errors](#network-errors)
- [Form Validation](#form-validation)
- [Global Error Handlers](#global-error-handlers)
- [Error Logging](#error-logging)
- [User-Friendly Errors](#user-friendly-errors)
- [Recovery Strategies](#recovery-strategies)
- [Testing Errors](#testing-errors)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

Proper error handling improves user experience and makes debugging easier.

### Error Handling Goals

```typescript
/**
 * Error Handling Principles:
 *
 * 1. Prevent Crashes
 *    - Catch errors gracefully
 *    - Provide fallback UI
 *    - Keep app functional
 *
 * 2. Inform Users
 *    - Clear error messages
 *    - Actionable feedback
 *    - No technical jargon
 *
 * 3. Enable Recovery
 *    - Retry mechanisms
 *    - Alternative paths
 *    - Save user progress
 *
 * 4. Aid Debugging
 *    - Log errors with context
 *    - Include stack traces
 *    - Track error patterns
 *
 * 5. Monitor Production
 *    - Error tracking
 *    - Alerting
 *    - Analytics
 */
```

### Error Types

```typescript
/**
 * Common Error Categories:
 *
 * 1. Network Errors
 *    - Failed HTTP requests
 *    - Timeout errors
 *    - Offline errors
 *
 * 2. Validation Errors
 *    - Invalid input
 *    - Missing required fields
 *    - Format violations
 *
 * 3. Authorization Errors
 *    - Authentication failures
 *    - Permission denied
 *    - Session expired
 *
 * 4. Application Errors
 *    - Runtime errors
 *    - State inconsistencies
 *    - Business logic violations
 *
 * 5. External Errors
 *    - Third-party API failures
 *    - Browser compatibility
 *    - Resource loading failures
 */
```

## Error Boundaries

Catch component errors and show fallback UI.

### Basic Error Boundary

```typescript
import { createSignal, JSX, onError } from 'solid-js';

export const ErrorBoundary = (props: {
  fallback: (error: Error, reset: () => void) => JSX.Element;
  children: JSX.Element;
}) => {
  const [error, setError] = createSignal<Error | null>(null);

  const reset = () => {
    error.set(null);
  };

  onError((err: Error) => {
    console.error('Error caught by boundary:', err);
    error.set(err);
  });

  return () => {
    const currentError = error();
    return currentError
      ? props.fallback(currentError, reset)
      : props.children;
  };
};

// Usage
export default defineComponent(() => {
  return () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div class="error-page">
          <h1>Something went wrong</h1>
          <p>{error.message}</p>
          <button onClick={reset}>Try again</button>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  );
});
```

### Nested Error Boundaries

```typescript
// App-level error boundary
export default defineComponent(() => {
  return () => (
    <ErrorBoundary
      fallback={(error, reset) => <AppError error={error} onReset={reset} />}
    >
      <Header />

      {/* Route-level error boundary */}
      <ErrorBoundary
        fallback={(error, reset) => <RouteError error={error} onReset={reset} />}
      >
        <Router />
      </ErrorBoundary>

      <Footer />
    </ErrorBoundary>
  );
});
```

### Error Boundary with Reporting

```typescript
export const ErrorBoundary = (props: {
  fallback: (error: Error, reset: () => void) => JSX.Element;
  onError?: (error: Error) => void;
  children: JSX.Element;
}) => {
  const [error, setError] = createSignal<Error | null>(null);

  const reset = () => {
    error.set(null);
  };

  onError((err: Error) => {
    console.error('Error caught by boundary:', err);
    error.set(err);

    // Report to error tracking service
    props.onError?.(err);

    // Report to Sentry
    if (window.Sentry) {
      window.Sentry.captureException(err);
    }
  });

  return () => {
    const currentError = error();
    return currentError
      ? props.fallback(currentError, reset)
      : props.children;
  };
};
```

## Try/Catch Patterns

Handle synchronous errors.

### Basic Try/Catch

```typescript
export const processData = (data: unknown) => {
  try {
    const parsed = JSON.parse(data as string);
    return parsed;
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    return null;
  }
};
```

### Try/Catch with Typed Errors

```typescript
class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NetworkError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export const handleError = (error: unknown) => {
  if (error instanceof ValidationError) {
    console.error(`Validation error on ${error.field}:`, error.message);
    showFieldError(error.field, error.message);
  } else if (error instanceof NetworkError) {
    console.error(`Network error (${error.statusCode}):`, error.message);
    showNetworkError(error);
  } else if (error instanceof Error) {
    console.error('Unknown error:', error);
    showGenericError();
  } else {
    console.error('Non-error thrown:', error);
  }
};
```

## Async Error Handling

Handle asynchronous errors.

### Async/Await with Try/Catch

```typescript
export const fetchUser = async (id: string): Promise<User | null> => {
  try {
    const response = await fetch(`/api/users/${id}`);

    if (!response.ok) {
      throw new NetworkError(response.status, 'Failed to fetch user');
    }

    const user = await response.json();
    return user;
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
  }
};
```

### Promise Chains with Catch

```typescript
fetch('/api/data')
  .then((response) => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return response.json();
  })
  .then((data) => {
    processData(data);
  })
  .catch((error) => {
    console.error('Error:', error);
    showError(error.message);
  });
```

### Resource Error Handling

```typescript
import { resource } from 'solid-js';

export default defineComponent(() => {
  const [user, { refetch }] = resource(
    fetchUser,
    {
      // Handle errors
      onError: (error) => {
        console.error('Resource error:', error);
      }
    }
  );

  return () => (
    <Switch>
      <Match when={user.loading}>
        <Loading />
      </Match>
      <Match when={user.error}>
        <div class="error">
          <p>Failed to load user</p>
          <button onClick={() => refetch()}>Retry</button>
        </div>
      </Match>
      <Match when={user()}>
        <UserProfile user={user()!} />
      </Match>
    </Switch>
  );
});
```

## Network Errors

Handle API and network errors.

### Fetch with Error Handling

```typescript
export const apiFetch = async <T>(
  url: string,
  options?: RequestInit
): Promise<T> => {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    });

    // Check HTTP status
    if (!response.ok) {
      // Try to parse error message
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch {
        // Ignore JSON parse error
      }

      throw new NetworkError(response.status, errorMessage);
    }

    // Parse JSON
    const data = await response.json();
    return data;
  } catch (error) {
    // Re-throw NetworkError
    if (error instanceof NetworkError) {
      throw error;
    }

    // Network failure (offline, timeout, etc.)
    if (error instanceof TypeError) {
      throw new NetworkError(0, 'Network request failed. Check your connection.');
    }

    // Unknown error
    throw error;
  }
};

// Usage
try {
  const user = await apiFetch<User>('/api/user');
  console.log(user);
} catch (error) {
  if (error instanceof NetworkError) {
    if (error.statusCode === 404) {
      showNotFound();
    } else if (error.statusCode === 401) {
      redirectToLogin();
    } else if (error.statusCode === 0) {
      showOfflineMessage();
    } else {
      showError(error.message);
    }
  }
}
```

### Retry Logic

```typescript
export const fetchWithRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> => {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${i + 1} failed:`, error);

      if (i < maxRetries - 1) {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }

  throw lastError!;
};

// Usage
const user = await fetchWithRetry(() => apiFetch<User>('/api/user'));
```

### Timeout Handling

```typescript
export const fetchWithTimeout = async <T>(
  url: string,
  options?: RequestInit,
  timeout = 10000
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new NetworkError(response.status, 'Request failed');
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new NetworkError(0, 'Request timeout');
    }

    throw error;
  }
};
```

## Form Validation

Handle form errors gracefully.

### Field-Level Validation

```typescript
import { createForm } from '@nexus/forms';
import { z } from 'zod';

export const SignupForm = defineComponent(() => {
  const form = createForm({
    initialValues: {
      email: '',
      password: '',
      confirmPassword: ''
    },
    validate: z.object({
      email: z.string().email('Invalid email address'),
      password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain uppercase letter')
        .regex(/[0-9]/, 'Password must contain number'),
      confirmPassword: z.string()
    }).refine((data) => data.password === data.confirmPassword, {
      message: "Passwords don't match",
      path: ['confirmPassword']
    }),
    onSubmit: async (values) => {
      try {
        await signup(values);
      } catch (error) {
        if (error instanceof ValidationError) {
          form.setFieldError(error.field, error.message);
        } else {
          form.setSubmitError('Signup failed. Please try again.');
        }
      }
    }
  });

  return () => (
    <form onSubmit={form.handleSubmit}>
      {/* Email */}
      <div>
        <label>Email</label>
        <input
          type="email"
          value={form.values.email}
          onInput={form.handleChange('email')}
          onBlur={form.handleBlur('email')}
          aria-invalid={!!form.errors.email && form.touched.email}
        />
        {form.touched.email && form.errors.email && (
          <div class="error">{form.errors.email}</div>
        )}
      </div>

      {/* Password */}
      <div>
        <label>Password</label>
        <input
          type="password"
          value={form.values.password}
          onInput={form.handleChange('password')}
          onBlur={form.handleBlur('password')}
          aria-invalid={!!form.errors.password && form.touched.password}
        />
        {form.touched.password && form.errors.password && (
          <div class="error">{form.errors.password}</div>
        )}
      </div>

      {/* Submit error */}
      {form.submitError && (
        <div class="form-error" role="alert">
          {form.submitError}
        </div>
      )}

      <button type="submit" disabled={form.isSubmitting}>
        Sign Up
      </button>
    </form>
  );
});
```

## Global Error Handlers

Catch unhandled errors.

### Window Error Handler

```typescript
// main.tsx
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);

  // Report to error tracking
  if (window.Sentry) {
    window.Sentry.captureException(event.error, {
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }
    });
  }

  // Show user-friendly error
  showGlobalError('An unexpected error occurred');

  // Prevent default error handling
  event.preventDefault();
});
```

### Unhandled Promise Rejection

```typescript
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);

  // Report to error tracking
  if (window.Sentry) {
    window.Sentry.captureException(event.reason);
  }

  // Show user-friendly error
  showGlobalError('An error occurred while processing your request');

  // Prevent default handling
  event.preventDefault();
});
```

## Error Logging

Log errors for debugging.

### Console Logging

```typescript
class Logger {
  private isDev = import.meta.env.DEV;

  error(message: string, error?: Error | unknown, context?: any) {
    console.error(message, {
      error,
      context,
      timestamp: new Date().toISOString(),
      url: window.location.href
    });

    // Send to error tracking in production
    if (!this.isDev) {
      this.sendToErrorTracking(message, error, context);
    }
  }

  warn(message: string, context?: any) {
    console.warn(message, context);
  }

  private sendToErrorTracking(message: string, error?: unknown, context?: any) {
    // Send to Sentry, LogRocket, etc.
    if (window.Sentry) {
      window.Sentry.captureException(error || new Error(message), {
        extra: context
      });
    }
  }
}

export const logger = new Logger();

// Usage
try {
  riskyOperation();
} catch (error) {
  logger.error('Operation failed', error, {
    userId: user.id,
    operation: 'riskyOperation'
  });
}
```

### Sentry Integration

```typescript
import * as Sentry from '@sentry/browser';

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,

    // Sample rate
    tracesSampleRate: 1.0,

    // Filter events
    beforeSend(event, hint) {
      // Don't send certain errors
      if (event.exception?.values?.[0]?.value?.includes('ResizeObserver')) {
        return null;
      }

      return event;
    },

    // Ignore specific errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured'
    ]
  });

  // Set user context
  Sentry.user.set({
    id: user.id,
    email: user.email
  });
}

// Capture exception
export const captureException = (error: Error, context?: Record<string, any>) => {
  Sentry.captureException(error, {
    extra: context
  });
};
```

## User-Friendly Errors

Show helpful error messages.

### Error Messages

```typescript
// ❌ Bad - Technical error
"Failed to parse JSON: Unexpected token < in JSON at position 0"

// ✅ Good - User-friendly error
"We couldn't load your data. Please try again."

// Error message helpers
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof ValidationError) {
    return error.message; // Already user-friendly
  }

  if (error instanceof NetworkError) {
    switch (error.statusCode) {
      case 404:
        return "We couldn't find what you're looking for";
      case 401:
        return 'Please log in to continue';
      case 403:
        return "You don't have permission to do that";
      case 500:
        return 'Something went wrong on our end';
      case 0:
        return 'Please check your internet connection';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  // Generic error
  return 'An unexpected error occurred';
};
```

### Error UI Components

```typescript
// Generic error message
export const ErrorMessage = defineComponent((props: {
  message: string;
  onRetry?: () => void;
}) => {
  return () => (
    <div class="error-message" role="alert">
      <div class="error-icon">⚠️</div>
      <p>{props.message}</p>
      {props.onRetry && (
        <button onClick={props.onRetry}>Try Again</button>
      )}
    </div>
  );
});

// Inline field error
export const FieldError = defineComponent((props: { message: string }) => {
  return () => (
    <div class="field-error" role="alert">
      <Icon name="error" />
      <span>{props.message}</span>
    </div>
  );
});

// Full page error
export const ErrorPage = defineComponent((props: {
  title?: string;
  message: string;
  onRetry?: () => void;
  onGoHome?: () => void;
}) => {
  return () => (
    <div class="error-page">
      <h1>{props.title || 'Oops!'}</h1>
      <p>{props.message}</p>
      <div class="actions">
        {props.onRetry && (
          <button onClick={props.onRetry}>Try Again</button>
        )}
        {props.onGoHome && (
          <button onClick={props.onGoHome}>Go Home</button>
        )}
      </div>
    </div>
  );
});
```

## Recovery Strategies

Help users recover from errors.

### Retry Mechanism

```typescript
export const DataView = defineComponent(() => {
  const [data, { refetch }] = resource(fetchData);
  const retryCount = signal(0);

  const handleRetry = () => {
    retryCount.set(count => count + 1);
    refetch();
  };

  return () => (
    <Switch>
      <Match when={data.loading}>
        <Loading />
      </Match>
      <Match when={data.error}>
        <ErrorMessage
          message={getErrorMessage(data.error)}
          onRetry={handleRetry}
        />
        {retryCount() > 2 && (
          <p class="help-text">
            Still having issues? <a href="/support">Contact support</a>
          </p>
        )}
      </Match>
      <Match when={data()}>
        <DataDisplay data={data()!} />
      </Match>
    </Switch>
  );
});
```

### Fallback Content

```typescript
export const UserProfile = defineComponent((props: { userId: string }) => {
  const [user, { refetch }] = resource(
    () => props.userId,
    fetchUser
  );

  return () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div class="fallback">
          <h2>Unable to load profile</h2>
          <p>You can still:</p>
          <ul>
            <li><a href="/dashboard">View your dashboard</a></li>
            <li><a href="/settings">Update your settings</a></li>
            <li><a href="/support">Contact support</a></li>
          </ul>
          <button onClick={reset}>Try again</button>
        </div>
      )}
    >
      <Show when={user()} fallback={<UserProfileSkeleton />}>
        <UserProfileView user={user()!} />
      </Show>
    </ErrorBoundary>
  );
});
```

### Save User Progress

```typescript
export const FormWithAutoSave = defineComponent(() => {
  const [formData, setFormData] = createStore({
    title: '',
    content: ''
  });

  // Auto-save to localStorage
  createEffect(() => {
    try {
      localStorage.setItem('draft', JSON.stringify(formData));
    } catch (error) {
      console.error('Failed to save draft:', error);
    }
  });

  // Restore on mount
  onMount(() => {
    try {
      const saved = localStorage.getItem('draft');
      if (saved) {
        const data = JSON.parse(saved);
        setFormData(data);
      }
    } catch (error) {
      console.error('Failed to restore draft:', error);
    }
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    try {
      await savePost(formData);
      localStorage.removeItem('draft');
    } catch (error) {
      showError('Failed to save. Your draft has been preserved.');
    }
  };

  return () => (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
    </form>
  );
});
```

## Testing Errors

Test error handling.

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Error Handling', () => {
  it('handles network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new NetworkError(500, 'Server error')
    );

    const { getByText } = render(() => (
      <DataView fetcher={fetchMock} />
    ));

    await waitFor(() => {
      expect(getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  it('provides retry mechanism', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('First attempt failed'));
      }
      return Promise.resolve({ data: 'success' });
    });

    const { getByText } = render(() => (
      <DataView fetcher={fetchMock} />
    ));

    // Wait for error
    await waitFor(() => {
      expect(getByText(/try again/i)).toBeInTheDocument();
    });

    // Click retry
    await fireEvent.click(getByText(/try again/i));

    // Should succeed
    await waitFor(() => {
      expect(getByText('success')).toBeInTheDocument();
    });

    expect(callCount).toBe(2);
  });
});
```

### E2E Tests

```typescript
import { test, expect } from '@playwright/test';

test('displays error message on network failure', async ({ page, context }) => {
  // Simulate offline
  await context.setOffline(true);

  await page.goto('/dashboard');

  await expect(page.locator('.error-message')).toContainText(/check your internet/i);

  // Go back online
  await context.setOffline(false);

  // Retry should work
  await page.click('button:has-text("Try Again")');

  await expect(page.locator('.dashboard')).toBeVisible();
});
```

## Best Practices

### Guidelines

```typescript
/**
 * Error Handling Best Practices:
 *
 * 1. Fail Gracefully
 *    - Don't crash the app
 *    - Show fallback UI
 *    - Preserve user progress
 *
 * 2. Be User-Friendly
 *    - Clear, simple messages
 *    - No technical jargon
 *    - Actionable guidance
 *
 * 3. Provide Recovery
 *    - Retry buttons
 *    - Alternative paths
 *    - Save drafts
 *
 * 4. Log Everything
 *    - Capture context
 *    - Include stack traces
 *    - Monitor patterns
 *
 * 5. Test Errors
 *    - Unit test error paths
 *    - E2E test failures
 *    - Test recovery
 *
 * 6. Monitor Production
 *    - Error tracking (Sentry)
 *    - Alerts for critical errors
 *    - Track error rates
 *
 * 7. Handle Async Properly
 *    - Always use try/catch with async/await
 *    - Handle promise rejections
 *    - Timeout long-running requests
 */
```

## Examples

### Complete Error Handling Setup

```typescript
// errors.ts - Error types
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(public field: string, message: string) {
    super('VALIDATION_ERROR', message);
  }
}

export class NetworkError extends AppError {
  constructor(statusCode: number, message: string) {
    super('NETWORK_ERROR', message, statusCode);
  }
}

export class AuthError extends AppError {
  constructor(message: string) {
    super('AUTH_ERROR', message, 401);
  }
}

// error-handler.ts
export const handleError = (error: unknown): string => {
  // Log error
  console.error('Error occurred:', error);

  // Report to Sentry
  if (import.meta.env.PROD && window.Sentry) {
    window.Sentry.captureException(error);
  }

  // Return user-friendly message
  if (error instanceof ValidationError) {
    return error.message;
  }

  if (error instanceof NetworkError) {
    switch (error.statusCode) {
      case 404:
        return "We couldn't find what you're looking for";
      case 401:
        return 'Please log in to continue';
      case 403:
        return "You don't have permission to do that";
      case 500:
        return 'Something went wrong on our end';
      case 0:
        return 'Please check your internet connection';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  if (error instanceof AuthError) {
    return 'Your session has expired. Please log in again.';
  }

  // Generic error
  return 'An unexpected error occurred';
};

// App.tsx with comprehensive error handling
export default defineComponent(() => {
  // Global error handlers
  onMount(() => {
    window.addEventListener('error', (event) => {
      logger.error('Unhandled error', event.error);
      showNotification(handleError(event.error), 'error');
    });

    window.addEventListener('unhandledrejection', (event) => {
      logger.error('Unhandled rejection', event.reason);
      showNotification(handleError(event.reason), 'error');
    });
  });

  return () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <ErrorPage
          title="Oops! Something went wrong"
          message={handleError(error)}
          onRetry={reset}
          onGoHome={() => (window.location.href = '/')}
        />
      )}
    >
      <App />
    </ErrorBoundary>
  );
});
```

## Summary

Effective error handling is essential:

1. **Boundaries**: Catch component errors gracefully
2. **Try/Catch**: Handle synchronous errors
3. **Async**: Properly handle async errors
4. **Network**: Handle API failures with retry
5. **Validation**: Show clear form errors
6. **Global**: Catch unhandled errors
7. **Logging**: Log errors with context
8. **Messages**: Show user-friendly errors
9. **Recovery**: Provide retry and fallback
10. **Testing**: Test error scenarios

Build resilient apps with Nexus error handling.
