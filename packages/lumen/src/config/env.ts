import { isValidElementType } from 'react-is';

/**
 * Environment variable expansion for configuration values.
 * Interpolates ${VAR_NAME} expressions from process.env.
 */
export function expandEnvVariables<T>(value: T): T {
  const ancestors = new Set<object>();
  const expand = (input: unknown): unknown => {
    if (typeof input === 'string') {
      return input.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? '');
    }
    if (input === null || typeof input !== 'object' || isValidElementType(input)) return input;
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) return input;
    if (ancestors.has(input)) throw new TypeError('Lumen configuration contains a cycle');
    ancestors.add(input);
    try {
      return Array.isArray(input) ? input.map(expand)
        : Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, expand(entry)]));
    } finally { ancestors.delete(input); }
  };
  return expand(value) as T;
}
