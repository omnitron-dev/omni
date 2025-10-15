/**
 * DraggableTabs Component
 *
 * Enhanced tabs component with drag-and-drop reordering functionality.
 * Extends the existing Tabs component with:
 * - Drag and drop tab reordering
 * - Close buttons on tabs
 * - Add new tab button
 * - Pinned tabs support
 * - Maximum tabs limit
 * - Touch support for mobile
 * - Smooth animations
 */

import { defineComponent } from '../../core/component/define.js';
import { signal, type WritableSignal } from '../../core/reactivity/signal.js';
import { effect } from '../../core/reactivity/effect.js';
import { computed } from '../../core/reactivity/computed.js';
import { jsx } from '../../jsx-runtime.js';
import { styled } from '../../styling/styled.js';
import { generateId } from '../../primitives/utils/index.js';

/**
 * Tab item configuration
 */
export interface DraggableTabItem {
  /**
   * Unique identifier for the tab
   */
  id: string;

  /**
   * Display label for the tab
   */
  label: string;

  /**
   * Whether the tab can be closed
   * @default true
   */
  closeable?: boolean;

  /**
   * Whether the tab is pinned (cannot be closed or reordered)
   * @default false
   */
  pinned?: boolean;

  /**
   * Optional icon element
   */
  icon?: any;

  /**
   * Whether the tab is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Custom data attached to the tab
   */
  data?: any;
}

/**
 * DraggableTabs props
 */
export interface DraggableTabsProps {
  /**
   * Array of tab items
   */
  tabs: DraggableTabItem[];

  /**
   * Currently active tab ID
   */
  activeTab?: string;

  /**
   * Callback when active tab changes
   */
  onTabChange?: (id: string) => void;

  /**
   * Callback when tabs are reordered
   */
  onTabReorder?: (oldIndex: number, newIndex: number) => void;

  /**
   * Callback when a tab is closed
   */
  onTabClose?: (id: string) => void;

  /**
   * Callback when add button is clicked
   */
  onTabAdd?: () => void;

  /**
   * Maximum number of tabs allowed
   * @default Infinity
   */
  maxTabs?: number;

  /**
   * Whether to show the add button
   * @default false
   */
  showAddButton?: boolean;

  /**
   * Variant style
   * @default 'default'
   */
  variant?: 'default' | 'enclosed' | 'pills';

  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg';

  /**
   * Enable touch support for mobile
   * @default true
   */
  touchEnabled?: boolean;

  /**
   * Animation duration in milliseconds
   * @default 200
   */
  animationDuration?: number;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Tab content (children)
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Drag state interface
 */
interface DragState {
  draggedIndex: number;
  draggedId: string;
  overIndex: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
}

/**
 * Container for the tabs list
 */
const TabsContainer = styled('div', {
  base: {
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderBottom: '1px solid #e5e7eb',
  },
});

/**
 * Scrollable wrapper for tabs
 */
const TabsScrollArea = styled('div', {
  base: {
    display: 'flex',
    alignItems: 'center',
    flex: '1',
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'thin',
    scrollbarColor: '#cbd5e1 #f1f5f9',
    '&::-webkit-scrollbar': {
      height: '6px',
    },
    '&::-webkit-scrollbar-track': {
      backgroundColor: '#f1f5f9',
    },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: '#cbd5e1',
      borderRadius: '3px',
    },
    '&::-webkit-scrollbar-thumb:hover': {
      backgroundColor: '#94a3b8',
    },
  },
});

/**
 * List container for tabs
 */
const TabsList = styled('div', {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    position: 'relative',
    minWidth: 'min-content',
  },
});

/**
 * Individual tab button with drag support
 */
const TabButton = styled('button', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    position: 'relative',
    whiteSpace: 'nowrap',
    padding: '0.75rem 1rem',
    borderBottom: '2px solid transparent',
    '&:hover': {
      color: '#111827',
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
    },
    '&[data-active="true"]': {
      color: '#3b82f6',
      borderBottomColor: '#3b82f6',
    },
    '&[data-disabled="true"]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
    '&[data-dragging="true"]': {
      opacity: '0.4',
      cursor: 'grabbing',
    },
    '&[data-drag-over="true"]': {
      backgroundColor: '#eff6ff',
    },
    '&[data-pinned="true"]': {
      borderLeft: '2px solid #3b82f6',
    },
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.8125rem',
        padding: '0.5rem 0.75rem',
      },
      md: {
        fontSize: '0.875rem',
        padding: '0.75rem 1rem',
      },
      lg: {
        fontSize: '1rem',
        padding: '1rem 1.25rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Tab icon wrapper
 */
const TabIcon = styled('span', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Tab label
 */
const TabLabel = styled('span', {
  base: {
    display: 'inline-block',
  },
});

/**
 * Close button for tabs
 */
const CloseButton = styled('button', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1rem',
    height: '1rem',
    padding: '0',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    borderRadius: '0.25rem',
    transition: 'all 0.15s ease',
    '&:hover': {
      color: '#ef4444',
      backgroundColor: '#fee2e2',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #fecaca',
    },
  },
});

