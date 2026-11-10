/** In-memory counterpart of the state store's atomic KV transactions. */
export function vaultStore(seed: Record<string, unknown> = {}) {
  const rows = new Map<string, unknown>(Object.entries(seed));
  const read = (key: string) => rows.get(key) ?? null;
  return {
    rows,
    kvGet: async (key: string) => read(key),
    kvGetSync: read,
    kvSet: async (key: string, value: unknown) => { rows.set(key, value); },
    kvUpdateSync: (key: string, update: (value: unknown) => unknown) => {
      const next = update(read(key));
      rows.set(key, next);
      return next;
    },
  };
}
