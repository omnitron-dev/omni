/**
 * Module-level cached loader for the bundled emoji dataset.
 *
 * The JSON ships inside the `components/emoji-picker` chunk (see
 * `tsup.config.ts`). Apps that lazy-load this chunk (via React.lazy /
 * dynamic import) pay zero until the picker mounts — that's the
 * intended pattern documented in this component's README.
 *
 * Once the chunk is loaded, parsing the JSON is synchronous and
 * memoised here so a second `<EmojiPicker>` mount in the same session
 * reuses the indexed structures rather than rebuilding the search
 * blob (~1900 string concatenations).
 */

import { useMemo } from 'react';
import dataset from './data/emoji-data.json';
import type { EmojiDataset, EmojiEntry } from './types.js';

interface LoadedData {
  dataset: EmojiDataset;
  indexById: Map<string, EmojiEntry>;
  /** Lower-cased "name + keywords" string per emoji, in dataset order. */
  searchTokens: string[];
}

let cached: LoadedData | null = null;

function buildIndex(): LoadedData {
  if (cached) return cached;
  const ds = dataset as unknown as EmojiDataset;
  const indexById = new Map<string, EmojiEntry>();
  const searchTokens: string[] = new Array(ds.emojis.length);
  for (let i = 0; i < ds.emojis.length; i++) {
    const entry = ds.emojis[i]!;
    indexById.set(entry.i, entry);
    searchTokens[i] = `${entry.n} ${entry.k.join(' ')}`.toLowerCase();
  }
  cached = { dataset: ds, indexById, searchTokens };
  return cached;
}

export function useEmojiData(): { data: LoadedData | null; error: Error | null } {
  // useMemo isolates the synchronous indexing cost to the first mount
  // per session — every subsequent mount just reads the cached
  // structures. The hook still exposes the `data: null` branch so the
  // picker has a clean skeleton path even though, in practice, the
  // bundled JSON resolves synchronously after the chunk has loaded.
  const data = useMemo(() => {
    try {
      return buildIndex();
    } catch {
      return null;
    }
  }, []);
  return { data, error: null };
}
