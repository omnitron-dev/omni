import { ErrorCode } from './error-codes.js';
import type { ErrorOptions } from './error.js';

/** Decode numeric codes, decimal strings and the shared symbolic taxonomy. */
function numericCode(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (/^[1-9]\d*$/.test(value)) {
    const code = Number(value);
    return Number.isSafeInteger(code) ? code : undefined;
  }
  if (!Object.hasOwn(ErrorCode, value)) return undefined;
  const code = ErrorCode[value as keyof typeof ErrorCode];
  return typeof code === 'number' ? code : undefined;
}

/**
 * Shared HTTP error contract for server and browser clients. An application
 * code stays in details.errorCode; its numeric category comes from HTTP.
 * Malformed codes never become NaN or a successful HTTP status.
 */
export function decodeHttpError(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ErrorOptions {
  const outer = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const payload = outer.error && typeof outer.error === 'object'
    ? outer.error as Record<string, unknown> : outer;
  const decoded = numericCode(payload.code);
  const fallback = Number.isInteger(status) && status >= 400 && status < 600 ? status : ErrorCode.INTERNAL_ERROR;
  let details = payload.details ?? {};
  if (typeof payload.code === 'string' && decoded === undefined) {
    const fields = details && typeof details === 'object' ? details : {};
    if (!Object.hasOwn(fields, 'errorCode')) details = { ...fields, errorCode: payload.code };
  }
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    code: decoded ?? fallback,
    message: typeof payload.message === 'string' && payload.message ? payload.message : `HTTP ${status}`,
    details,
    requestId: normalizedHeaders['x-request-id'],
    correlationId: normalizedHeaders['x-correlation-id'],
    traceId: normalizedHeaders['x-trace-id'],
    spanId: normalizedHeaders['x-span-id'],
  };
}
