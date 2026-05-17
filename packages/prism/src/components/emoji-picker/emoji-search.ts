/**
 * Tiny in-memory emoji search.
 *
 * We don't want to ship a fuzzy-match library just for an 1800-entry
 * dataset — the user's query is typically 1-6 characters and a single
 * pre-built blob ("name + keywords") per entry gives us ~50 µs total
 * per keystroke at this size.
 *
 * Scoring rules (high → low):
 *   - exact match against the emoji label → 1000
 *   - any keyword equals the query        → 900
 *   - label starts with the query         → 800
 *   - any keyword starts with the query   → 700
 *   - label / keyword contains the query  → 500
 * Anything else is filtered out.
 *
 * Sort is by score desc, then by dataset order (stable input order
 * already matches emojibase's canonical ordering).
 */

import type { EmojiEntry } from './types.js';

interface ScoredEntry {
  entry: EmojiEntry;
  score: number;
  order: number;
}

export function searchEmojis(
  entries: EmojiEntry[],
  searchTokens: string[],
  rawQuery: string,
): EmojiEntry[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return entries;

  const out: ScoredEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const blob = searchTokens[i] ?? '';
    const score = scoreEntry(entry, blob, query);
    if (score > 0) out.push({ entry, score, order: i });
  }

  out.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.order - b.order;
  });

  return out.map((x) => x.entry);
}

function scoreEntry(entry: EmojiEntry, blob: string, query: string): number {
  const label = entry.n.toLowerCase();
  if (label === query) return 1000;
  if (entry.k.some((k) => k === query)) return 900;
  if (label.startsWith(query)) return 800;
  if (entry.k.some((k) => k.startsWith(query))) return 700;
  if (blob.includes(query)) return 500;
  return 0;
}
