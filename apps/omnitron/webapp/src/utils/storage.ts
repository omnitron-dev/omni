/**
 * `localStorage`, for a browser that may refuse to have one.
 *
 * Every accessor here is wrapped, including the reads. That is not defensive
 * habit: `localStorage` is a getter on `window`, and in a browser configured
 * to block site data — Firefox's "block all cookies", Safari with storage
 * disabled, a page opened inside some embedded webviews — merely TOUCHING it
 * throws a `SecurityError`. It also throws on write when a quota is full,
 * which in a private window can be zero.
 *
 * The console read three keys at module scope, so in such a browser the
 * project store threw while being constructed, before any component
 * rendered. There is no error boundary above that: the operator gets a blank
 * page, and the reason is a preference they set months ago.
 *
 * None of what is kept here is worth failing over — an active project, a
 * remembered route, a theme. So every read has a fallback and every write is
 * best-effort.
 */

/** The stored string, or `null` when absent OR unreachable. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store a value; silently does nothing when storage is unavailable or full. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked or over quota. The session still works; it just will not be
    // remembered, and there is nothing the operator could do about it here.
  }
}

/** Remove a key; silently does nothing when storage is unavailable. */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // As above.
  }
}

/** Parse a stored JSON value, falling back when it is absent or corrupt. */
export function readStoredJson<T>(key: string, fallback: T): T {
  const raw = readStored(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Half-written by a tab that was closed mid-save, or written by an older
    // version with a different shape. A fallback beats a crash.
    return fallback;
  }
}

/** Store a value as JSON; best-effort, like `writeStored`. */
export function writeStoredJson(key: string, value: unknown): void {
  try {
    writeStored(key, JSON.stringify(value));
  } catch {
    // `JSON.stringify` throws on a circular structure or a BigInt.
  }
}
