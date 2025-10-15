/**
 * UnderlineExtension - Underlined text formatting
 *
 * Keyboard shortcut: Mod-u
 */

import { toggleMark } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import type { MarkSpec } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';
import type { SchemaContribution } from '../../core/types.js';

/**
 * Underline mark extension
 *
 * Adds underline text formatting to the editor
 *
 * @example
 * ```typescript
 * const underline = new UnderlineExtension();
 * editor.registerExtension(underline);
 *
 * // Use commands
 * editor.commands.underline();
 * editor.commands.setUnderline();
 * editor.commands.unsetUnderline();
 * ```
 */
export class UnderlineExtension extends Extension {
  readonly name = 'underline';
  readonly type = 'mark' as const;

  /**
   * Get schema contribution for underline mark
   */
  getSchema(): SchemaContribution {
    return {
      marks: {
        underline: {
          parseDOM: [
            { tag: 'u' },
            // Handle text-decoration: underline
            {
              style: 'text-decoration',
              getAttrs: (value: string) => value === 'underline' && null,
            },
          ],
          toDOM: () => ['u', 0],
        } as MarkSpec,
      },
    };
  }

  /**
   * Get keyboard shortcuts
   */
  getKeyboardShortcuts(): Record<string, Command> {
    return {
      'Mod-u': (state, dispatch) => {
        const markType = state.schema.marks.underline;
        if (!markType) return false;
        return toggleMark(markType)(state, dispatch);
      },
    };
  }
}
