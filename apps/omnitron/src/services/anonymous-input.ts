/**
 * Shape checks for the daemon's anonymous RPC surface.
 *
 * `@Public({ auth: { allowAnonymous: true } })` is worn by exactly seven
 * handlers: the five on `OmnitronAuth`, `OmnitronFleet.heartbeat` and
 * `OmnitronTelemetry.pushBatch`. They are the only methods an unauthenticated
 * caller can reach — probing all 122 daemon methods without a token returns
 * 401 or 404 for every other one.
 *
 * None of them looked at what it was given. `signIn(undefined)` destructured
 * `{ username }` off nothing and the caller got a 500 carrying
 * `Cannot destructure property 'username' of 'request'` — our fault reported
 * for their malformed request, a stack-shaped string handed to someone who
 * has not authenticated, and noise in the log that looks like a daemon defect.
 *
 * These say 400 and name the field instead. They are deliberately small: the
 * point is that the handler behind them never sees a shape it cannot read,
 * not to re-validate what the service itself enforces.
 */

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

/** Assert a required array field. */
export function requireArray(payload: Record<string, unknown>, field: string, method: string): unknown[] {
  const v = payload[field];
  if (!Array.isArray(v)) {
    throw Errors.badRequest(`${method}: '${field}' must be an array`);
  }
  return v;
}
