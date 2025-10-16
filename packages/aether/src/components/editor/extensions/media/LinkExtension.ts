/**
 * LinkExtension - Hyperlink mark for the Advanced Editor
 *
 * Adds support for hyperlinks with customizable attributes and validation
 */

import type { Mark } from 'prosemirror-model';
import type { MarkSpec } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

/**
 * Link extension options
 */
export interface LinkOptions {
  /**
   * Open links on click
   * @default true
   */
  openOnClick?: boolean;

  /**
   * Auto-convert URLs to links on paste
   * @default true
   */
  linkOnPaste?: boolean;

  /**
   * HTML attributes to add to link elements
   * @default { target: '_blank', rel: 'noopener noreferrer nofollow' }
   */
  HTMLAttributes?: Record<string, any>;

  /**
   * URL validation function
   * @default URL constructor validation
   */
  validate?: (url: string) => boolean;
}

/**
 * Link extension
 *
 * Adds hyperlink support with validation, click handling, and paste detection.
 *
 * Commands:
 * - setLink(href, options) - Add a link to the current selection
 * - toggleLink(href) - Toggle link on/off for current selection
 * - unsetLink() - Remove link from current selection
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new LinkExtension({
 *       openOnClick: true,
 *       HTMLAttributes: {
 *         target: '_blank',
 *         rel: 'noopener noreferrer',
 *       },
 *     }),
 *   ],
 * });
 *
 * // Use commands
 * editor.commands.setLink('https://example.com', { title: 'Example' });
 * editor.commands.toggleLink('https://example.com');
 * editor.commands.unsetLink();
 * ```
 */
export class LinkExtension extends Extension<LinkOptions> {
  readonly name = 'link';
  readonly type = 'mark' as const;

  protected defaultOptions(): LinkOptions {
    return {
      openOnClick: true,
      linkOnPaste: true,
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
      validate: (url) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  getSchema() {
    return {
      marks: {
        link: {
          attrs: {
            href: {},
            title: { default: null },
          },
          inclusive: false,
          parseDOM: [
            {
              tag: 'a[href]',
              getAttrs: (dom: HTMLElement) => ({
                href: dom.getAttribute('href'),
                title: dom.getAttribute('title'),
              }),
            },
          ],
          toDOM: (mark: Mark) => [
            'a',
            {
              ...this.options.HTMLAttributes,
              href: mark.attrs.href,
              title: mark.attrs.title,
            },
            0,
          ],
        } as MarkSpec,
      },
    };
  }

  getCommands() {
    return {
      /**
       * Set a link on the current selection
       */
      setLink: (href: string, options?: { title?: string }) => (state, dispatch) => {
        if (!this.options.validate?.(href)) {
          return false;
        }

        const { selection } = state;
        const { from, to } = selection;
        const mark = state.schema.marks.link.create({
          href,
          title: options?.title,
        });

        if (dispatch) {
          dispatch(state.tr.addMark(from, to, mark));
        }
        return true;
      },

      /**
       * Toggle link on/off for current selection
       */
      toggleLink: (href?: string) => (state, dispatch) => {
        const { selection } = state;
        const { from, to } = selection;
        const mark = state.schema.marks.link;

        // Check if selection has link
        const hasMark = state.doc.rangeHasMark(from, to, mark);

        if (hasMark) {
          // Remove link
          if (dispatch) {
            dispatch(state.tr.removeMark(from, to, mark));
          }
          return true;
        }

        // Add link
        if (href && this.options.validate?.(href)) {
          const linkMark = mark.create({ href });
          if (dispatch) {
            dispatch(state.tr.addMark(from, to, linkMark));
          }
          return true;
        }

        return false;
      },

      /**
       * Remove link from current selection
       */
      unsetLink: () => (state, dispatch) => {
        const { selection } = state;
        const { from, to } = selection;
        const mark = state.schema.marks.link;

        if (dispatch) {
          dispatch(state.tr.removeMark(from, to, mark));
        }
        return true;
      },
    };
  }

  getPlugins() {
    const plugins: Plugin[] = [];

    if (this.options.openOnClick) {
      plugins.push(
        new Plugin({
          key: new PluginKey('linkClick'),
          props: {
            handleClick: (view, pos, event) => {
              const target = event.target as HTMLElement;

              if (target.tagName === 'A') {
                const href = target.getAttribute('href');
                if (href) {
                  window.open(href, '_blank');
                  return true;
                }
              }

              return false;
            },
          },
        })
      );
    }

    return plugins;
  }
}
