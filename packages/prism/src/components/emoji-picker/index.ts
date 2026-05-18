/**
 * Public surface of the prism emoji-picker.
 *
 *   <Emoji>        — render a single emoji (native or twitter).
 *   <EmojiPicker>  — full picker with search, categories, recent,
 *                    skin tones, twitter+native rendering.
 *   PickedEmoji,
 *   EmojiSet,
 *   SkinTone…      — public types.
 */

export { Emoji } from './emoji.js';
export { EmojiPicker } from './emoji-picker.js';
export type {
  EmojiPickerProps,
  EmojiProps,
  EmojiSet,
  PickedEmoji,
  EmojiPickerI18n,
} from './types.js';
