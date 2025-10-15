/**
 * HeadingExtension - Heading node (h1-h6) for the Advanced Editor
 *
 * Supports all standard HTML heading levels with keyboard shortcuts and input rules
 */

import { textblockTypeInputRule } from 'prosemirror-inputrules';
import { setBlockType } from 'prosemirror-commands';
import type { NodeSpec } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

/**
 * Heading extension options
 */
export interface HeadingOptions {
  /**
   * Supported heading levels (1-6)
   * @default [1, 2, 3, 4, 5, 6]
   */
  levels: number[];

  /**
   * HTML attributes to add to heading elements
   * @default {}
   */
  HTMLAttributes: Record<string, any>;
}

/**
 * Heading extension
 *
 * Adds support for HTML heading elements (h1-h6) with:
 * - Keyboard shortcuts: Mod-Alt-1 through Mod-Alt-6
 * - Input rules: # for h1, ## for h2, etc.
 * - Commands: heading(level), toggleHeading(level)
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new HeadingExtension({ levels: [1, 2, 3] }), // Only h1-h3
 *   ],
 * });
 *
 * // Use commands
 * editor.chain().heading(2).run(); // Convert to h2
 * ```
 */
export class HeadingExtension extends Extension<HeadingOptions> {
  readonly name = 'heading';
  readonly type = 'node' as const;

  protected defaultOptions(): HeadingOptions {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      nodes: {
        heading: {
          attrs: {
            level: {
              default: 1,
            },
          },
          content: 'inline*',
          group: 'block',
          defining: true,
          parseDOM: this.options.levels.map((level) => ({
            tag: `h${level}`,
            attrs: { level },
          })),
          toDOM: (node) => {
            const level = node.attrs.level;
            return [`h${level}`, this.options.HTMLAttributes, 0];
          },
        } as NodeSpec,
      },
    };
  }

  getKeyboardShortcuts() {
    const shortcuts: Record<string, Command> = {};

    this.options.levels.forEach((level) => {
      shortcuts[`Mod-Alt-${level}`] = (state, dispatch) => {
        const headingType = state.schema.nodes.heading;
        if (!headingType) return false;
        return setBlockType(headingType, { level })(state, dispatch);
      };
    });

    return shortcuts;
  }

  getCommands() {
    return {
      /**
       * Set the current block to a heading
       */
      heading: (level: number) => (state, dispatch) => {
        const headingType = state.schema.nodes.heading;
        if (!headingType) return false;

        // Validate level
        if (!this.options.levels.includes(level)) {
          console.warn(`Heading level ${level} is not supported`);
          return false;
        }

        return setBlockType(headingType, { level })(state, dispatch);
      },

      /**
       * Toggle heading - if already a heading of the same level, convert to paragraph
       */
      toggleHeading: (level: number) => (state, dispatch) => {
        const headingType = state.schema.nodes.heading;
        const paragraphType = state.schema.nodes.paragraph;
        if (!headingType) return false;

        // Validate level
        if (!this.options.levels.includes(level)) {
          console.warn(`Heading level ${level} is not supported`);
          return false;
        }

        const { $from } = state.selection;
        const node = $from.parent;

        // If already this heading level, convert to paragraph
        if (node.type === headingType && node.attrs.level === level) {
          if (!paragraphType) return false;
          return setBlockType(paragraphType)(state, dispatch);
        }

        // Otherwise, convert to heading
        return setBlockType(headingType, { level })(state, dispatch);
      },
    };
  }

  getInputRules() {
    return this.options.levels.map((level) => {
      // Match 1-6 hash marks followed by a space
      const regex = new RegExp(`^(#{1,${level}})\\s$`);

      return textblockTypeInputRule(regex, this.editor!.schema.nodes.heading, (match) => {
        // Count the number of hashes to determine the level
        if (!match) return { level: 1 };

        const hashCount = match[1].length;
        return { level: hashCount };
      });
    });
  }
}
