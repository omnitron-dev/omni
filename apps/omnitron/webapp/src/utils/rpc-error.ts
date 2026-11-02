/**
 * Pull an HTTP status out of the several shapes a Netron error can take.
 *
 * The daemon sends `"code": "401"` as a STRING. One client path already
 * parses it (`http/peer.ts` coerces before building a TitanError); the other
 * (`http/client.ts`, which wraps the raw response in `NetronErrors
 * .invalidResponse({ error: response.error })`) does not. This accepted
 * numbers only, so on the second path an expired session produced no
 * redirect at all — the console stayed on a page whose every request was
 * being refused, which is the symptom the middleware above exists to remove.
 *
 * Numeric strings are accepted, and only those: `Number('')` is 0 and
 * `Number(null)` is 0, either of which would turn a missing code into a
 * status of zero.
 */
export function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, any>;
  const candidates = [
    e['status'],
    e['statusCode'],
    e['code'],
    e['response']?.status,
    e['data']?.code,
    // `NetronErrors.invalidResponse` parks the server's payload one level in.
    e['details']?.['error']?.code,
    e['data']?.['error']?.code,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) return Number(candidate);
  }
  return undefined;
}

/** A transport deadline is not evidence that the remote operation failed. */
export function isRpcTimeout(err: unknown): boolean {
  const status = errorStatus(err);
  if (status === 408 || status === 504 || (err as { code?: unknown } | null)?.code === 'TIMEOUT') return true;
  return /\bRequest timeout after \d+ms\b|^HTTP (?:408|504)\b|^Gateway Time-?out\b/i.test((err as Error | null)?.message ?? '');
}
