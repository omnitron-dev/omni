/**
 * Error Handling Utilities
 *
 * Comprehensive error handling with i18n support, error classification,
 * and retry logic for robust frontend applications.
 *
 * @module @omnitron/prism/utils
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Error codes for classification.
 */
export type ErrorCode =
  // Auth errors
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'AUTH_INVALID'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_MFA_REQUIRED'
  | 'AUTH_DEVICE_BLOCKED'
  // Network errors
  | 'NETWORK_ERROR'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_OFFLINE'
  // Validation errors
  | 'VALIDATION_ERROR'
  | 'VALIDATION_REQUIRED'
  | 'VALIDATION_FORMAT'
  | 'VALIDATION_RANGE'
  // Server errors
  | 'SERVER_ERROR'
  | 'SERVER_UNAVAILABLE'
  | 'SERVER_MAINTENANCE'
  // Client errors
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  // Generic
  | 'UNKNOWN_ERROR'
  | string;

/**
 * Severity levels for errors.
 */
export type ErrorSeverity = 'error' | 'warning' | 'info';

/**
 * Error context for i18n.
 */
export interface ErrorContext {
  /** Error code for lookup */
  code: ErrorCode;
  /** HTTP status code if applicable */
  status?: number;
  /** Field name for validation errors */
  field?: string;
  /** Additional interpolation values */
  values?: Record<string, string | number>;
  /** Original error message (fallback) */
  message?: string;
  /** Retry information */
  retryAfter?: number;
  /** Severity level */
  severity?: ErrorSeverity;
}

/**
 * Translated error result.
 */
export interface TranslatedError {
  /** Translated title */
  title: string;
  /** Translated message */
  message: string;
  /** Error code */
  code: ErrorCode;
  /** Severity */
  severity: ErrorSeverity;
  /** Action hint (e.g., "Please log in again") */
  action?: string;
  /** Retry after seconds */
  retryAfter?: number;
  /** Is this a retryable error */
  canRetry: boolean;
}

/**
 * Translation function type.
 */
export type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

/**
 * Error messages dictionary type.
 */
export interface ErrorMessages {
  [code: string]: {
    title: string;
    message: string;
    action?: string;
  };
}

// =============================================================================
// DEFAULT ERROR MESSAGES
// =============================================================================

/**
 * Default error messages in English.
 * Can be replaced with i18n translations.
 */
export const DEFAULT_ERROR_MESSAGES: ErrorMessages = {
  // Auth
  AUTH_REQUIRED: {
    title: 'Authentication Required',
    message: 'Please log in to continue.',
    action: 'Log in',
  },
  AUTH_EXPIRED: {
    title: 'Session Expired',
    message: 'Your session has expired. Please log in again.',
    action: 'Log in again',
  },
  AUTH_INVALID: {
    title: 'Invalid Credentials',
    message: 'The provided credentials are invalid.',
    action: 'Try again',
  },
  AUTH_FORBIDDEN: {
    title: 'Access Denied',
    message: "You don't have permission to access this resource.",
  },
  AUTH_MFA_REQUIRED: {
    title: 'Verification Required',
    message: 'Please complete two-factor authentication.',
    action: 'Verify',
  },
  AUTH_DEVICE_BLOCKED: {
    title: 'Device Blocked',
    message: 'This device has been blocked. Contact support for assistance.',
  },
  // Network
  NETWORK_ERROR: {
    title: 'Connection Error',
    message: 'Unable to connect to the server. Please check your connection.',
    action: 'Retry',
  },
  NETWORK_TIMEOUT: {
    title: 'Request Timeout',
    message: 'The request took too long. Please try again.',
    action: 'Retry',
  },
  NETWORK_OFFLINE: {
    title: 'Offline',
    message: "You're currently offline. Please check your internet connection.",
  },
  // Validation
  VALIDATION_ERROR: {
    title: 'Validation Error',
    message: 'Please check your input and try again.',
  },
  VALIDATION_REQUIRED: {
    title: 'Required Field',
    message: 'This field is required.',
  },
  VALIDATION_FORMAT: {
    title: 'Invalid Format',
    message: 'Please enter a valid format.',
  },
  VALIDATION_RANGE: {
    title: 'Out of Range',
    message: 'The value is out of the allowed range.',
  },
  // Server
  SERVER_ERROR: {
    title: 'Server Error',
    message: 'Something went wrong on our end. Please try again later.',
    action: 'Retry',
  },
  SERVER_UNAVAILABLE: {
    title: 'Service Unavailable',
    message: 'The service is temporarily unavailable. Please try again later.',
    action: 'Retry',
  },
  SERVER_MAINTENANCE: {
    title: 'Under Maintenance',
    message: "We're performing maintenance. Please check back soon.",
  },
  // Client
  NOT_FOUND: {
    title: 'Not Found',
    message: 'The requested resource could not be found.',
  },
  CONFLICT: {
    title: 'Conflict',
    message: 'The resource was modified. Please refresh and try again.',
    action: 'Refresh',
  },
  RATE_LIMITED: {
    title: 'Too Many Requests',
    message: 'Please slow down and try again later.',
  },
  QUOTA_EXCEEDED: {
    title: 'Quota Exceeded',
    message: 'You have exceeded your usage quota.',
  },
  // Generic
  UNKNOWN_ERROR: {
    title: 'Error',
    message: 'An unexpected error occurred. Please try again.',
    action: 'Retry',
  },
};

