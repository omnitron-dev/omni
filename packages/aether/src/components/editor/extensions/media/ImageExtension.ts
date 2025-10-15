/**
 * ImageExtension - Image node for the Advanced Editor
 *
 * Adds support for images with drag-and-drop, paste, and upload capabilities
 */

import type { NodeSpec } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

/**
 * Image extension options
 */
export interface ImageOptions {
  /**
   * Render images inline or as block elements
   * @default false
   */
  inline?: boolean;

  /**
   * Allow base64-encoded images
   * @default true
   */
  allowBase64?: boolean;

  /**
   * HTML attributes to add to image elements
   * @default {}
   */
  HTMLAttributes?: Record<string, any>;

  /**
   * Optional image upload handler
   * Returns a URL for the uploaded image
   */
  uploadImage?: (file: File) => Promise<string>;
}

/**
 * Image extension
 *
 * Adds image support with drag-and-drop, paste detection, and optional upload.
 *
 * Commands:
 * - insertImage(options) - Insert an image with src, alt, title, width, height
 * - setImageSize(width, height) - Update image dimensions
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new ImageExtension({
 *       inline: false,
 *       uploadImage: async (file) => {
 *         // Upload to server and return URL
 *         const formData = new FormData();
 *         formData.append('file', file);
 *         const response = await fetch('/upload', {
 *           method: 'POST',
 *           body: formData,
 *         });
 *         const data = await response.json();
 *         return data.url;
 *       },
 *     }),
 *   ],
 * });
 *
 * // Use commands
 * editor.commands.insertImage({
 *   src: 'https://example.com/image.jpg',
 *   alt: 'Example image',
 * });
 * ```
 */
export class ImageExtension extends Extension<ImageOptions> {
  readonly name = 'image';
  readonly type = 'node' as const;

  protected defaultOptions(): ImageOptions {
    return {
      inline: false,
      allowBase64: true,
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      nodes: {
        image: {
          inline: this.options.inline,
          attrs: {
            src: {},
            alt: { default: null },
            title: { default: null },
            width: { default: null },
            height: { default: null },
          },
          group: this.options.inline ? 'inline' : 'block',
          draggable: true,
          parseDOM: [
            {
              tag: 'img[src]',
              getAttrs: (dom: HTMLElement) => ({
                src: dom.getAttribute('src'),
                alt: dom.getAttribute('alt'),
                title: dom.getAttribute('title'),
                width: dom.getAttribute('width'),
                height: dom.getAttribute('height'),
              }),
            },
          ],
          toDOM: (node) => [
            'img',
            {
              ...this.options.HTMLAttributes,
              src: node.attrs.src,
              alt: node.attrs.alt,
              title: node.attrs.title,
              width: node.attrs.width,
              height: node.attrs.height,
            },
          ],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      /**
       * Insert an image at the current position
       */
      insertImage:
        (options: {
          src: string;
          alt?: string;
          title?: string;
          width?: number;
          height?: number;
        }) =>
        (state, dispatch) => {
          const { src, alt, title, width, height } = options;

          if (!src) {
            return false;
          }

          const node = state.schema.nodes.image.create({
            src,
            alt,
            title,
            width,
            height,
          });

          if (dispatch) {
            const { tr } = state;
            dispatch(tr.replaceSelectionWith(node));
          }

          return true;
        },

      /**
       * Set image dimensions
       */
      setImageSize: (width: number, height: number) => (state, dispatch) => {
        const { selection, schema } = state;
        const { from } = selection;
        const node = state.doc.nodeAt(from);

        if (!node || node.type !== schema.nodes.image) {
          return false;
        }

        if (dispatch) {
          const attrs = {
            ...node.attrs,
            width,
            height,
          };
          dispatch(state.tr.setNodeMarkup(from, undefined, attrs));
        }

        return true;
      },
    };
  }

  getPlugins() {
    const plugins: Plugin[] = [];

    // Handle drag and drop
    plugins.push(
      new Plugin({
        key: new PluginKey('imageDrop'),
        props: {
          handleDrop: (view, event, slice, moved) => {
            if (moved) return false;

            const files = Array.from(event.dataTransfer?.files || []);
            const imageFiles = files.filter((file) => file.type.startsWith('image/'));

            if (imageFiles.length === 0) {
              return false;
            }

            event.preventDefault();

            imageFiles.forEach(async (file) => {
              if (this.options.uploadImage) {
                try {
                  const src = await this.options.uploadImage(file);
                  const pos = view.posAtCoords({
                    left: event.clientX,
                    top: event.clientY,
                  })?.pos;

                  if (pos !== undefined) {
                    const node = view.state.schema.nodes.image.create({
                      src,
                      alt: file.name,
                    });
                    const tr = view.state.tr.insert(pos, node);
                    view.dispatch(tr);
                  }
                } catch (error) {
                  console.error('Image upload failed:', error);
                }
              }
            });

            return true;
          },
        },
      }),
    );

    // Handle paste
    plugins.push(
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste: (view, event, slice) => {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItems = items.filter((item) => item.type.startsWith('image/'));

            if (imageItems.length === 0) {
              return false;
            }

            event.preventDefault();

            imageItems.forEach((item) => {
              const file = item.getAsFile();
              if (!file) return;

              if (this.options.uploadImage) {
                this.options
                  .uploadImage(file)
                  .then((src) => {
                    const node = view.state.schema.nodes.image.create({
                      src,
                      alt: file.name,
                    });
                    const tr = view.state.tr.replaceSelectionWith(node);
                    view.dispatch(tr);
                  })
                  .catch((error) => {
                    console.error('Image upload failed:', error);
                  });
              } else if (this.options.allowBase64) {
                const reader = new FileReader();
                reader.onload = (e) => {
                  const src = e.target?.result as string;
                  const node = view.state.schema.nodes.image.create({
                    src,
                    alt: file.name,
                  });
                  const tr = view.state.tr.replaceSelectionWith(node);
                  view.dispatch(tr);
                };
                reader.readAsDataURL(file);
              }
            });

            return true;
          },
        },
      }),
    );

    return plugins;
  }
}
