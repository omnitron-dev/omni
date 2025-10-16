/**
 * MarkdownExtension - Provides markdown input rules and serialization
 *
 * Features:
 * - Convert markdown syntax to rich text on the fly (input rules)
 * - Paste markdown as rich text (paste rules)
 * - Export to markdown (toMarkdown method)
 * - Support for GFM (GitHub Flavored Markdown)
 */

import { InputRule } from 'prosemirror-inputrules';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';
import { parseMarkdown } from './parser.js';
import { serializeToMarkdown } from './serializer.js';

/**
 * Markdown extension options
 */
export interface MarkdownOptions {
  /**
   * Convert markdown syntax to rich text as you type
   * @default true
   */
  convertOnInput: boolean;

  /**
   * Convert pasted markdown to rich text
   * @default true
   */
  convertOnPaste: boolean;

  /**
   * Enable GitHub Flavored Markdown features
   * @default true
   */
  gfm: boolean;

  /**
   * HTML attributes for markdown elements
   * @default {}
   */
  HTMLAttributes: Record<string, any>;
}

/**
 * Markdown extension
 *
 * Provides markdown input rules, paste handling, and serialization
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new MarkdownExtension({
 *       convertOnInput: true,
 *       convertOnPaste: true,
 *       gfm: true,
 *     }),
 *   ],
 * });
 *
 * // Export as markdown
 * const markdown = editor.extensions.markdown.toMarkdown(editor.state.doc);
 * ```
 */
export class MarkdownExtension extends Extension<MarkdownOptions> {
  readonly name = 'markdown';
  readonly type = 'behavior' as const;

  protected defaultOptions(): MarkdownOptions {
    return {
      convertOnInput: true,
      convertOnPaste: true,
      gfm: true,
      HTMLAttributes: {},
    };
  }

  /**
   * Get plugins for paste handling
   */
  getPlugins(): Plugin[] {
    if (!this.options.convertOnPaste) {
      return [];
    }

    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) return false;

            // Check if it looks like markdown
            if (this.looksLikeMarkdown(text)) {
              try {
                const doc = parseMarkdown(text, view.state.schema);
                const slice = new Slice(doc.content, 0, 0);

                view.dispatch(view.state.tr.replaceSelection(slice));
                return true;
              } catch (error) {
                console.error('Failed to parse markdown:', error);
                return false;
              }
            }

            return false;
          },
        },
      }),
    ];
  }

  /**
   * Get input rules for markdown shortcuts
   */
  getInputRules(): InputRule[] {
    if (!this.options.convertOnInput) {
      return [];
    }

    const rules: InputRule[] = [];

    // These rules are basic - individual extensions handle their own input rules
    // This is mainly for documentation and fallback handling

    return rules;
  }

  /**
   * Get keyboard shortcuts
   */
  getKeyboardShortcuts(): Record<string, Command> {
    return {};
  }

  /**
   * Convert ProseMirror document to markdown
   */
  toMarkdown(doc: any): string {
    return serializeToMarkdown(doc);
  }

  /**
   * Convert markdown to ProseMirror document
   */
  fromMarkdown(markdown: string): any {
    if (!this.editor) {
      throw new Error('Editor not initialized');
    }
    return parseMarkdown(markdown, this.editor.schema);
  }

  /**
   * Check if text looks like markdown
   */
  private looksLikeMarkdown(text: string): boolean {
    // Check for common markdown patterns
    const patterns = [
      /^#{1,6}\s/m, // Headings
      /^\*\*.*\*\*/, // Bold
      /^\*.*\*/, // Italic
      /^```/m, // Code blocks
      /^\[.*\]\(.*\)/, // Links
      /^!\[.*\]\(.*\)/, // Images
      /^>\s/m, // Blockquotes
      /^[-*+]\s/m, // Unordered lists
      /^\d+\.\s/m, // Ordered lists
      /^\|.*\|/m, // Tables
      /^---$/m, // Horizontal rules
    ];

    // If GFM is enabled, check for GFM patterns
    if (this.options.gfm) {
      patterns.push(
        /~~.*~~/m, // Strikethrough
        /^- \[[ x]\]/m, // Task lists
      );
    }

    return patterns.some((pattern) => pattern.test(text));
  }
}
