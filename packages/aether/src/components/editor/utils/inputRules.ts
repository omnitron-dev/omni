/**
 * Input rule utilities for creating mark and node input rules
 */

import { InputRule } from 'prosemirror-inputrules';
import type { MarkType } from 'prosemirror-model';

/**
 * Create an input rule for a mark
 *
 * @param pattern - Regular expression to match (should end with $)
 * @param markType - Mark type to apply, or function to get mark type from schema
 * @param getAttrs - Optional function to get mark attributes from match
 *
 * @example
 * ```typescript
 * // Match **text** and apply bold mark
 * markInputRule(/\*\*([^*]+)\*\*$/, schema => schema.marks.bold)
 * ```
 */
export function markInputRule(
  pattern: RegExp,
  markType: MarkType | ((schema: any) => MarkType),
  getAttrs?: (match: RegExpMatchArray) => Record<string, any> | null,
): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const attrs = getAttrs ? getAttrs(match) : null;
    const mark = typeof markType === 'function' ? markType(state.schema) : markType;

    if (!mark) return null;

    const tr = state.tr;
    if (match[1]) {
      const textStart = start + match[0].indexOf(match[1]);
      const textEnd = textStart + match[1].length;

      if (textEnd < end) {
        tr.delete(textEnd, end);
      }
      if (textStart > start) {
        tr.delete(start, textStart);
      }

      const markEnd = start + match[1].length;
      tr.addMark(start, markEnd, mark.create(attrs));
    }

    return tr;
  });
}
