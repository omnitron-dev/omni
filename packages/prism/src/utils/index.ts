/**
 * Prism Utilities
 *
 * Common utility functions for formatting, string manipulation,
 * class name handling, refs, URLs, and number input handling.
 *
 * @module @omnitron/prism/utils
 */

// =============================================================================
// CLASS NAME UTILITIES
// =============================================================================

export { cn, mergeClasses, type ClassValue, type StateProps } from './cn.js';

export {
  createClasses,
  createClassesObject,
  createComponentClasses,
  setClassPrefix,
  getClassPrefix,
  DEFAULT_CLASS_PREFIX,
} from './create-classes.js';

// =============================================================================
// REF UTILITIES
// =============================================================================

export { mergeRefs, setRef, hasRefValue, type MergeableRef } from './refs.js';

// =============================================================================
// NUMBER FORMATTING
// =============================================================================

export {
  // Formatting
  fNumber,
  fCurrency,
  fPercent,
  fShortenNumber,
  fBytes,
  fOrdinal,
  fDecimal,
  fNumberWithSign,
  fCompact,
  // Calculations
  getPercentage,
  calculatePercentageChange,
  getCurrencySymbol,
  // Types
  type FormatNumberOptions,
  type FormatCurrencyOptions,
} from './format-number.js';

// =============================================================================
// NUMBER INPUT TRANSFORM
// =============================================================================

export {
  parseNumber,
  clampNumber,
  roundToDecimals,
  transformOnChange,
  transformOnBlur,
  transformForDisplay,
  createNumberInputHandlers,
  type TransformNumberOptions,
} from './transform-number.js';

// =============================================================================
// DATE FORMATTING
// =============================================================================

export {
  // Formatting
  fDate,
  fDateTime,
  fTime,
  fDateISO,
  fRelativeTime,
  fDuration,
  // Predicates
  isToday,
  isYesterday,
  isThisWeek,
  isPast,
  isFuture,
  // Calculations
  diffInDays,
  // Date ranges (Aurora pattern)
  getDates,
  getPastDates,
  getFutureDates,
  // Date manipulation
  startOfDay,
  endOfDay,
  addDays,
  addMonths,
  // Types
  type DateInput,
  type FormatDateOptions,
  type DateDurationPreset,
} from './format-date.js';

// =============================================================================
// STRING UTILITIES
// =============================================================================

export {
  // Text formatting
  truncate,
  getInitials,
  capitalize,
  titleCase,
  kebabCase,
  camelCase,
  snakeCase,
  // Search & highlight
  highlightText,
  escapeRegExp,
  containsIgnoreCase,
  // Validation
  isBlank,
  isEmail,
  isUrl,
  // Generation
  randomString,
  uuid,
  slugify,
} from './string.js';

// =============================================================================
// URL UTILITIES
// =============================================================================

export {
  safeReturnUrl,
  isActiveLink,
  isExternalUrl,
  isExternalLink,
  isEqualPath,
  buildUrl,
  parseQueryParams,
  getQueryParam,
  hasParams,
  removeParams,
  removeLastSlash,
  type SafeReturnUrlOptions,
} from './url.js';

// =============================================================================
// COOKIE UTILITIES
// =============================================================================

export { getCookie, setCookie, removeCookie, cookiesAvailable, type CookieOptions } from './cookies.js';

// =============================================================================
// STORAGE UTILITIES (localStorage/sessionStorage)
// =============================================================================

export {
  // Availability checks
  localStorageAvailable,
  sessionStorageAvailable,
  // CRUD operations
  getStorage,
  setStorage,
  removeStorage,
  clearStorage,
  // Utilities
  getStorageKeys,
  getStorageSize,
  // Expiring storage
  setStorageWithExpiry,
  getStorageWithExpiry,
  // Types
  type StorageOptions,
  type StorageWithExpiryOptions,
} from './storage.js';

// =============================================================================
// FONT UTILITIES
// =============================================================================

export { setFont, remToPx, pxToRem, responsiveFontSize } from './font.js';

// =============================================================================
// OBJECT UTILITIES
// =============================================================================

export { hasKeys, omit, pick, deepClone, isEmpty } from './object.js';

// =============================================================================
// RTL (RIGHT-TO-LEFT) UTILITIES
// =============================================================================

export { noRtlFlip, isRtlDirection, getDirectionalProperty } from './rtl.js';

// =============================================================================
// ASYNC LOCK (Race Condition Prevention)
// =============================================================================

export {
  AsyncLock,
  AsyncLockTimeoutError,
  createAsyncLock,
  createTokenRefreshLock,
  withLock,
  locked,
  type AsyncLockOptions,
  type AsyncLockResult,
  type AsyncLockState,
} from './async-lock.js';

// =============================================================================
// ERROR HANDLING (i18n-ready)
// =============================================================================

export {
  // Classification
  classifyHttpError,
  isNetworkError,
  isRetryableError,
  getErrorSeverity,
  // Translation
  createErrorTranslator,
  DEFAULT_ERROR_MESSAGES,
  // Extraction
  extractErrorContext,
  // Retry
  withRetry,
  // Error boundary helpers
  isChunkLoadError,
  isSessionExpiredError,
  createErrorRecoveryHandler,
  // Types
  type ErrorCode,
  type ErrorSeverity,
  type ErrorContext,
  type TranslatedError,
  type TranslateFn,
  type ErrorMessages,
  type RetryConfig,
} from './errors.js';

// =============================================================================
// FETCH INTERCEPTOR (HTTP Client Factory)
// =============================================================================

export {
  // Factory functions
  createFetchClient,
  createTokenRefreshInterceptor,
  createJsonApiClient,
  // Types
  type FetchRequestInit,
  type RequestContext,
  type ResponseContext,
  type ErrorContext as FetchErrorContext,
  type RequestInterceptor,
  type ResponseInterceptor,
  type ErrorInterceptor,
  type FetchInterceptorConfig,
  type TokenRefreshConfig,
  type FetchClient,
} from './fetch-interceptor.js';

// =============================================================================
// JWT UTILITIES (Token Decode & Validation)
// =============================================================================

export {
  // Decode functions
  jwtDecode,
  jwtDecodePayload,
  // Validation functions
  isTokenExpired,
  isValidToken,
  getTokenTimeLeft,
  getTokenExpirationDate,
  // Claim helpers
  getTokenClaim,
  getTokenSubject,
  tokenHasRole,
  tokenHasPermission,
  // Types
  type JwtStandardClaims,
  type JwtPayload,
  type JwtValidationOptions,
  type JwtDecodeResult,
} from './jwt.js';

// =============================================================================
// TEMPLATE RESOLVER
// =============================================================================

export { resolveTemplateVariables } from './template-resolver.js';
