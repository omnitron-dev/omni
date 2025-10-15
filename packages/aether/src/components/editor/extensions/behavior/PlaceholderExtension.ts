import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Extension } from '../../core/Extension.js';

export interface PlaceholderOptions {
  placeholder?: string | ((node: any) => string);
  emptyEditorClass?: string;
  emptyNodeClass?: string;
  showOnlyWhenEditable?: boolean;
  showOnlyCurrent?: boolean;
}

export class PlaceholderExtension extends Extension<PlaceholderOptions> {
  readonly name = 'placeholder';
  readonly type = 'behavior' as const;

  protected override defaultOptions(): PlaceholderOptions {
    return {
      placeholder: 'Write something...',
      emptyEditorClass: 'is-editor-empty',
      emptyNodeClass: 'is-empty',
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
    };
  }

  override getPlugins() {
    return [
      new Plugin({
        key: new PluginKey('placeholder'),
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            // Map decorations through transaction
            set = set.map(tr.mapping, tr.doc);
            return set;
          },
        },
        props: {
          decorations: (state) => {
            const { doc } = state;
            const decorations: Decoration[] = [];

            const isEmpty =
              doc.childCount === 1 &&
              doc.firstChild?.isTextblock &&
              doc.firstChild.content.size === 0;

            if (isEmpty) {
              const placeholder =
                typeof this.options.placeholder === 'function'
                  ? this.options.placeholder(doc.firstChild)
                  : this.options.placeholder;

              decorations.push(
                Decoration.widget(1, () => {
                  const span = document.createElement('span');
                  span.className = this.options.emptyNodeClass || 'is-empty';
                  span.textContent = placeholder || '';
                  span.setAttribute('data-placeholder', '');
                  return span;
                }),
              );
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  }
}
