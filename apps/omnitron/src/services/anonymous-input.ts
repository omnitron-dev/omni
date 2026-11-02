/** Validate untrusted authentication payloads before reading their fields. */
import { Errors } from '@omnitron-dev/titan/errors';

/** Assert `value` is a plain object, for a handler that takes one. */
export function requirePayload(value: unknown, method: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw Errors.badRequest(`${method}: expected an object payload`);
  }
  return value as Record<string, unknown>;
}

/** Assert a required non-empty string field. */
export function requireString(payload: Record<string, unknown>, field: string, method: string): string {
  const v = payload[field];
  if (typeof v !== 'string' || v.length === 0) {
    throw Errors.badRequest(`${method}: '${field}' must be a non-empty string`);
  }
  return v;
}