// =============================================================================
// ERROR CLASSIFICATION
// =============================================================================

/**
 * Classify an error by HTTP status code.
 */
export function classifyHttpError(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
      return 'AUTH_FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 408:
      return 'NETWORK_TIMEOUT';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    case 500:
      return 'SERVER_ERROR';
    case 502:
    case 503:
    case 504:
      return 'SERVER_UNAVAILABLE';
    default:
      if (status >= 400 && status < 500) return 'VALIDATION_ERROR';
      if (status >= 500) return 'SERVER_ERROR';
      return 'UNKNOWN_ERROR';
  }
}

/**
 * Check if an error is a network error.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('offline') ||
      message.includes('failed to fetch')
    );
  }
  return false;
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(code: ErrorCode): boolean {
  const retryableCodes: ErrorCode[] = [
    'NETWORK_ERROR',
    'NETWORK_TIMEOUT',
    'SERVER_ERROR',
    'SERVER_UNAVAILABLE',
    'RATE_LIMITED',
    'CONFLICT',
  ];
  return retryableCodes.includes(code);
}

/**
 * Get severity for an error code.
 */
export function getErrorSeverity(code: ErrorCode): ErrorSeverity {
  // Warnings (recoverable, action possible)
  const warnings: ErrorCode[] = ['AUTH_EXPIRED', 'RATE_LIMITED', 'NETWORK_OFFLINE', 'AUTH_MFA_REQUIRED'];

  // Info (informational, not blocking)
  const infos: ErrorCode[] = ['SERVER_MAINTENANCE'];

  if (warnings.includes(code)) return 'warning';
  if (infos.includes(code)) return 'info';
  return 'error';
}

// =============================================================================
// ERROR TRANSLATION
// =============================================================================

/**
 * Create an error translator with custom messages or i18n function.
 *
 * @example
 * ```tsx
 * // With custom messages
 * const translate = createErrorTranslator({
 *   messages: {
 *     AUTH_REQUIRED: {
 *       title: 'Необходима авторизация',
 *       message: 'Пожалуйста, войдите в систему.',
 *     },
 *   },
 * });
 *
 * // With i18n library
 * const translate = createErrorTranslator({
 *   t: (key, values) => i18n.t(key, values),
 * });
 *
 * const error = translate({ code: 'AUTH_REQUIRED', status: 401 });
 * // { title: 'Необходима авторизация', message: '...', ... }
 * ```
 */
export function createErrorTranslator(options: {
  messages?: ErrorMessages;
  t?: TranslateFn;
  fallbackMessages?: ErrorMessages;
}): (context: ErrorContext) => TranslatedError {
  const { messages = {}, t, fallbackMessages = DEFAULT_ERROR_MESSAGES } = options;

  return (context: ErrorContext): TranslatedError => {
    const { code, values, message: originalMessage, severity, retryAfter } = context;

    // Try i18n translation first
    if (t) {
      const titleKey = `errors.${code}.title`;
      const messageKey = `errors.${code}.message`;
      const actionKey = `errors.${code}.action`;

      const title = t(titleKey, values);
      const translatedMessage = t(messageKey, values);
      const action = t(actionKey, values);

      // If translation was found (not equal to key)
      if (title !== titleKey) {
        return {
          title,
          message: translatedMessage !== messageKey ? translatedMessage : originalMessage || '',
          code,
          severity: severity ?? getErrorSeverity(code),
          action: action !== actionKey ? action : undefined,
          retryAfter,
          canRetry: isRetryableError(code),
        };
      }
    }

    // Try custom messages, then fallback
    const errorDef = messages[code] ?? fallbackMessages[code] ?? fallbackMessages.UNKNOWN_ERROR;

    return {
      title: errorDef.title,
      message: interpolateMessage(errorDef.message, values) || originalMessage || errorDef.message,
      code,
      severity: severity ?? getErrorSeverity(code),
      action: errorDef.action,
      retryAfter,
      canRetry: isRetryableError(code),
    };
  };
}

/**
 * Simple message interpolation.
 */
function interpolateMessage(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return Object.entries(values).reduce(
    (msg, [key, value]) => msg.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );
}

// =============================================================================
// ERROR EXTRACTION
// =============================================================================

/**
 * Extract error context from various error types.
 *
 * @example
 * ```tsx
 * try {
 *   await api.call();
 * } catch (error) {
 *   const context = extractErrorContext(error);
 *   const translated = translateError(context);
 *   showNotification(translated);
 * }
 * ```
 */
