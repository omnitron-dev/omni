/**
 * CodeBlockExtension - Code block with language support
 *
 * Keyboard shortcuts:
 * - Mod-Alt-c: Toggle code block
 * - Shift-Enter: Insert newline in code block
 * - ArrowDown: Exit code block (at end)
 *
 * Input rule: ```language
 *
 * Note: This is for code blocks, not inline code (see CodeExtension)
 */

import type { NodeSpec, Schema } from 'prosemirror-model';
import { textblockTypeInputRule } from 'prosemirror-inputrules';
import type { Command } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';
import type { SchemaContribution } from '../../core/types.js';

export interface CodeBlockOptions {
  defaultLanguage?: string;
  languageClassPrefix?: string;
  exitOnTripleEnter?: boolean;
  exitOnArrowDown?: boolean;
  HTMLAttributes?: Record<string, any>;
}

/**
 * Code block extension
 *
 * Adds code block formatting to the editor with language support
 *
 * This extension creates a code block node that preserves whitespace
 * and prevents any marks from being applied inside it.
 *
 * @example
 * ```typescript
 * const codeBlock = new CodeBlockExtension({
 *   defaultLanguage: 'typescript',
 *   languageClassPrefix: 'lang-',
 * });
 * editor.registerExtension(codeBlock);
 *
 * // Use commands
 * editor.commands.setCodeBlock({ language: 'javascript' });
 * editor.commands.toggleCodeBlock();
 * ```
 */
export class CodeBlockExtension extends Extension<CodeBlockOptions> {
  readonly name = 'code_block';
  readonly type = 'node' as const;

  protected defaultOptions(): CodeBlockOptions {
    return {
      defaultLanguage: 'plaintext',
      languageClassPrefix: 'language-',
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      HTMLAttributes: {},
    };
  }

  getSchema(): SchemaContribution {
    return {
      nodes: {
        code_block: {
          content: 'text*',
          marks: '',
          group: 'block',
          code: true,
          defining: true,
          attrs: {
            language: {
              default: this.options.defaultLanguage,
            },
          },
          parseDOM: [
            {
              tag: 'pre',
              preserveWhitespace: 'full' as const,
              getAttrs: (node: string | HTMLElement) => {
                if (typeof node === 'string') return null;

                const codeElement = node.querySelector('code');
                const className = codeElement?.getAttribute('class') || '';
                const languageMatch = className.match(
                  new RegExp(`${this.options.languageClassPrefix}([\\w-]+)`),
                );

                return {
                  language: languageMatch ? languageMatch[1] : this.options.defaultLanguage,
                };
              },
            },
            {
              tag: 'code',
              preserveWhitespace: 'full' as const,
              getAttrs: (node: string | HTMLElement) => {
                if (typeof node === 'string') return null;

                // Don't match code inside pre (that's handled above)
                if (node.parentElement?.tagName === 'PRE') {
                  return false;
                }

                const className = node.getAttribute('class') || '';
                const languageMatch = className.match(
                  new RegExp(`${this.options.languageClassPrefix}([\\w-]+)`),
                );

                return {
                  language: languageMatch ? languageMatch[1] : this.options.defaultLanguage,
                };
              },
            },
          ],
          toDOM: (node) => [
            'pre',
            this.options.HTMLAttributes,
            [
              'code',
              {
                class: node.attrs.language
                  ? `${this.options.languageClassPrefix}${node.attrs.language}`
                  : null,
              },
              0,
            ],
          ],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      setCodeBlock:
        (attrs?: { language?: string }): Command =>
        (state, dispatch) => {
          const { schema, selection } = state;
          const { $from, $to } = selection;
          const range = $from.blockRange($to);

          if (!range) {
            return false;
          }

          if (dispatch) {
            dispatch(
              state.tr.setBlockType(
                range.start,
                range.end,
                schema.nodes.code_block,
                attrs || {},
              ),
            );
          }

          return true;
        },

      toggleCodeBlock:
        (attrs?: { language?: string }): Command =>
        (state, dispatch) => {
          const { schema, selection } = state;
          const { $from } = selection;
          const nodeType = schema.nodes.code_block;
          const isCode = $from.parent.type === nodeType;

          if (isCode) {
            // Convert to paragraph
            if (dispatch) {
              const range = $from.blockRange();
              if (range) {
                dispatch(state.tr.setBlockType(range.start, range.end, schema.nodes.paragraph));
              }
            }
            return true;
          }

          // Convert to code block
          const range = $from.blockRange();
          if (!range) {
            return false;
          }

          if (dispatch) {
            dispatch(state.tr.setBlockType(range.start, range.end, nodeType, attrs));
          }

          return true;
        },
    };
  }

  getInputRules(schema: Schema) {
    const nodeType = schema.nodes.code_block;
    if (!nodeType) return [];

    return [
      textblockTypeInputRule(/^```([a-z]*)\s$/, nodeType, (match) => ({
        language: match[1] || this.options.defaultLanguage,
      })),
    ];
  }

  getKeyboardShortcuts() {
    return {
      'Mod-Alt-c': (state, dispatch) => this.getCommands().toggleCodeBlock()(state, dispatch),

      'Shift-Enter': (state, dispatch) => {
        const { schema, selection } = state;
        const { $from } = selection;

        if ($from.parent.type !== schema.nodes.code_block) {
          return false;
        }

        if (dispatch) {
          dispatch(state.tr.insertText('\n'));
        }

        return true;
      },

      ArrowDown: (state, dispatch) => {
        if (!this.options.exitOnArrowDown) {
          return false;
        }

        const { schema, selection } = state;
        const { $from } = selection;

        if ($from.parent.type !== schema.nodes.code_block) {
          return false;
        }

        // Check if we're at the end of the code block
        const parentStart = $from.start();
        const parentEnd = $from.end();
        const textLength = $from.parent.textContent.length;

        // Position at end: parentStart + textLength
        // We need to check if we're at the very end
        if ($from.pos < parentStart + textLength) {
          return false;
        }

        // At end of code block, exit to paragraph
        if (dispatch) {
          const paragraph = schema.nodes.paragraph.create();
          const tr = state.tr.insert(parentEnd, paragraph);
          const resolvedPos = tr.doc.resolve(parentEnd + 1);
          dispatch(tr.setSelection(state.selection.constructor.near(resolvedPos) as any));
        }

        return true;
      },
    };
  }
}
