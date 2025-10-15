import { defineComponent, computed, type Signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { EditorInstance } from '../core/types.js';

export interface StatusbarProps {
  editor: Signal<EditorInstance | null>;
  items?: StatusbarItem[];
  position?: 'top' | 'bottom';
  class?: string;
}

export type StatusbarItem = StatusbarText | StatusbarButton | StatusbarCustom;

export interface StatusbarText {
  type: 'text';
  render: (editor: EditorInstance) => string;
  class?: string;
}

export interface StatusbarButton {
  type: 'button';
  icon?: string;
  text?: string;
  title?: string;
  onClick: (editor: EditorInstance) => void;
  class?: string;
}

export interface StatusbarCustom {
  type: 'custom';
  render: (editor: EditorInstance) => any;
}

export const Statusbar = defineComponent<StatusbarProps>((props) => {
  const renderItem = (item: StatusbarItem, index: number) => {
    const editor = props.editor();
    if (!editor) return null;

    if (item.type === 'text') {
      const text = computed(() => {
        const ed = props.editor();
        return ed ? item.render(ed) : '';
      });

      return jsx('span', {
        key: `text-${index}`,
        class: `statusbar-text ${item.class || ''}`,
        children: text(),
      });
    }

    if (item.type === 'button') {
      const handleClick = () => {
        const ed = props.editor();
        if (ed) {
          item.onClick(ed);
        }
      };

      return jsx('button', {
        key: `button-${index}`,
        class: `statusbar-button ${item.class || ''}`,
        title: item.title,
        onClick: handleClick,
        children: item.icon || item.text || '',
      });
    }

    if (item.type === 'custom') {
      return jsx('div', {
        key: `custom-${index}`,
        children: item.render(editor),
      });
    }

    return null;
  };

  return () => {
    const editor = props.editor();
    if (!editor) return null;

    const items = props.items || getDefaultStatusbarItems();
    const position = props.position || 'bottom';

    return jsx('div', {
      class: `statusbar statusbar-${position} ${props.class || ''}`,
      children: items.map((item, index) => renderItem(item, index)),
    });
  };
}, 'Statusbar');

export function getDefaultStatusbarItems(): StatusbarItem[] {
  return [
    {
      type: 'text',
      render: (editor) => {
        const wordCount = editor.signals?.wordCount?.() || 0;
        return `${wordCount} word${wordCount === 1 ? '' : 's'}`;
      },
    },
    {
      type: 'text',
      render: (editor) => {
        const charCount = editor.signals?.charCount?.() || 0;
        return `${charCount} character${charCount === 1 ? '' : 's'}`;
      },
    },
  ];
}
