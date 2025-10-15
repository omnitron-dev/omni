import { defineComponent, signal, computed, onMount, onCleanup, type Signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { EditorInstance } from '../core/types.js';

export interface BubbleMenuProps {
  editor: Signal<EditorInstance | null>;
  items?: BubbleMenuItem[];
  class?: string;
  shouldShow?: (editor: EditorInstance) => boolean;
  offset?: { x: number; y: number };
}

export type BubbleMenuItem =
  | {
      type: 'button';
      icon: string;
      title: string;
      command: string;
      args?: any[];
      isActive?: (editor: EditorInstance) => boolean;
      isDisabled?: (editor: EditorInstance) => boolean;
    }
  | {
      type: 'divider';
    };

export const BubbleMenu = defineComponent<BubbleMenuProps>((props) => {
  const position = signal<{ top: number; left: number } | null>(null);
  const isVisible = signal(false);

  const updatePosition = () => {
    const editor = props.editor();
    if (!editor || !editor.view) {
      isVisible.set(false);
      return;
    }

    const { state, view } = editor;
    const { selection } = state;

    // Check if should show
    if (props.shouldShow && !props.shouldShow(editor)) {
      isVisible.set(false);
      return;
    }

    // Show if there's a non-empty selection
    if (selection.empty) {
      isVisible.set(false);
      return;
    }

    // Calculate position
    const { from, to } = selection;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    const left = (start.left + end.left) / 2 + (props.offset?.x || 0);
    const top = start.top - 40 + (props.offset?.y || 0); // 40px above selection

    position.set({ top, left });
    isVisible.set(true);
  };

  onMount(() => {
    const editor = props.editor();
    if (!editor || !editor.view) return;

    // Update position on selection change
    const checkSelection = () => {
      requestAnimationFrame(updatePosition);
    };

    // Listen to editor updates
    const originalDispatch = editor.view.dispatch;
    editor.view.dispatch = (tr) => {
      originalDispatch.call(editor.view, tr);
      if (tr.selectionSet) {
        checkSelection();
      }
    };

    checkSelection();
  });

  onCleanup(() => {
    // Cleanup if needed
  });

  const renderItem = (item: BubbleMenuItem, index: number) => {
    if (item.type === 'divider') {
      return jsx('div', {
        key: `divider-${index}`,
        class: 'bubble-menu-divider',
      });
    }

    const editor = props.editor();
    if (!editor) return null;

    const isActive = computed(() => {
      const ed = props.editor();
      return ed && item.isActive ? item.isActive(ed) : false;
    });

    const isDisabled = computed(() => {
      const ed = props.editor();
      return ed && item.isDisabled ? item.isDisabled(ed) : false;
    });

    const handleClick = () => {
      const ed = props.editor();
      if (ed && !isDisabled() && ed.commands) {
        ed.commands.execute(item.command, ...(item.args || []));
      }
    };

    return jsx('button', {
      key: `button-${index}`,
      class: `bubble-menu-button ${isActive() ? 'active' : ''} ${isDisabled() ? 'disabled' : ''}`,
      title: item.title,
      onClick: handleClick,
      disabled: isDisabled(),
      children: item.icon,
    });
  };

  return () => {
    if (!isVisible()) return null;

    const pos = position();
    if (!pos) return null;

    const items = props.items || getDefaultBubbleMenuItems();

    return jsx('div', {
      class: `bubble-menu ${props.class || ''}`,
      style: `position: fixed; top: ${pos.top}px; left: ${pos.left}px; z-index: 1000; transform: translateX(-50%);`,
      children: items.map((item, index) => renderItem(item, index)),
    });
  };
}, 'BubbleMenu');

export function getDefaultBubbleMenuItems(): BubbleMenuItem[] {
  return [
    {
      type: 'button',
      icon: 'B',
      title: 'Bold',
      command: 'bold',
    },
    {
      type: 'button',
      icon: 'I',
      title: 'Italic',
      command: 'italic',
    },
    {
      type: 'button',
      icon: 'U',
      title: 'Underline',
      command: 'underline',
    },
    {
      type: 'divider',
    },
    {
      type: 'button',
      icon: '🔗',
      title: 'Link',
      command: 'setLink',
    },
  ];
}
