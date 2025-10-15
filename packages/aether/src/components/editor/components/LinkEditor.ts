/**
 * LinkEditor component for editing hyperlinks
 */

import { defineComponent, signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { Signal } from '../../../core/index.js';
import type { EditorInstance } from '../core/types.js';

/**
 * Link editor props
 */
export interface LinkEditorProps {
  /**
   * Editor instance
   */
  editor: Signal<EditorInstance | null>;

  /**
   * Whether the link editor is open
   */
  isOpen: Signal<boolean>;

  /**
   * Position of the link editor
   */
  position: Signal<{ top: number; left: number } | null>;

  /**
   * Initial href value
   */
  initialHref?: string;

  /**
   * Called when the form is submitted
   */
  onSubmit?: (href: string, title?: string) => void;

  /**
   * Called when editing is cancelled
   */
  onCancel?: () => void;
}

/**
 * LinkEditor component
 *
 * A floating form for editing hyperlinks with URL and title inputs
 *
 * @example
 * ```typescript
 * const isOpen = signal(false);
 * const position = signal(null);
 *
 * const linkEditor = LinkEditor({
 *   editor,
 *   isOpen,
 *   position,
 *   onSubmit: (href, title) => {
 *     editor().commands.setLink(href, { title });
 *     isOpen.set(false);
 *   },
 *   onCancel: () => {
 *     isOpen.set(false);
 *   },
 * });
 * ```
 */
export const LinkEditor = defineComponent<LinkEditorProps>((props) => {
  const href = signal(props.initialHref || '');
  const title = signal('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const hrefValue = href();
    const titleValue = title();

    props.onSubmit?.(hrefValue, titleValue);

    // Reset form
    href.set('');
    title.set('');
  };

  const handleCancel = () => {
    // Reset form
    href.set('');
    title.set('');

    props.onCancel?.();
  };

  return () => {
    if (!props.isOpen()) return null;

    const pos = props.position();
    if (!pos) return null;

    const style = `position: absolute; top: ${pos.top}px; left: ${pos.left}px; z-index: 1000;`;

    return jsx('div', {
      class: 'link-editor',
      style,
      children: jsx('form', {
        onSubmit: handleSubmit,
        children: [
          jsx('input', {
            type: 'url',
            placeholder: 'Enter URL',
            value: href,
            onInput: (e: Event) => href.set((e.target as HTMLInputElement).value),
            autofocus: true,
          }),
          jsx('input', {
            type: 'text',
            placeholder: 'Title (optional)',
            value: title,
            onInput: (e: Event) => title.set((e.target as HTMLInputElement).value),
          }),
          jsx('div', {
            class: 'link-editor-actions',
            children: [
              jsx('button', {
                type: 'submit',
                children: 'Save',
              }),
              jsx('button', {
                type: 'button',
                onClick: handleCancel,
                children: 'Cancel',
              }),
            ],
          }),
        ],
      }),
    }) as Node;
  };
}, 'LinkEditor');
