/**
 * Public types for the prism EmojiPicker.
 *
 * The picker is built around two surfaces: a one-line standalone
 * `<Emoji>` renderer (used wherever a single emoji is shown — reaction
 * chips, message content, etc.) and a `<EmojiPicker>` for selecting
 * one. The `set` axis (native vs twitter) flows through both so a
 * component tree can be locked to a consistent rendering scheme.
 */

/** Top-level dataset shape, loaded once per session via dynamic import. */
export interface EmojiDataset {
  v: number;
  groups: string[];
  emojis: EmojiEntry[];
}

/** A single emoji + its metadata, stored in a dense shape on disk. */
export interface EmojiEntry {
  /** Hex codepoint sequence, no separators on multi-cp (e.g. `1F1EA-1F1FA`). */
  i: string;
  /** Unicode form, ready to render natively. */
  e: string;
  /** Human-readable label (English). */
  n: string;
  /** Lower-cased search tokens (tags + label tokens, de-duped). */
  k: string[];
  /** Compact group index — see `EmojiDataset.groups`. */
  g: number;
  /**
   * Skin-tone variants, one per tone 1..5. Stored as
   * `[unicode, hexcode]` pairs so each tone gets a stable id.
   * Absent when the emoji has no skin tones.
   */
  s?: [string, string][];
}

/** Visual style used to render an emoji. */
export type EmojiSet = 'native' | 'twitter';

/**
 * Payload returned by `<EmojiPicker onSelect>` when the user picks
 * an emoji. The fields mirror the public surface of every
 * persisting caller in daos so the picker is a drop-in for
 * `emoji-mart`'s `{ native }` callback shape.
 */
export interface PickedEmoji {
  /** The rendered unicode glyph. */
  native: string;
  /** Stable codepoint id (hexcode form, e.g. `1F44D`). */
  id: string;
  /** Human-readable label. */
  name: string;
}

/** Props for the standalone `<Emoji>` renderer. */
export interface EmojiProps {
  /** The unicode glyph to render. */
  native: string;
  /** Visual set. Defaults to `'twitter'`. */
  set?: EmojiSet;
  /** Pixel size (square). Defaults to inherit (1em). */
  size?: number;
  /** Optional label for screen readers; falls back to `native`. */
  alt?: string;
}

/** Props for the main `<EmojiPicker>` component. */
export interface EmojiPickerProps {
  /** Called when the user picks an emoji. */
  onSelect: (emoji: PickedEmoji) => void;
  /** Visual set used for emoji rendering inside the grid. */
  set?: EmojiSet;
  /** Emojis per row in the grid. Defaults to 8. */
  perLine?: number;
  /** Rendered emoji pixel size. Defaults to 24. */
  emojiSize?: number;
  /** Max emojis shown in the "Recent" row (capped at 32). */
  maxRecent?: number;
  /** Localised strings shown in the chrome. */
  i18n?: Partial<EmojiPickerI18n>;
  /** Optional className on the outer container. */
  className?: string;
}

/** All localisable strings inside the picker. */
export interface EmojiPickerI18n {
  searchPlaceholder: string;
  searchResults: string;
  noResults: string;
  loading: string;
  previewHint: string;
  clear: string;
  categories: {
    recent: string;
    smileys: string;
    people: string;
    nature: string;
    food: string;
    travel: string;
    activities: string;
    objects: string;
    symbols: string;
    flags: string;
  };
}

/** Default English copy used when no `i18n` prop is supplied. */
export const DEFAULT_I18N: EmojiPickerI18n = {
  searchPlaceholder: 'Search emoji',
  searchResults: 'Search results',
  noResults: 'No emoji match',
  loading: 'Loading…',
  previewHint: 'Hover any emoji to preview',
  clear: 'Clear search',
  categories: {
    recent: 'Recently used',
    smileys: 'Smileys & emotion',
    people: 'People & body',
    nature: 'Animals & nature',
    food: 'Food & drink',
    travel: 'Travel & places',
    activities: 'Activities',
    objects: 'Objects',
    symbols: 'Symbols',
    flags: 'Flags',
  },
};
