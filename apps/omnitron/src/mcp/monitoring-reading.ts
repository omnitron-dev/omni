import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';

/** A failed source stays unknown. A partial diagnostic answer never means healthy. */
export async function monitoringReading(
  sources: Record<string, () => Promise<unknown>>,
  maxBytes = 64 * 1024,
  deadlineMs = 5000
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 1024 * 1024 ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 30000
  )
    throw new Error('Invalid monitoring response budget');
  const startedAt = new Date().toISOString();
  const entries = await Promise.all(
    Object.entries(sources).map(async ([name, read]) => {
      const start = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Bound the diagnostic answer. Underlying RPC cancellation remains transport-owned.
        const value = await Promise.race([
          Promise.resolve().then(read),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Source did not respond before the diagnostic deadline')),
              deadlineMs
            );
          }),
        ]);
        const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
        return [
          name,
          bytes <= maxBytes
            ? { status: 'available', collectedAt: new Date().toISOString(), durationMs: Date.now() - start, value }
            : {
                status: 'limited',
                collectedAt: new Date().toISOString(),
                durationMs: Date.now() - start,
                bytes,
                reason: 'Response exceeds the diagnostic budget; query a narrower scope',
              },
        ] as const;
      } catch (error) {
        return [
          name,
          {
            status: 'unavailable',
            collectedAt: new Date().toISOString(),
            durationMs: Date.now() - start,
            error: redactDiagnosticText(error instanceof Error ? error.message : String(error)),
          },
        ] as const;
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    state: entries.every(([, value]) => value.status === 'available') ? 'complete' : 'partial',
    sources: Object.fromEntries(entries),
    note: 'Collection times are not source freshness. Missing or limited sources are unknown; inspect ingestion loss and source timestamps.',
  };
}

/** A bounded metrics request goes to Titan's existing store; no parallel analytics database. */
export function metricsWindow(input: Record<string, unknown>, now = Date.now()) {
  const names = input['names'],
    apps = input['apps'];
  for (const [key, values] of [
    ['names', names],
    ['apps', apps],
  ] as const)
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 8 ||
      values.some((v) => typeof v !== 'string' || !v || v.length > 256)
    )
      throw new Error(`${key} requires 1–8 explicit identifiers`);
  const from = input['from'] === undefined ? now - 3600000 : Date.parse(String(input['from']));
  const to = input['to'] === undefined ? now : Date.parse(String(input['to']));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 86400000)
    throw new Error('Metrics window must be positive and at most 24 hours');
  const interval = input['interval'] ?? '1m';
  if (!['1m', '5m', '15m', '1h'].includes(String(interval))) throw new Error('Use a 1m, 5m, 15m or 1h interval');
  const limit = input['limit'] ?? 1000;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Metrics limit must be 1–1000');
  return { names: names as string[], apps: apps as string[], from, to, interval: String(interval), limit };
}
