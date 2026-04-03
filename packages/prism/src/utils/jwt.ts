/**
 * JWT Utilities
 *
 * Client-side JWT decoding and validation utilities.
 * These utilities do NOT verify signatures - they only decode and check expiration.
 * For signature verification, use server-side libraries.
 *
 * @module @omnitron/prism/utils
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Standard JWT claims.
 * @see https://datatracker.ietf.org/doc/html/rfc7519#section-4.1
 */
export interface JwtStandardClaims {
  /** Issuer */
  iss?: string;
  /** Subject */
  sub?: string;
  /** Audience */
  aud?: string | string[];
  /** Expiration time (Unix timestamp in seconds) */
  exp?: number;
  /** Not before (Unix timestamp in seconds) */
  nbf?: number;
  /** Issued at (Unix timestamp in seconds) */
  iat?: number;
  /** JWT ID */
  jti?: string;
}

/**
 * JWT payload with custom claims.
 * Extends standard claims with any additional properties.
 */
export interface JwtPayload extends JwtStandardClaims {
  /** User ID (common custom claim) */
  userId?: string;
  /** Email (common custom claim) */
  email?: string;
  /** Roles (common custom claim) */
  roles?: string[];
  /** Permissions (common custom claim) */
  permissions?: string[];
  /** Any additional custom claims */
  [key: string]: unknown;
}

/**
 * JWT validation options.
 */
export interface JwtValidationOptions {
  /** Clock skew tolerance in seconds (default: 60) */
  clockTolerance?: number;
  /** Require expiration claim (default: true) */
  requireExp?: boolean;
}

/**
 * JWT decode result.
 */
export interface JwtDecodeResult<T extends JwtPayload = JwtPayload> {
  /** Decoded header */
  header: {
    alg: string;
    typ?: string;
    [key: string]: unknown;
  };
  /** Decoded payload */
  payload: T;
  /** Original signature (base64url encoded, NOT verified) */
  signature: string;
}

// =============================================================================
// DECODE FUNCTIONS
// =============================================================================

/**
 * Decode a base64url string to a regular string.
 * Handles URL-safe base64 encoding used in JWTs.
 */
function base64UrlDecode(str: string): string {
  // Replace URL-safe characters with standard base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if necessary
  const padding = base64.length % 4;
  const paddedBase64 = padding ? base64 + '='.repeat(4 - padding) : base64;

  // Decode
  try {
    return atob(paddedBase64);
  } catch {
    throw new Error('Invalid base64url encoding');
  }
}

/**
 * Decode a JWT token without verifying the signature.
 *
 * ⚠️ WARNING: This function does NOT verify the signature.
 * Only use for client-side display purposes. Never trust decoded
 * data for authorization decisions without server-side verification.
 *
 * @param token - The JWT token string
 * @returns Decoded JWT parts (header, payload, signature)
 * @throws Error if the token is malformed
 *
 * @example
 * ```tsx
 * const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
 *
 * try {
 *   const { header, payload } = jwtDecode(token);
 *   console.log('Algorithm:', header.alg);
 *   console.log('User ID:', payload.sub);
 *   console.log('Expires:', new Date(payload.exp! * 1000));
 * } catch (error) {
 *   console.error('Invalid token:', error.message);
 * }
 * ```
 */
export function jwtDecode<T extends JwtPayload = JwtPayload>(token: string): JwtDecodeResult<T> {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }

  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid token format: expected 3 parts separated by dots');
  }

  const [headerPart, payloadPart, signaturePart] = parts;

  try {
    const headerJson = base64UrlDecode(headerPart);
    const payloadJson = base64UrlDecode(payloadPart);

    const header = JSON.parse(headerJson);
    const payload = JSON.parse(payloadJson) as T;

    return {
      header,
      payload,
      signature: signaturePart,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid token: malformed JSON in header or payload', { cause: error });
    }
    throw error;
  }
}

/**
 * Decode only the payload from a JWT token.
 * Convenience function when you only need the claims.
 *
 * @param token - The JWT token string
 * @returns Decoded payload
 * @throws Error if the token is malformed
 *
 * @example
 * ```tsx
 * const payload = jwtDecodePayload(token);
 * console.log('User:', payload.email);
 * ```
 */
