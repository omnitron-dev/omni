/**
 * CodeExtension - Inline code formatting
 *
 * Keyboard shortcut: Mod-e
 * Input rule: `code`
 *
 * Note: This is for inline code, not code blocks
 */

import { InputRule } from 'prosemirror-inputrules';
import { toggleMark } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import type { MarkSpec } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';
import type { SchemaContribution } from '../../core/types.js';
import { markInputRule } from '../../utils/inputRules.js';

/**
 * Code mark extension
 *
 * Adds inline code formatting to the editor
 *
 * This extension excludes all other marks when active to ensure
 * code is displayed without additional formatting.
 *
 * @example
 * ```typescript
 * const code = new CodeExtension();
 * editor.registerExtension(code);
 *
 * // Use commands
 * editor.commands.code();
 * editor.commands.setCode();
 * editor.commands.unsetCode();
 * ```
 */
export class CodeExtension extends Extension {
  readonly name = 'code';
  readonly type = 'mark' as const;

  /**
   * Get schema contribution for code mark
   */
  getSchema(): SchemaContribution {
    return {
      marks: {
        code: {
          parseDOM: [
            {
              tag: 'code',
              // Don't match code inside pre (that's a code block)
              getAttrs: (node: HTMLElement) => {
                if (node.parentElement?.tagName === 'PRE') {
                  return false;
                }
                return null;
              },
            },
          ],
          toDOM: () => ['code', 0],
          // Exclude all other marks when code is active
          excludes: '_',
        } as MarkSpec,
      },
    };
  }

  /**
   * Get keyboard shortcuts
   */
  getKeyboardShortcuts(): Record<string, Command> {
    return {
      'Mod-e': (state, dispatch) => {
        const markType = state.schema.marks.code;
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
      // Match `code`
      markInputRule(/`([^`]+)`$/, (schema) => schema.marks.code),
    ];
  }
}
