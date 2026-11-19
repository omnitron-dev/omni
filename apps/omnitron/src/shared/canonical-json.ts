/** Stable object keys retain the order of arrays in JSON wire requests and content revisions. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_name, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );
}
