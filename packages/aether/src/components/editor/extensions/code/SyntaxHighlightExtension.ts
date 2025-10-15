/**
 * SyntaxHighlightExtension - Syntax highlighting for code blocks
 *
 * Depends on: code_block
 *
 * This extension adds syntax highlighting to code blocks using Lezer parsers.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { highlightTree } from '@lezer/highlight';
import { styleTags, tags as t } from '@lezer/highlight';
import type { Node as PMNode } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';

export interface SyntaxHighlightOptions {
  languages?: Record<string, any>; // Language parsers
  defaultLanguage?: string;
}

/**
 * Syntax highlighting extension
 *
 * Adds syntax highlighting to code blocks using Lezer parsers.
 * This extension depends on the code_block extension and should be
 * loaded after it.
 *
 * @example
 * ```typescript
 * import { javascript } from '@lezer/javascript';
 * import { python } from '@lezer/python';
 *
 * const highlight = new SyntaxHighlightExtension({
 *   languages: {
 *     javascript,
 *     typescript: javascript,
 *     python,
 *   },
 * });
 * editor.registerExtension(highlight);
 * ```
 */
export class SyntaxHighlightExtension extends Extension<SyntaxHighlightOptions> {
  readonly name = 'syntax_highlight';
  readonly type = 'behavior' as const;

  get dependencies(): string[] {
    return ['code_block'];
  }

  protected defaultOptions(): SyntaxHighlightOptions {
    return {
      languages: {},
      defaultLanguage: 'plaintext',
    };
  }

  getPlugins() {
    const pluginKey = new PluginKey('syntaxHighlight');

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_, state) => this.getDecorations(state.doc),
          apply: (tr, set, oldState, newState) => {
            if (!tr.docChanged) {
              return set.map(tr.mapping, tr.doc);
            }

            return this.getDecorations(newState.doc);
          },
        },
        props: {
          decorations: (state) => pluginKey.getState(state),
        },
      }),
    ];
  }

  private getDecorations(doc: PMNode): DecorationSet {
    const decorations: Decoration[] = [];

    doc.descendants((node: PMNode, pos: number) => {
      if (node.type.name !== 'code_block') {
        return;
      }

      const language = node.attrs.language || this.options.defaultLanguage;
      const parser = this.options.languages?.[language];

      if (!parser || language === 'plaintext') {
        return;
      }

      const text = node.textContent;
      const tree = parser.parse(text);

      highlightTree(tree, this.getHighlightStyle(), (from, to, classes) => {
        decorations.push(
          Decoration.inline(pos + 1 + from, pos + 1 + to, {
            class: classes,
          }),
        );
      });
    });

    return DecorationSet.create(doc, decorations);
  }

  private getHighlightStyle() {
    return styleTags({
      [t.keyword]: 'tok-keyword',
      [t.operator]: 'tok-operator',
      [t.bool]: 'tok-bool',
      [t.null]: 'tok-null',
      [t.number]: 'tok-number',
      [t.string]: 'tok-string',
      [t.comment]: 'tok-comment',
      [t.variableName]: 'tok-variableName',
      [t.typeName]: 'tok-typeName',
      [t.propertyName]: 'tok-propertyName',
      [t.function(t.variableName)]: 'tok-function',
      [t.className]: 'tok-className',
      [t.tagName]: 'tok-tagName',
      [t.attributeName]: 'tok-attributeName',
      [t.punctuation]: 'tok-punctuation',
      [t.bracket]: 'tok-bracket',
      [t.brace]: 'tok-brace',
      [t.paren]: 'tok-paren',
      [t.separator]: 'tok-separator',
      [t.regexp]: 'tok-regexp',
      [t.escape]: 'tok-escape',
      [t.special(t.string)]: 'tok-special-string',
      [t.meta]: 'tok-meta',
      [t.link]: 'tok-link',
      [t.strong]: 'tok-strong',
      [t.emphasis]: 'tok-emphasis',
      [t.strikethrough]: 'tok-strikethrough',
      [t.invalid]: 'tok-invalid',
    });
  }
}