export function extractErrorContext(error: unknown): ErrorContext {
  // Already an ErrorContext
  if (isErrorContext(error)) {
    return error;
  }

  // Response-like object (fetch Response or similar)
  if (isResponseLike(error)) {
    return {
      code: classifyHttpError(error.status),
      status: error.status,
      message: error.statusText,
    };
  }

  // Error with response property (axios-like)
  if (hasResponseProperty(error)) {
    const response = error.response;
    const data = response.data;

    // Extract typed values from response data with safe fallbacks
    const code = typeof data?.code === 'string' ? data.code : classifyHttpError(response.status);
    const message = typeof data?.message === 'string' ? data.message : response.statusText;
    const field = typeof data?.field === 'string' ? data.field : undefined;
    const values =
      data?.values !== undefined &&
      typeof data.values === 'object' &&
      data.values !== null &&
      !Array.isArray(data.values)
        ? (data.values as Record<string, string | number>)
        : undefined;

    return {
      code,
      status: response.status,
      message,
      values,
      field,
    };
  }

  // Network error
  if (isNetworkError(error)) {
    return {
      code: navigator?.onLine === false ? 'NETWORK_OFFLINE' : 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Network error',
    };
  }

  // Generic Error
  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
    };
  }

  // String error
  if (typeof error === 'string') {
    return {
      code: 'UNKNOWN_ERROR',
      message: error,
    };
  }

  // Object with message/code
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    return {
      code: (typeof obj.code === 'string' ? obj.code : 'UNKNOWN_ERROR') as ErrorCode,
      message: typeof obj.message === 'string' ? obj.message : undefined,
      status: typeof obj.status === 'number' ? obj.status : undefined,
    };
  }

  return { code: 'UNKNOWN_ERROR' };
}

// Type guards
function isErrorContext(value: unknown): value is ErrorContext {
  return (
    value !== null && typeof value === 'object' && 'code' in value && typeof (value as ErrorContext).code === 'string'
  );
}

function isResponseLike(value: unknown): value is { status: number; statusText: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'status' in value &&
    typeof (value as Record<string, unknown>).status === 'number'
  );
}

function hasResponseProperty(
  value: unknown
): value is { response: { status: number; statusText: string; data?: Record<string, unknown> } } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'response' in value &&
    isResponseLike((value as Record<string, unknown>).response)
  );
}

// =============================================================================
// RETRY UTILITIES
// =============================================================================

/**
 * Retry configuration.
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Initial delay in ms */
  initialDelay?: number;
  /** Maximum delay in ms */
  maxDelay?: number;
  /** Exponential backoff factor */
  backoffFactor?: number;
  /** Add jitter to delays */
  jitter?: boolean;
  /** Custom retry condition */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each retry */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
  shouldRetry: (error) => {
    const context = extractErrorContext(error);
    return isRetryableError(context.code);
  },
  onRetry: () => {},
};

/**
 * Execute an async operation with automatic retry.
 *
 * @example
 * ```tsx
 * const result = await withRetry(
 *   () => fetch('/api/data'),
 *   {
 *     maxRetries: 3,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms`);
 *     },
 *   }
 * );
 * ```
 */
export async function withRetry<T>(operation: () => Promise<T>, config?: RetryConfig): Promise<T> {
  const opts = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxRetries || !opts.shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = calculateDelay(attempt, opts);
      opts.onRetry(error, attempt + 1, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
function calculateDelay(attempt: number, config: Required<RetryConfig>): number {
  let delay = config.initialDelay * Math.pow(config.backoffFactor, attempt);
  delay = Math.min(delay, config.maxDelay);

  if (config.jitter) {
    // Add ±25% jitter
    delay = delay * (0.75 + Math.random() * 0.5);
  }

  return Math.round(delay);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// ERROR BOUNDARY HELPERS
// =============================================================================

/**
 * Check if error is a chunk load error (code splitting failure).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('loading chunk') ||
      message.includes('loading css chunk') ||
      message.includes('dynamically imported module')
    );
  }
  return false;
}

/**
 * Check if error is a session expiry error.
 */
export function isSessionExpiredError(error: unknown): boolean {
  const context = extractErrorContext(error);
  return context.code === 'AUTH_EXPIRED' || context.code === 'AUTH_REQUIRED';
}

/**
 * Create a handler for error boundary recovery.
 */
export function createErrorRecoveryHandler(options: {
  onChunkError?: () => void;
  onSessionExpired?: () => void;
  onNetworkError?: () => void;
  onGenericError?: (error: unknown) => void;
}): (error: unknown) => void {
  return (error: unknown) => {
    if (isChunkLoadError(error)) {
      options.onChunkError?.();
      return;
    }

    if (isSessionExpiredError(error)) {
      options.onSessionExpired?.();
      return;
    }

    if (isNetworkError(error)) {
      options.onNetworkError?.();
      return;
    }

    options.onGenericError?.(error);
  };
}
