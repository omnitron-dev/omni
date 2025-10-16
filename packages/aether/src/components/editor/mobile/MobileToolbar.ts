/**
 * MobileToolbar Component
 *
 * Mobile-optimized toolbar with touch-friendly interactions.
 * Implements responsive design patterns for mobile devices.
 *
 * @module components/editor/mobile
 */

import { defineComponent, signal, computed, onMount, type Signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { EditorInstance } from '../core/types.js';
import type { ToolbarItem } from '../components/Toolbar.js';

export interface MobileToolbarProps {
  editor: Signal<EditorInstance | null>;
  items?: ToolbarItem[];
  class?: string;
  position?: 'top' | 'bottom';
  collapsible?: boolean;
  showLabels?: boolean;
}

export interface MobileToolbarGroup {
  id: string;
  label: string;
  icon: string;
  items: ToolbarItem[];
}

/**
 * MobileToolbar component
 *
 * Features:
 * - Touch-friendly button sizes (44x44px minimum)
 * - Bottom sheet pattern for mobile
 * - Collapsible/expandable toolbar
 * - Swipeable panels
 * - Context-aware button groups
 * - Responsive layout
 * - Simplified controls for small screens
 *
 * @example
 * ```tsx
 * <MobileToolbar
 *   editor={editorSignal}
 *   position="bottom"
 *   collapsible={true}
 *   showLabels={false}
 * />
 * ```
 */
export const MobileToolbar = defineComponent<MobileToolbarProps>((props) => {
  const isExpanded = signal(false);
  const activeGroup = signal<string | null>(null);
  const isMobile = signal(false);

  // Detect mobile viewport
  onMount(() => {
    const checkMobile = () => {
      isMobile.set(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  });

  // Group items for mobile display
  const mobileGroups = computed((): MobileToolbarGroup[] => {
    const items = props.items || getDefaultMobileToolbarItems();

    return [
      {
        id: 'text',
        label: 'Text',
        icon: 'T',
        items: items.filter((item) =>
          item.type === 'button' ? ['bold', 'italic', 'underline'].includes(item.command) : false
        ),
      },
      {
        id: 'paragraph',
        label: 'Paragraph',
        icon: 'P',
        items: items.filter((item) =>
          item.type === 'button' ? ['heading', 'bulletList', 'orderedList'].includes(item.command) : false
        ),
      },
      {
        id: 'insert',
        label: 'Insert',
        icon: '+',
        items: items.filter((item) =>
          item.type === 'button' ? ['link', 'image', 'table', 'codeBlock'].includes(item.command) : false
        ),
      },
      {
        id: 'actions',
        label: 'Actions',
        icon: '⋯',
        items: items.filter((item) =>
          item.type === 'button' ? ['undo', 'redo', 'search'].includes(item.command) : false
        ),
      },
    ];
  });

  // Quick access buttons (always visible)
  const quickAccessButtons = computed(() => {
    const items = props.items || getDefaultMobileToolbarItems();
    return items.filter((item) => {
      if (item.type !== 'button') return false;
      return ['bold', 'italic', 'undo', 'redo'].includes(item.command);
    });
  });

  const toggleExpanded = () => {
    isExpanded.set(!isExpanded());
    if (!isExpanded()) {
      activeGroup.set(null);
    }
  };

  const selectGroup = (groupId: string) => {
    activeGroup.set(activeGroup() === groupId ? null : groupId);
  };

  const renderButton = (item: ToolbarItem, index: number): Node | null => {
    if (item.type !== 'button') return null;

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
      if (ed && ed.commands && !isDisabled()) {
        ed.commands.execute(item.command, ...(item.args || []));
      }
    };

    const buttonClasses = computed(() => {
      const classes = ['mobile-toolbar-button'];
      if (isActive()) classes.push('active');
      if (isDisabled()) classes.push('disabled');
      return classes.join(' ');
    });

    return jsx('button', {
      class: buttonClasses,
      title: item.title,
      'aria-label': item.title,
      'aria-pressed': isActive,
      onClick: handleClick,
      disabled: isDisabled,
      key: `btn-${index}`,
      children: [
        jsx('span', {
          class: 'button-icon',
          children: item.icon,
        }),
        props.showLabels
          ? jsx('span', {
              class: 'button-label',
              children: item.title.split('(')[0].trim(),
            })
          : null,
      ],
    }) as Node;
  };

  const renderQuickAccess = (): Node => {
    const buttons = quickAccessButtons();
    const children = buttons.map((item, i) => renderButton(item, i)).filter((n): n is Node => n !== null);

    return jsx('div', {
      class: 'mobile-toolbar-quick-access',
      role: 'toolbar',
      'aria-label': 'Quick access toolbar',
      children,
    }) as Node;
  };

  const renderGroupButton = (group: MobileToolbarGroup): Node => {
    const isActive = computed(() => activeGroup() === group.id);

    const buttonClasses = computed(() => {
      const classes = ['mobile-toolbar-group-button'];
      if (isActive()) classes.push('active');
      return classes.join(' ');
    });

    return jsx('button', {
      class: buttonClasses,
      'aria-label': group.label,
      'aria-expanded': isActive,
      onClick: () => selectGroup(group.id),
      children: [
        jsx('span', { class: 'group-icon', children: group.icon }),
        jsx('span', { class: 'group-label', children: group.label }),
      ],
    }) as Node;
  };

  const renderGroupPanel = (group: MobileToolbarGroup): Node | null => {
    const isActive = computed(() => activeGroup() === group.id);

    if (!isActive()) return null;

    const children = group.items.map((item, i) => renderButton(item, i)).filter((n): n is Node => n !== null);

    return jsx('div', {
      class: 'mobile-toolbar-group-panel',
      role: 'toolbar',
      'aria-label': `${group.label} toolbar`,
      children,
    }) as Node;
  };

  const renderExpandedToolbar = (): Node => {
    const groups = mobileGroups();

    return jsx('div', {
      class: 'mobile-toolbar-expanded',
      children: [
        // Group buttons
        jsx('div', {
          class: 'mobile-toolbar-groups',
          role: 'tablist',
          'aria-label': 'Toolbar groups',
          children: groups.map((group) => renderGroupButton(group)),
        }),
        // Active group panel
        jsx('div', {
          class: 'mobile-toolbar-panels',
          children: groups.map((group) => renderGroupPanel(group)).filter((n): n is Node => n !== null),
        }),
      ],
    }) as Node;
  };

  const renderCollapseButton = (): Node => {
    const expanded = isExpanded();

    return jsx('button', {
      class: 'mobile-toolbar-toggle',
      'aria-label': expanded ? 'Collapse toolbar' : 'Expand toolbar',
      'aria-expanded': expanded,
      onClick: toggleExpanded,
      children: jsx('span', {
        class: 'toggle-icon',
        children: expanded ? '✕' : '☰',
      }),
    }) as Node;
  };

  return () => {
    if (!isMobile()) {
      // Render standard toolbar on larger screens
      return null;
    }

    const classes = ['mobile-toolbar'];
    if (props.class) classes.push(props.class);
    if (props.position) classes.push(`position-${props.position}`);
    if (isExpanded()) classes.push('expanded');

    const children: Node[] = [];

    // Quick access bar (always visible)
    children.push(
      jsx('div', {
        class: 'mobile-toolbar-main',
        children: [renderQuickAccess(), props.collapsible ? renderCollapseButton() : null],
      }) as Node
    );

    // Expanded toolbar (shown when toggled)
    if (isExpanded()) {
      children.push(renderExpandedToolbar());
    }

    return jsx('div', {
      class: classes.join(' '),
      role: 'toolbar',
      'aria-label': 'Mobile editor toolbar',
      children,
    }) as Node;
  };
}, 'MobileToolbar');

/**
 * Default mobile toolbar configuration
 */
export function getDefaultMobileToolbarItems(): ToolbarItem[] {
  return [
    // Text formatting
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
      type: 'button',
      icon: 'S',
      title: 'Strike',
      command: 'strike',
    },
    // Headings
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
    // Lists
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
    {
      type: 'button',
      icon: '☑',
      title: 'Task List',
      command: 'taskList',
    },
    // Insert
    {
      type: 'button',
      icon: '🔗',
      title: 'Link',
      command: 'link',
    },
    {
      type: 'button',
      icon: '🖼',
      title: 'Image',
      command: 'image',
    },
    {
      type: 'button',
      icon: '⊞',
      title: 'Table',
      command: 'table',
    },
    {
      type: 'button',
      icon: '</>',
      title: 'Code Block',
      command: 'codeBlock',
    },
    // Actions
    {
      type: 'button',
      icon: '↶',
      title: 'Undo',
      command: 'undo',
    },
    {
      type: 'button',
      icon: '↷',
      title: 'Redo',
      command: 'redo',
    },
    {
      type: 'button',
      icon: '🔍',
      title: 'Search',
      command: 'search',
    },
  ];
}

/**
 * Mobile toolbar styles (to be included in CSS)
 */
export const mobileToolbarStyles = `
  .mobile-toolbar {
    display: none;
    position: fixed;
    left: 0;
    right: 0;
    background: var(--toolbar-bg, #fff);
    border-top: 1px solid var(--border-color, #e0e0e0);
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    transition: transform 0.3s ease;
  }

  @media (max-width: 768px) {
    .mobile-toolbar {
      display: flex;
      flex-direction: column;
    }

    .mobile-toolbar.position-top {
      top: 0;
      border-top: none;
      border-bottom: 1px solid var(--border-color, #e0e0e0);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .mobile-toolbar.position-bottom {
      bottom: 0;
    }
  }

  .mobile-toolbar-main {
    display: flex;
    align-items: center;
    padding: 8px;
    gap: 8px;
  }

  .mobile-toolbar-quick-access {
    display: flex;
    flex: 1;
    gap: 4px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .mobile-toolbar-quick-access::-webkit-scrollbar {
    display: none;
  }

  .mobile-toolbar-button {
    min-width: 44px;
    min-height: 44px;
    padding: 8px;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 8px;
    background: var(--button-bg, #f5f5f5);
    color: var(--button-color, #333);
    font-size: 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    transition: all 0.2s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .mobile-toolbar-button:active {
    transform: scale(0.95);
    background: var(--button-active-bg, #e0e0e0);
  }

  .mobile-toolbar-button.active {
    background: var(--button-active-bg, #007bff);
    color: var(--button-active-color, #fff);
    border-color: var(--button-active-bg, #007bff);
  }

  .mobile-toolbar-button.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .mobile-toolbar-button .button-icon {
    font-size: 20px;
  }

  .mobile-toolbar-button .button-label {
    font-size: 10px;
    font-weight: 500;
  }

  .mobile-toolbar-toggle {
    min-width: 44px;
    min-height: 44px;
    padding: 8px;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 8px;
    background: var(--button-bg, #f5f5f5);
    font-size: 20px;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .mobile-toolbar-expanded {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-color, #e0e0e0);
    background: var(--panel-bg, #fafafa);
    max-height: 50vh;
    overflow-y: auto;
  }

  .mobile-toolbar-groups {
    display: flex;
    gap: 4px;
    padding: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .mobile-toolbar-groups::-webkit-scrollbar {
    display: none;
  }

  .mobile-toolbar-group-button {
    min-width: 80px;
    min-height: 44px;
    padding: 8px 16px;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 8px;
    background: var(--button-bg, #fff);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s;
    touch-action: manipulation;
  }

  .mobile-toolbar-group-button.active {
    background: var(--button-active-bg, #007bff);
    color: var(--button-active-color, #fff);
    border-color: var(--button-active-bg, #007bff);
  }

  .mobile-toolbar-group-button .group-icon {
    font-size: 20px;
  }

  .mobile-toolbar-group-button .group-label {
    font-size: 12px;
    font-weight: 500;
  }

  .mobile-toolbar-group-panel {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 16px;
  }

  .mobile-toolbar-panels {
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Safe area support for devices with notches */
  @supports (padding: env(safe-area-inset-bottom)) {
    .mobile-toolbar.position-bottom {
      padding-bottom: env(safe-area-inset-bottom);
    }

    .mobile-toolbar.position-top {
      padding-top: env(safe-area-inset-top);
    }
  }
`;
