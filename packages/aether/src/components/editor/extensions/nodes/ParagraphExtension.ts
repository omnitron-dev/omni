/**
 * ParagraphExtension - Paragraph node for the Advanced Editor
 *
 * The most basic block-level element, used as the default text container
 */

import { setBlockType } from 'prosemirror-commands';
import type { NodeSpec } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';

/**
 * Paragraph extension options
 */
export interface ParagraphOptions {
  /**
   * HTML attributes to add to paragraph elements
   * @default {}
   */
  HTMLAttributes: Record<string, any>;
}

/**
 * Paragraph extension
 *
 * Adds support for HTML paragraph elements (<p>).
 * This is the default block type for text content.
 *
 * Commands:
 * - paragraph() - Convert current block to paragraph
 * - setParagraph() - Set current block to paragraph (alias)
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new ParagraphExtension(),
 *   ],
 * });
 *
 * // Use commands
 * editor.chain().paragraph().run(); // Convert to paragraph
 * ```
 */
export class ParagraphExtension extends Extension<ParagraphOptions> {
  readonly name = 'paragraph';
  readonly type = 'node' as const;

  protected defaultOptions(): ParagraphOptions {
    return {
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      nodes: {
        paragraph: {
          content: 'inline*',
          group: 'block',
          parseDOM: [{ tag: 'p' }],
          toDOM: () => ['p', this.options.HTMLAttributes, 0],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      /**
       * Convert the current block to a paragraph
       */
      paragraph: () => (state, dispatch) => {
        const paragraphType = state.schema.nodes.paragraph;
        if (!paragraphType) return false;
        return setBlockType(paragraphType)(state, dispatch);
      },

      /**
       * Set current block to paragraph (alias for paragraph command)
       */
      setParagraph: () => (state, dispatch) => {
        const paragraphType = state.schema.nodes.paragraph;
        if (!paragraphType) return false;
        return setBlockType(paragraphType)(state, dispatch);
      },
    };
  }
}
