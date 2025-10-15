/**
 * ItalicExtension - Emphasis/italic text formatting
 *
 * Keyboard shortcut: Mod-i
 * Input rules: *text* or _text_
 */

import { InputRule } from 'prosemirror-inputrules';
import { toggleMark } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import type { MarkSpec } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';
import type { SchemaContribution } from '../../core/types.js';
import { markInputRule } from '../../utils/inputRules.js';

/**
 * Italic mark extension
 *
 * Adds italic/emphasis text formatting to the editor
 *
 * @example
 * ```typescript
 * const italic = new ItalicExtension();
 * editor.registerExtension(italic);
 *
 * // Use commands
 * editor.commands.italic();
 * editor.commands.setItalic();
 * editor.commands.unsetItalic();
 * ```
 */
export class ItalicExtension extends Extension {
  readonly name = 'italic';
  readonly type = 'mark' as const;

  /**
   * Get schema contribution for italic mark
   */
  getSchema(): SchemaContribution {
    return {
      marks: {
        italic: {
          parseDOM: [
            { tag: 'em' },
            { tag: 'i' },
            // Handle font-style: italic
            {
              style: 'font-style',
              getAttrs: (value: string) => value === 'italic' && null,
            },
          ],
          toDOM: () => ['em', 0],
        } as MarkSpec,
      },
    };
  }

  /**
   * Get keyboard shortcuts
   */
  getKeyboardShortcuts(): Record<string, Command> {
    return {
      'Mod-i': (state, dispatch) => {
        const markType = state.schema.marks.italic;
        if (!markType) return false;
        return toggleMark(markType)(state, dispatch);
      },
    };
  }

  /**
   * Get input rules for markdown-style formatting
   */
  getInputRules(): InputRule[] {
    return [
      // Match *text* or _text_ (single asterisk or underscore)
      markInputRule(/(?:^|\s)(\*|_)([^*_]+)(\1)$/, (schema) => schema.marks.italic),
    ];
  }
}
