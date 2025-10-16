import { defineComponent, signal, computed, type Signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { EditorInstance } from '../core/types.js';

export interface ToolbarProps {
  editor: Signal<EditorInstance | null>;
  items?: ToolbarItem[];
  class?: string;
  sticky?: boolean;
}

export type ToolbarItem = ToolbarButton | ToolbarDropdown | ToolbarDivider | ToolbarGroup;

export interface ToolbarButton {
  type: 'button';
  icon: string;
  title: string;
  command: string;
  args?: any[];
  isActive?: (editor: EditorInstance) => boolean;
  isDisabled?: (editor: EditorInstance) => boolean;
}

export interface ToolbarDropdown {
  type: 'dropdown';
  icon: string;
  title: string;
  items: ToolbarButton[];
}

export interface ToolbarDivider {
  type: 'divider';
}

export interface ToolbarGroup {
  type: 'group';
  items: ToolbarItem[];
}

export const Toolbar = defineComponent<ToolbarProps>((props) => {
  const renderItem = (item: ToolbarItem, index: number): Node | null => {
    if (item.type === 'button') {
      return renderButton(item, index);
    } else if (item.type === 'dropdown') {
      return renderDropdown(item, index);
    } else if (item.type === 'divider') {
      return renderDivider(index);
    } else if (item.type === 'group') {
      return renderGroup(item, index);
    }
    return null;
  };

  const renderButton = (button: ToolbarButton, index: number): Node => {
    const isActive = computed(() => {
      const ed = props.editor();
      return ed && button.isActive ? button.isActive(ed) : false;
    });

    const isDisabled = computed(() => {
      const ed = props.editor();
      return ed && button.isDisabled ? button.isDisabled(ed) : false;
    });

    const handleClick = () => {
      const ed = props.editor();
      if (ed && ed.commands && !isDisabled()) {
        ed.commands.execute(button.command, ...(button.args || []));
      }
    };

    const buttonClasses = computed(() => {
      const classes = ['toolbar-button'];
      if (isActive()) classes.push('active');
      if (isDisabled()) classes.push('disabled');
      return classes.join(' ');
    });

    return jsx('button', {
      class: buttonClasses,
      title: button.title,
      'aria-label': button.title,
      'aria-pressed': isActive,
      'aria-disabled': isDisabled,
      onClick: handleClick,
      disabled: isDisabled,
      key: `btn-${index}`,
      children: button.icon,
    }) as Node;
  };

  const renderDivider = (index: number): Node =>
    jsx('div', {
      class: 'toolbar-divider',
      key: `div-${index}`,
    }) as Node;

  const renderGroup = (group: ToolbarGroup, index: number): Node => {
    const children = group.items.map((item, i) => renderItem(item, i)).filter((n): n is Node => n !== null);

    return jsx('div', {
      class: 'toolbar-group',
      role: 'group',
      'aria-label': `Toolbar group ${index + 1}`,
      key: `grp-${index}`,
      children,
    }) as Node;
  };

  const renderDropdown = (dropdown: ToolbarDropdown, index: number): Node => {
    const isOpen = signal(false);

    const handleTriggerClick = () => {
      isOpen.set(!isOpen());
    };

    const menuClasses = computed(() => {
      const classes = ['toolbar-dropdown-menu'];
      if (isOpen()) classes.push('open');
      return classes.join(' ');
    });

    const menuChildren = dropdown.items.map((item, i) => renderButton(item, i));

    return jsx('div', {
      class: 'toolbar-dropdown',
      key: `dd-${index}`,
      children: [
        jsx('button', {
          class: 'toolbar-dropdown-trigger',
          title: dropdown.title,
          'aria-label': dropdown.title,
          'aria-haspopup': 'menu',
          'aria-expanded': isOpen,
          onClick: handleTriggerClick,
          children: dropdown.icon,
        }),
        jsx('div', {
          class: menuClasses,
          role: 'menu',
          'aria-label': dropdown.title,
          children: menuChildren,
        }),
      ],
    }) as Node;
  };

  return () => {
    const items = props.items || getDefaultToolbarItems();
    const classes = ['toolbar'];
    if (props.class) classes.push(props.class);
    if (props.sticky) classes.push('sticky');

    const children = items.map((item, i) => renderItem(item, i)).filter((n): n is Node => n !== null);

    return jsx('div', {
      class: classes.join(' '),
      role: 'toolbar',
      'aria-label': 'Editor formatting toolbar',
      children,
    }) as Node;
  };
}, 'Toolbar');

/**
 * Default toolbar configuration with common formatting options
 */
export function getDefaultToolbarItems(): ToolbarItem[] {
  return [
    {
      type: 'group',
      items: [
        {
          type: 'button',
          icon: 'B',
          title: 'Bold (Mod-b)',
          command: 'bold',
        },
        {
          type: 'button',
          icon: 'I',
          title: 'Italic (Mod-i)',
          command: 'italic',
        },
        {
          type: 'button',
          icon: 'U',
          title: 'Underline (Mod-u)',
          command: 'underline',
        },
        {
          type: 'button',
          icon: 'S',
          title: 'Strike (Mod-Shift-x)',
          command: 'strike',
        },
        {
          type: 'button',
          icon: '</>',
          title: 'Code (Mod-e)',
          command: 'code',
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'dropdown',
      icon: 'H',
      title: 'Heading',
      items: [
        {
          type: 'button',
          icon: 'H1',
          title: 'Heading 1',
          command: 'heading',
          args: [1],
        },
        {
          type: 'button',
          icon: 'H2',
          title: 'Heading 2',
          command: 'heading',
          args: [2],
        },
        {
          type: 'button',
          icon: 'H3',
          title: 'Heading 3',
          command: 'heading',
          args: [3],
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'group',
      items: [
        {
          type: 'button',
          icon: '•',
          title: 'Bullet List',
          command: 'bulletList',
        },
        {
          type: 'button',
          icon: '1.',
          title: 'Ordered List',
          command: 'orderedList',
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'group',
      items: [
        {
          type: 'button',
          icon: '↶',
          title: 'Undo (Mod-z)',
          command: 'undo',
        },
        {
          type: 'button',
          icon: '↷',
          title: 'Redo (Mod-y)',
          command: 'redo',
        },
      ],
    },
  ];
}
