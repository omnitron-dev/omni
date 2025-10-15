/**
 * BoldExtension - Strong/bold text formatting
 *
 * Keyboard shortcut: Mod-b
 * Input rules: **text** or __text__
 */

import { InputRule } from 'prosemirror-inputrules';
import { toggleMark } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import type { MarkSpec } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';
import type { SchemaContribution } from '../../core/types.js';
import { markInputRule } from '../../utils/inputRules.js';

/**
 * Bold mark extension
 *
 * Adds bold/strong text formatting to the editor
 *
 * @example
 * ```typescript
 * const bold = new BoldExtension();
 * editor.registerExtension(bold);
 *
 * // Use commands
 * editor.commands.bold();
 * editor.commands.setBold();
 * editor.commands.unsetBold();
 * ```
 */
export class BoldExtension extends Extension {
  readonly name = 'bold';
  readonly type = 'mark' as const;

  /**
   * Get schema contribution for bold mark
   */
  getSchema(): SchemaContribution {
    return {
      marks: {
        bold: {
          parseDOM: [
            { tag: 'strong' },
            // Handle <b> tags unless they have normal font-weight
            {
              tag: 'b',
              getAttrs: (node: HTMLElement) => node.style.fontWeight !== 'normal' && null,
            },
            // Handle font-weight style
            {
              style: 'font-weight',
              getAttrs: (value: string) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null,
            },
          ],
          toDOM: () => ['strong', 0],
        } as MarkSpec,
      },
    };
  }

  /**
   * Get keyboard shortcuts
   */
  getKeyboardShortcuts(): Record<string, Command> {
    return {
      'Mod-b': (state, dispatch) => {
        const markType = state.schema.marks.bold;
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
      // Match **text** or __text__
      markInputRule(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/, (schema) => schema.marks.bold),
    ];
  }
}
