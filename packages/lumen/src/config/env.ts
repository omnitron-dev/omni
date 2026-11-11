/**
 * Environment variable expansion for configuration values.
 * Interpolates ${VAR_NAME} expressions from process.env.
 */
export function expandEnvVariables<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key) => process.env[key] ?? '') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandEnvVariables(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = expandEnvVariables(v);
    }
    return res as unknown as T;
  }
  return value;
}
