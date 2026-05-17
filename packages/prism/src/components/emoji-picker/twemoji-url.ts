/**
 * Map a unicode emoji string to the Twemoji SVG URL on jsDelivr.
 *
 * Twitter's twemoji project ships one SVG per emoji codepoint sequence
 * (e.g. `1f44d.svg`, `1f1ea-1f1fa.svg`). We don't bundle the SVGs — the
 * CDN already does, and the browser caches them per session, so the
 * net cost is one HTTP/2-multiplexed request per unique emoji.
 *
 * The dataset's `i` field already gives us the canonical hex sequence,
 * but we also accept a raw unicode string so the standalone `<Emoji>`
 * component doesn't need a lookup just to render an arbitrary glyph
 * (e.g. when it comes back from the backend as a stored reaction).
 *
 * Implementation notes:
 *   - Skip the variation-selector codepoint U+FE0F when present. Twemoji
 *     filenames omit it (e.g. `2764.svg` not `2764-fe0f.svg`). This is
 *     the most common reason a "valid" emoji shows the broken-image
 *     icon if you mirror unicode naïvely.
 *   - Skip the zero-width joiner only at the end of a sequence (it's
 *     significant in ZWJ sequences and must stay between codepoints).
 */

const VARIATION_SELECTOR = 0xfe0f;

/** Twemoji asset base — jsdelivr CDN, twitter/twemoji@latest. */
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg';

/** Pre-built hexcode → URL form for the dataset's `i` field. */
export function twemojiUrlFromHex(hexcode: string): string {
  // Lower-case + ensure no FE0F suffix.
  const parts = hexcode
    .toLowerCase()
    .split('-')
    .filter((cp) => cp !== 'fe0f');
  return `${TWEMOJI_BASE}/${parts.join('-')}.svg`;
}

/** Twemoji URL derived from a raw unicode string (e.g. "👍" or "👍🏻"). */
export function twemojiUrlFromNative(native: string): string {
  const codepoints: number[] = [];
  for (const ch of native) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === VARIATION_SELECTOR) continue;
    codepoints.push(cp);
  }
  return `${TWEMOJI_BASE}/${codepoints.map((cp) => cp.toString(16)).join('-')}.svg`;
}
