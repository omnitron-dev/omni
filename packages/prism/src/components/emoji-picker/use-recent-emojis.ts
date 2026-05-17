/**
 * Persists the user's recently-picked emojis in localStorage.
 *
 * Storage key is namespaced so multiple apps consuming prism don't
 * step on each other's MRU lists. Values are stored as a JSON array of
 * `id` strings (hexcode + optional tone suffix) — the picker
 * re-resolves to the full emoji entry at render time via the dataset
 * index, so we don't keep stale labels around if the dataset bumps.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'prism.emoji.recent.v1';
const HARD_LIMIT = 32;

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string').slice(0, HARD_LIMIT) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, HARD_LIMIT)));
  } catch {
    /* quota / privacy mode — fail silently */
  }
}

export interface UseRecentEmojis {
  recent: string[];
  push: (id: string) => void;
  clear: () => void;
}

export function useRecentEmojis(limit: number = 16): UseRecentEmojis {
  const [recent, setRecent] = useState<string[]>(() => read().slice(0, limit));

  // Keep the in-memory snapshot in sync with localStorage changes from
  // other tabs.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setRecent(read().slice(0, limit));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [limit]);

  const push = useCallback(
    (id: string) => {
      setRecent((prev) => {
        const next = [id, ...prev.filter((x) => x !== id)].slice(0, limit);
        // Persist the wider window (HARD_LIMIT) so we don't truncate
        // on shrink and lose entries the user would otherwise see if
        // they expand the slot.
        const full = [id, ...read().filter((x) => x !== id)].slice(0, HARD_LIMIT);
        write(full);
        return next;
      });
    },
    [limit],
  );

  const clear = useCallback(() => {
    setRecent([]);
    write([]);
  }, []);

  return { recent, push, clear };
}
