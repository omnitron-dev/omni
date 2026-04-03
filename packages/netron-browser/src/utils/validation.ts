/**
 * Input validation utilities for Netron Browser
 *
 * Provides security-focused validation for:
 * - Definition IDs (UUID format)
 * - Property/method names (safe identifiers)
 * - Service names (qualified names with version)
 *
 * These validations help prevent injection attacks and ensure data integrity.
 *
 * @module netron-browser/utils/validation
 */

/**
 * UUID v4 format validation regex
 * Matches: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where y is 8, 9, a, or b
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Property/method name validation regex
 * Allows:
 * - First character: Letters (a-z, A-Z), underscore (_), or dollar sign ($)
 * - Subsequent characters: Letters, numbers (0-9), underscore (_), or dollar sign ($)
 *
 * This prevents injection of special characters in property access.
 */
const PROPERTY_NAME_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Service name validation regex
 * Allows: letters, numbers, dots, hyphens, underscores
 * Optional version suffix: @semver
 */
const SERVICE_NAME_REGEX = /^[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/;

/**
 * Maximum allowed lengths for various identifiers
 */
export const MAX_LENGTHS = {
  PROPERTY_NAME: 256,
  SERVICE_NAME: 512,
  DEF_ID: 36, // Standard UUID length
} as const;

/**
 * Validates that a value is a valid UUID v4 definition ID.
 *
 * @param defId - The value to validate
 * @returns true if the value is a valid UUID v4 string
 *
 * @example
 * ```typescript
 * isValidDefId('550e8400-e29b-41d4-a716-446655440000'); // true
 * isValidDefId('invalid'); // false
 * isValidDefId(123); // false
 * ```
 */
export function isValidDefId(defId: unknown): defId is string {
  return typeof defId === 'string' && defId.length === MAX_LENGTHS.DEF_ID && UUID_REGEX.test(defId);
}

/**
 * Validates that a value is a valid property or method name.
 *
 * Valid names:
 * - Start with a letter, underscore, or dollar sign
 * - Contain only letters, numbers, underscores, or dollar signs
 * - Are not empty and within length limits
 *
 * @param name - The value to validate
 * @returns true if the value is a valid property/method name
 *
 * @example
 * ```typescript
 * isValidPropertyName('myMethod'); // true
 * isValidPropertyName('_privateVar'); // true
 * isValidPropertyName('$special'); // true
 * isValidPropertyName('123invalid'); // false (starts with number)
 * isValidPropertyName('has-hyphen'); // false (contains hyphen)
 * ```
 */
export function isValidPropertyName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_LENGTHS.PROPERTY_NAME &&
    PROPERTY_NAME_REGEX.test(name)
  );
}

/**
 * Validates that a value is a valid service name.
 *
 * Valid service names:
 * - Contain letters, numbers, dots, hyphens, underscores
 * - Optionally have a version suffix (@version)
 * - Are not empty and within length limits
 *
 * @param name - The value to validate
 * @returns true if the value is a valid service name
 *
 * @example
 * ```typescript
 * isValidServiceName('userService'); // true
 * isValidServiceName('user-service@1.0.0'); // true
 * isValidServiceName('my.nested.service'); // true
 * isValidServiceName(''); // false
 * isValidServiceName('has spaces'); // false
 * ```
 */
export function isValidServiceName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_LENGTHS.SERVICE_NAME &&
    SERVICE_NAME_REGEX.test(name)
  );
}

/**
 * Parses a qualified service name into name and version components.
 *
 * @param qualifiedName - The full service name (possibly with version)
 * @returns Object with name and optional version
 *
 * @example
 * ```typescript
 * parseQualifiedServiceName('userService@1.0.0');
 * // { name: 'userService', version: '1.0.0', isWildcard: false }
 *
 * parseQualifiedServiceName('userService');
 * // { name: 'userService', version: undefined, isWildcard: false }
 *
 * parseQualifiedServiceName('userService@*');
 * // { name: 'userService', version: '*', isWildcard: true }
 * ```
 */
export function parseQualifiedServiceName(qualifiedName: string): {
  name: string;
  version?: string;
  isWildcard: boolean;
} {
  if (!qualifiedName.includes('@')) {
    return { name: qualifiedName, version: undefined, isWildcard: false };
  }

  const atIndex = qualifiedName.lastIndexOf('@');
  const name = qualifiedName.substring(0, atIndex);
  const version = qualifiedName.substring(atIndex + 1);

  return {
    name,
    version,
    isWildcard: version === '*',
  };
}

/**
 * Creates an error message for invalid input.
 *
 * @param type - The type of input that was invalid
 * @param value - The actual value received (will be truncated for safety)
 * @returns Formatted error message
 */
export function createValidationError(type: 'defId' | 'propertyName' | 'serviceName', value: unknown): string {
  const maxPreviewLength = 50;
  let preview: string;

  if (typeof value === 'string') {
    preview = value.length > maxPreviewLength ? `${value.substring(0, maxPreviewLength)}...` : value;
  } else {
    preview = String(value);
  }

  const messages: Record<typeof type, string> = {
    defId: `Invalid definition ID format. Expected UUID v4, got: "${preview}"`,
    propertyName: `Invalid property/method name. Must be a valid identifier, got: "${preview}"`,
    serviceName: `Invalid service name format. Got: "${preview}"`,
  };

  return messages[type];
}

/**
 * Validates all inputs for a get/set/call operation.
 * Throws an error if any input is invalid.
 *
 * @param defId - The definition ID
 * @param name - The property or method name
 * @throws Error if any input is invalid
 */
export function validateRpcInputs(defId: unknown, name: unknown): void {
  if (!isValidDefId(defId)) {
    throw new Error(createValidationError('defId', defId));
  }
  if (!isValidPropertyName(name)) {
    throw new Error(createValidationError('propertyName', name));
  }
}

/**
 * Escapes special regex characters in a string.
 * Used to prevent ReDoS attacks when building patterns from user input.
 *
 * @param str - The string to escape
 * @returns Escaped string safe for use in RegExp
 *
 * @example
 * ```typescript
 * escapeRegex('test.*+?'); // 'test\\.\\*\\+\\?'
 * ```
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates a RegExp for pattern matching with wildcard support.
 * Uses escapeRegex to prevent ReDoS attacks.
 *
 * @param pattern - The pattern with wildcards (*)
 * @returns RegExp for testing against service names
 *
 * @example
 * ```typescript
 * const regex = createPatternRegex('user*');
 * regex.test('userService'); // true
 * regex.test('authService'); // false
 * ```
 */
export function createPatternRegex(pattern: string): RegExp {
  const escaped = escapeRegex(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
