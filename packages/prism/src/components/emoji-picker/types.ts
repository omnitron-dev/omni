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

/** Skin tone selector (1=light, 5=dark; 0=neutral/default). */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Payload returned by `<EmojiPicker onSelect>` when the user picks
 * an emoji. The fields mirror the public surface of every
 * persisting caller in daos so the picker is a drop-in for
 * `emoji-mart`'s `{ native }` callback shape.
 */
export interface PickedEmoji {
  /** The rendered unicode glyph after skin-tone substitution. */
  native: string;
  /** Stable codepoint id (with tone suffix when applicable). */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Skin tone that produced `native` (0 when none applied). */
  tone: SkinTone;
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
  /** Default skin tone applied across the picker. */
  defaultTone?: SkinTone;
  /** Localised strings shown in the chrome. */
  i18n?: Partial<EmojiPickerI18n>;
  /** Optional className on the outer container. */
  className?: string;
}

/** All localisable strings inside the picker. */
export interface EmojiPickerI18n {
  searchPlaceholder: string;
  noResults: string;
  loading: string;
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
  skinTone: string;
}

/** Default English copy used when no `i18n` prop is supplied. */
export const DEFAULT_I18N: EmojiPickerI18n = {
  searchPlaceholder: 'Search emoji',
  noResults: 'No emoji match',
  loading: 'Loading…',
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
  skinTone: 'Skin tone',
};