/**
 * Add button for creating new tabs
 */
const AddButton = styled('button', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2rem',
    height: '2rem',
    margin: '0 0.5rem',
    padding: '0',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    color: '#6b7280',
    cursor: 'pointer',
    borderRadius: '0.375rem',
    transition: 'all 0.15s ease',
    flexShrink: '0',
    '&:hover': {
      color: '#3b82f6',
      borderColor: '#3b82f6',
      backgroundColor: '#eff6ff',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #bfdbfe',
    },
    '&:disabled': {
      opacity: '0.5',
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },
  },
});

/**
 * Drag placeholder
 */
const DragPlaceholder = styled('div', {
  base: {
    width: '100px',
    height: '100%',
    backgroundColor: '#dbeafe',
    border: '2px dashed #3b82f6',
    borderRadius: '0.375rem',
    transition: 'all 0.2s ease',
  },
});

/**
 * DraggableTabs component
 */
export const DraggableTabs = defineComponent<DraggableTabsProps>((props) => {
  // State
  const tabs = signal<DraggableTabItem[]>(props.tabs || []);
  const activeTabId = signal(props.activeTab || props.tabs?.[0]?.id || '');
  const dragState = signal<DragState>({
    draggedIndex: -1,
    draggedId: '',
    overIndex: -1,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isDragging: false,
  });

  const touchEnabled = props.touchEnabled !== false;
  const animationDuration = props.animationDuration || 200;
  const maxTabs = props.maxTabs || Infinity;

  // Update tabs when props change
  effect(() => {
    if (props.tabs) {
      tabs.set(props.tabs);
    }
  });

  // Update active tab when props change
  effect(() => {
    if (props.activeTab) {
      activeTabId.set(props.activeTab);
    }
  });

  // Check if max tabs reached
  const isMaxTabsReached = computed(() => tabs().length >= maxTabs);

  /**
   * Handle tab click
   */
  const handleTabClick = (tabId: string, disabled?: boolean) => {
    if (disabled) return;
    activeTabId.set(tabId);
    props.onTabChange?.(tabId);
  };

  /**
   * Handle tab close
   */
  const handleTabClose = (event: Event, tabId: string) => {
    event.stopPropagation();
    props.onTabClose?.(tabId);
  };

  /**
   * Handle add button click
   */
  const handleAddClick = () => {
    if (!isMaxTabsReached()) {
      props.onTabAdd?.();
    }
  };

  /**
   * Get tab index by ID
   */
  const getTabIndex = (tabId: string): number => {
    return tabs().findIndex((tab) => tab.id === tabId);
  };

  /**
   * Reorder tabs
   */
  const reorderTabs = (fromIndex: number, toIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(fromIndex, 1);
    currentTabs.splice(toIndex, 0, removed);
    tabs.set(currentTabs);
    props.onTabReorder?.(fromIndex, toIndex);
  };

  /**
   * Handle drag start
   */
  const handleDragStart = (event: DragEvent | TouchEvent, tabId: string, index: number, pinned?: boolean) => {
    // Don't allow dragging pinned tabs
    if (pinned) {
      event.preventDefault();
      return;
    }

    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

    dragState.set({
      draggedIndex: index,
      draggedId: tabId,
      overIndex: index,
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
      isDragging: true,
    });

    // Set drag data for native drag and drop
    if ('dataTransfer' in event && event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tabId);

      // Create ghost image
      const target = event.target as HTMLElement;
      const ghost = target.cloneNode(true) as HTMLElement;
      ghost.style.opacity = '0.5';
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 0, 0);

      // Remove ghost after drag starts
      setTimeout(() => {
        document.body.removeChild(ghost);
      }, 0);
    }
  };

  /**
   * Handle drag over
   */
  const handleDragOver = (event: DragEvent | TouchEvent, index: number) => {
    event.preventDefault();

    const state = dragState();
    if (!state.isDragging || state.draggedIndex === -1) return;

    // Don't allow dropping before or after pinned tabs
    const targetTab = tabs()[index];
    if (targetTab?.pinned) return;

    if (state.overIndex !== index) {
      dragState.set({ ...state, overIndex: index });
    }
  };

  /**
   * Handle drag end
   */
  const handleDragEnd = (event: DragEvent | TouchEvent) => {
    const state = dragState();
    if (!state.isDragging) return;

    // Perform reordering if position changed
    if (state.draggedIndex !== state.overIndex && state.overIndex !== -1) {
      reorderTabs(state.draggedIndex, state.overIndex);
    }

    // Reset drag state
    dragState.set({
      draggedIndex: -1,
      draggedId: '',
      overIndex: -1,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      isDragging: false,
    });
  };

  /**
   * Handle drop
   */
  const handleDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    handleDragEnd(event);
  };

  /**
   * Handle touch move
   */
  const handleTouchMove = (event: TouchEvent) => {
    if (!touchEnabled) return;

    const state = dragState();
    if (!state.isDragging) return;

    const touch = event.touches[0];
    dragState.set({
      ...state,
      currentX: touch.clientX,
      currentY: touch.clientY,
    });

    // Find element under touch
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (element) {
      const tabButton = element.closest('[data-tab-index]');
      if (tabButton) {
        const index = parseInt(tabButton.getAttribute('data-tab-index') || '-1', 10);
        if (index !== -1) {
          handleDragOver(event, index);
        }
      }
    }
  };

  return () => {
    const currentTabs = tabs();
    const currentActiveId = activeTabId();
    const currentDragState = dragState();
    const { size = 'md', className, children, ...restProps } = props;

    // Render tabs
    const tabElements = currentTabs.map((tab, index) => {
      const isActive = tab.id === currentActiveId;
      const isDragging = currentDragState.isDragging && currentDragState.draggedId === tab.id;
      const isDragOver = currentDragState.overIndex === index && currentDragState.draggedIndex !== index;

      const tabButton = jsx(TabButton, {
        ...restProps,
        size,
        'data-tab-id': tab.id,
        'data-tab-index': index,
        'data-active': isActive,
        'data-disabled': tab.disabled,
        'data-dragging': isDragging,
        'data-drag-over': isDragOver,
        'data-pinned': tab.pinned,
        draggable: !tab.pinned && !tab.disabled,
        onClick: () => handleTabClick(tab.id, tab.disabled),
        onDragStart: (e: DragEvent) => handleDragStart(e, tab.id, index, tab.pinned),
        onDragOver: (e: DragEvent) => handleDragOver(e, index),
        onDragEnd: handleDragEnd,
        onDrop: (e: DragEvent) => handleDrop(e, index),
        onTouchStart: touchEnabled ? (e: TouchEvent) => handleDragStart(e, tab.id, index, tab.pinned) : undefined,
        onTouchMove: touchEnabled ? handleTouchMove : undefined,
        onTouchEnd: touchEnabled ? handleDragEnd : undefined,
        children: [
          tab.icon ? jsx(TabIcon, { children: tab.icon }) : null,
          jsx(TabLabel, { children: tab.label }),
          tab.closeable !== false && !tab.pinned
            ? jsx(CloseButton, {
                type: 'button',
                'aria-label': `Close ${tab.label}`,
                onClick: (e: Event) => handleTabClose(e, tab.id),
                children: jsx('svg', {
                  width: '12',
                  height: '12',
                  viewBox: '0 0 12 12',
                  fill: 'none',
                  xmlns: 'http://www.w3.org/2000/svg',
                  children: [
                    jsx('path', {
                      d: 'M9 3L3 9M3 3L9 9',
                      stroke: 'currentColor',
                      'stroke-width': '1.5',
                      'stroke-linecap': 'round',
                      'stroke-linejoin': 'round',
                    }),
                  ],
                }),
              })
            : null,
        ].filter(Boolean),
      });

      return tabButton;
    });

    // Render add button
    const addButton = props.showAddButton
      ? jsx(AddButton, {
          type: 'button',
          'aria-label': 'Add tab',
          disabled: isMaxTabsReached(),
          onClick: handleAddClick,
          children: jsx('svg', {
            width: '16',
            height: '16',
            viewBox: '0 0 16 16',
            fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg',
            children: [
              jsx('path', {
                d: 'M8 3V13M3 8H13',
                stroke: 'currentColor',
                'stroke-width': '2',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
              }),
            ],
          }),
        })
      : null;

    return jsx(
      'div',
      {
        className,
        role: 'tablist',
        'aria-orientation': 'horizontal',
      },
      jsx(TabsContainer, {
        children: [
          jsx(TabsScrollArea, {
            children: jsx(TabsList, {
              children: tabElements,
            }),
          }),
          addButton,
        ].filter(Boolean),
      })
    );
  };
});

// Display name
DraggableTabs.displayName = 'DraggableTabs';

// Type exports
export type { DraggableTabsProps, DraggableTabItem };
