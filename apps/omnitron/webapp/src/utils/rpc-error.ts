/** A transport deadline is not evidence that the remote operation failed. */
export function isRpcTimeout(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'TIMEOUT' || code === 408) return true;
  return /\bRequest timeout after \d+ms\b/.test((err as Error | null)?.message ?? '');
}