export function jwtDecodePayload<T extends JwtPayload = JwtPayload>(token: string): T {
  return jwtDecode<T>(token).payload;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Check if a JWT token is expired.
 *
 * @param token - The JWT token string
 * @param options - Validation options
 * @returns true if the token is expired or invalid, false if still valid
 *
 * @example
 * ```tsx
 * if (isTokenExpired(token)) {
 *   // Redirect to login or refresh token
 *   refreshAccessToken();
 * }
 * ```
 */
export function isTokenExpired(token: string, options: JwtValidationOptions = {}): boolean {
  const { clockTolerance = 60, requireExp = true } = options;

  try {
    const { payload } = jwtDecode(token);

    // Check if exp claim exists
    if (payload.exp === undefined) {
      // If exp is not required, token is considered valid
      return requireExp;
    }

    // Check expiration with clock tolerance
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp < currentTime - clockTolerance;
  } catch {
    // If token can't be decoded, consider it expired/invalid
    return true;
  }
}

/**
 * Check if a JWT token is valid (not expired, not before nbf).
 *
 * @param token - The JWT token string
 * @param options - Validation options
 * @returns true if the token is valid, false otherwise
 *
 * @example
 * ```tsx
 * function AuthProvider({ children }) {
 *   const [token] = useLocalStorage('accessToken');
 *
 *   if (!token || !isValidToken(token)) {
 *     return <Navigate to="/login" />;
 *   }
 *
 *   return children;
 * }
 * ```
 */
export function isValidToken(token: string, options: JwtValidationOptions = {}): boolean {
  const { clockTolerance = 60, requireExp = true } = options;

  try {
    const { payload } = jwtDecode(token);

    const currentTime = Math.floor(Date.now() / 1000);

    // Check expiration
    if (payload.exp !== undefined) {
      if (payload.exp < currentTime - clockTolerance) {
        return false;
      }
    } else if (requireExp) {
      // exp is required but missing
      return false;
    }

    // Check not-before
    if (payload.nbf !== undefined) {
      if (payload.nbf > currentTime + clockTolerance) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get time until token expires in seconds.
 * Returns 0 if token is already expired or invalid.
 *
 * @param token - The JWT token string
 * @returns Seconds until expiration, or 0 if expired/invalid
 *
 * @example
 * ```tsx
 * const secondsLeft = getTokenTimeLeft(token);
 *
 * if (secondsLeft < 300) {
 *   // Less than 5 minutes left, refresh proactively
 *   refreshToken();
 * }
 * ```
 */
export function getTokenTimeLeft(token: string): number {
  try {
    const { payload } = jwtDecode(token);

    if (payload.exp === undefined) {
      return Infinity;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const timeLeft = payload.exp - currentTime;

    return timeLeft > 0 ? timeLeft : 0;
  } catch {
    return 0;
  }
}

/**
 * Get expiration date from token.
 *
 * @param token - The JWT token string
 * @returns Date object for expiration, or null if no exp claim or invalid token
 *
 * @example
 * ```tsx
 * const expiresAt = getTokenExpirationDate(token);
 * if (expiresAt) {
 *   console.log('Token expires:', expiresAt.toLocaleString());
 * }
 * ```
 */
export function getTokenExpirationDate(token: string): Date | null {
  try {
    const { payload } = jwtDecode(token);

    if (payload.exp === undefined) {
      return null;
    }

    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}

// =============================================================================
// CLAIM EXTRACTION HELPERS
// =============================================================================

/**
 * Safely get a claim from a token.
 *
 * @param token - The JWT token string
 * @param claim - The claim name to extract
 * @returns The claim value or undefined if not present/invalid
 *
 * @example
 * ```tsx
 * const userId = getTokenClaim(token, 'sub');
 * const roles = getTokenClaim<string[]>(token, 'roles') ?? [];
 * ```
 */
export function getTokenClaim<T>(token: string, claim: string): T | undefined {
  try {
    const { payload } = jwtDecode(token);
    return payload[claim] as T;
  } catch {
    return undefined;
  }
}

/**
 * Get the subject (user identifier) from a token.
 *
 * @param token - The JWT token string
 * @returns The subject claim or undefined
 */
export function getTokenSubject(token: string): string | undefined {
  return getTokenClaim<string>(token, 'sub');
}

/**
 * Check if token has a specific role.
 *
 * @param token - The JWT token string
 * @param role - The role to check for
 * @param rolesKey - The key in the payload containing roles (default: 'roles')
 * @returns true if the token contains the role
 *
 * @example
 * ```tsx
 * if (tokenHasRole(token, 'admin')) {
 *   // Show admin features
 * }
 * ```
 */
export function tokenHasRole(token: string, role: string, rolesKey = 'roles'): boolean {
  const roles = getTokenClaim<string[]>(token, rolesKey);
  return Array.isArray(roles) && roles.includes(role);
}

/**
 * Check if token has a specific permission.
 *
 * @param token - The JWT token string
 * @param permission - The permission to check for
 * @param permissionsKey - The key in the payload containing permissions (default: 'permissions')
 * @returns true if the token contains the permission
 */
export function tokenHasPermission(token: string, permission: string, permissionsKey = 'permissions'): boolean {
  const permissions = getTokenClaim<string[]>(token, permissionsKey);
  return Array.isArray(permissions) && permissions.includes(permission);
}
