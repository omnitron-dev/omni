/**
 * StrikeExtension - Strikethrough text formatting
 *
 * Keyboard shortcut: Mod-Shift-x
 * Input rule: ~~text~~
 */

import { InputRule } from 'prosemirror-inputrules';
import { toggleMark } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import type { MarkSpec, Schema } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';
import type { SchemaContribution } from '../../core/types.js';
import { markInputRule } from '../../utils/inputRules.js';

/**
 * Strike mark extension
 *
 * Adds strikethrough text formatting to the editor
 *
 * @example
 * ```typescript
 * const strike = new StrikeExtension();
 * editor.registerExtension(strike);
 *
 * // Use commands
 * editor.commands.strike();
 * editor.commands.setStrike();
 * editor.commands.unsetStrike();
 * ```
 */
export class StrikeExtension extends Extension {
  readonly name = 'strike';
  readonly type = 'mark' as const;

  /**
   * Get schema contribution for strike mark
   */
  getSchema(): SchemaContribution {
    return {
      marks: {
        strike: {
          parseDOM: [
            { tag: 's' },
            { tag: 'strike' },
            { tag: 'del' },
            // Handle text-decoration: line-through
            {
              style: 'text-decoration',
              getAttrs: (value: string) => value === 'line-through' && null,
            },
          ],
          toDOM: () => ['s', 0],
        } as MarkSpec,
      },
    };
  }

  /**
   * Get keyboard shortcuts
   */
  getKeyboardShortcuts(): Record<string, Command> {
    return {
      'Mod-Shift-x': (state, dispatch) => {
        const markType = state.schema.marks.strike;
        if (!markType) return false;
        return toggleMark(markType)(state, dispatch);
      },
    };
  }

  /**
   * Get input rules for markdown-style formatting
   */
  getInputRules(schema: Schema): InputRule[] {
    return [
      // Match ~~text~~
      markInputRule(/~~([^~]+)~~$/, (s) => s.marks.strike),
    ];
  }
}
