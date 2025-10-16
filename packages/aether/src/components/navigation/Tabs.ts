/**
 * Styled Tabs Component
 *
 * Tab navigation for switching between views.
 * Built on top of the Tabs primitive with styled() function.
 *
 * Features:
 * - Optional drag-and-drop reordering
 * - Visual feedback during drag operations
 * - Maintains backward compatibility
 * - Full ARIA support
 */

import { styled } from '../../styling/styled.js';
import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsTrigger as TabsTriggerPrimitive,
  TabsContent as TabsContentPrimitive,
  type TabsProps as TabsPrimitiveProps,
  type TabsTriggerProps as TabsTriggerPrimitiveProps,
  type TabsListProps as TabsListPrimitiveProps,
} from '../../primitives/Tabs.js';
import { defineComponent } from '../../core/component/define.js';
import { signal } from '../../core/reactivity/signal.js';
import { effect } from '../../core/reactivity/effect.js';
import { jsx } from '../../jsx-runtime.js';

/**
 * Tabs - Root component
 */
export const Tabs = TabsPrimitive;

/**
 * TabsList - Container for tab triggers
 */
export const TabsList = styled<{
  variant?: 'default' | 'enclosed' | 'pills';
  size?: 'sm' | 'md' | 'lg';
}>(TabsListPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  variants: {
    variant: {
      default: {
        borderBottom: '1px solid #e5e7eb',
      },
      enclosed: {
        backgroundColor: '#f3f4f6',
        padding: '0.25rem',
        borderRadius: '0.5rem',
      },
      pills: {
        gap: '0.5rem',
      },
    },
    size: {
      sm: {},
      md: {},
      lg: {},
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

/**
 * TabsTrigger - Individual tab button with optional drag-and-drop support
 */
export const TabsTrigger = styled<{
  variant?: 'default' | 'enclosed' | 'pills';
  size?: 'sm' | 'md' | 'lg';
}>(TabsTriggerPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    '&:hover': {
      color: '#111827',
    },
    '&:focus': {
      outline: 'none',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
    '&[data-dragging="true"]': {
      opacity: '0.4',
      cursor: 'grabbing',
    },
    '&[data-drag-over="true"]': {
      backgroundColor: '#eff6ff',
      borderColor: '#3b82f6',
    },
    '&[draggable="true"]': {
      cursor: 'grab',
    },
  },
  variants: {
    variant: {
      default: {
        padding: '0.75rem 1rem',
        borderBottom: '2px solid transparent',
        marginBottom: '-1px',
        '&[data-state="active"]': {
          color: '#3b82f6',
          borderBottomColor: '#3b82f6',
        },
      },
      enclosed: {
        padding: '0.5rem 1rem',
        borderRadius: '0.375rem',
        '&[data-state="active"]': {
          backgroundColor: '#ffffff',
          color: '#111827',
          boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        },
      },
      pills: {
        padding: '0.5rem 1rem',
        borderRadius: '9999px',
        '&[data-state="active"]': {
          backgroundColor: '#eff6ff',
          color: '#1e40af',
        },
      },
    },
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
    variant: 'default',
    size: 'md',
  },
});

/**
 * TabsContent - Tab panel content
 */
export const TabsContent = styled(TabsContentPrimitive, {
  base: {
    marginTop: '1rem',
    '&:focus': {
      outline: 'none',
    },
    '&[data-state="inactive"]': {
      display: 'none',
    },
  },
});

// Attach sub-components
(Tabs as any).List = TabsList;
(Tabs as any).Trigger = TabsTrigger;
(Tabs as any).Content = TabsContent;

// Display names
Tabs.displayName = 'Tabs';
TabsList.displayName = 'TabsList';
TabsTrigger.displayName = 'TabsTrigger';
TabsContent.displayName = 'TabsContent';

/**
 * Extended Tabs Props with Drag-and-Drop Support
 */
export interface TabsPropsWithDragDrop extends TabsPrimitiveProps {
  /**
   * Enable drag-and-drop reordering of tabs
   * @default false
   */
  enableDragDrop?: boolean;

  /**
   * Callback when tabs are reordered via drag-and-drop
   * @param newOrder - Array of tab values in the new order
   */
  onTabsReorder?: (newOrder: string[]) => void;

  /**
   * Enable touch support for mobile drag-and-drop
   * @default true
   */
  touchEnabled?: boolean;
}

/**
 * Extended TabsList Props with Drag-and-Drop Support
 */
export interface TabsListPropsWithDragDrop extends TabsListPrimitiveProps {
  /**
   * Enable drag-and-drop reordering
   * @default false
   */
  enableDragDrop?: boolean;

  /**
   * Callback when tabs are reordered
   */
  onTabsReorder?: (newOrder: string[]) => void;

  /**
   * Enable touch support
   * @default true
   */
  touchEnabled?: boolean;
}

/**
 * Extended TabsTrigger Props with Drag-and-Drop Support
 */
export interface TabsTriggerPropsWithDragDrop extends TabsTriggerPrimitiveProps {
  /**
   * Enable draggable behavior
   * @default false
   */
  draggable?: boolean;

  /**
   * Index of this tab (used for reordering)
   */
  tabIndex?: number;
}

/**
 * Drag state for tab reordering
 */
interface DragState {
  draggedValue: string | null;
  draggedIndex: number;
  overIndex: number;
  isDragging: boolean;
}

/**
 * Enhanced TabsList with Drag-and-Drop Support
 *
 * This component wraps the standard TabsList and adds optional drag-and-drop
 * functionality when `enableDragDrop` is true.
 */
export const TabsListWithDragDrop = defineComponent<TabsListPropsWithDragDrop>((props) => {
  const dragState = signal<DragState>({
    draggedValue: null,
    draggedIndex: -1,
    overIndex: -1,
    isDragging: false,
  });

  const touchEnabled = props.touchEnabled !== false;

  /**
   * Handle drag start
   */
  const handleDragStart = (event: DragEvent, value: string, index: number) => {
    dragState.set({
      draggedValue: value,
      draggedIndex: index,
      overIndex: index,
      isDragging: true,
    });

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', value);
    }

    // Add dragging visual state to the element
    const target = event.target as HTMLElement;
    target.setAttribute('data-dragging', 'true');
  };

  /**
   * Handle drag over
   */
  const handleDragOver = (event: DragEvent, index: number) => {
    event.preventDefault();

    const state = dragState();
    if (!state.isDragging || state.draggedIndex === -1) return;

    if (state.overIndex !== index) {
      dragState.set({ ...state, overIndex: index });
    }

    // Update drag-over visual state
    const target = event.currentTarget as HTMLElement;
    target.setAttribute('data-drag-over', 'true');
  };

  /**
   * Handle drag leave
   */
  const handleDragLeave = (event: DragEvent) => {
    const target = event.currentTarget as HTMLElement;
    target.removeAttribute('data-drag-over');
  };

  /**
   * Handle drop
   */
  const handleDrop = (event: DragEvent, index: number) => {
    event.preventDefault();

    const state = dragState();
    if (!state.isDragging || state.draggedIndex === -1) return;

    // Remove drag-over visual state
    const target = event.currentTarget as HTMLElement;
    target.removeAttribute('data-drag-over');

    // Perform reordering if position changed
    if (state.draggedIndex !== index) {
      // Get all tab triggers to build the new order
      const tablist = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
      if (tablist) {
        const triggers = Array.from(tablist.querySelectorAll('[role="tab"]')) as HTMLElement[];
        const newOrder = triggers.map((trigger) => trigger.getAttribute('data-value') || '').filter(Boolean);

        // Reorder array
        const [removed] = newOrder.splice(state.draggedIndex, 1);
        newOrder.splice(index, 0, removed);

        // Call the callback with new order
        props.onTabsReorder?.(newOrder);
      }
    }

    handleDragEnd(event);
  };

  /**
   * Handle drag end
   */
  const handleDragEnd = (event: DragEvent) => {
    // Remove all drag visual states
    const tablist = (event.target as HTMLElement).closest('[role="tablist"]');
    if (tablist) {
      const triggers = tablist.querySelectorAll('[role="tab"]');
      triggers.forEach((trigger) => {
        trigger.removeAttribute('data-dragging');
        trigger.removeAttribute('data-drag-over');
      });
    }

    // Reset drag state
    dragState.set({
      draggedValue: null,
      draggedIndex: -1,
      overIndex: -1,
      isDragging: false,
    });
  };

  /**
   * Handle touch start
   */
  const handleTouchStart = (event: TouchEvent, value: string, index: number) => {
    if (!touchEnabled) return;

    dragState.set({
      draggedValue: value,
      draggedIndex: index,
      overIndex: index,
      isDragging: true,
    });

    const target = event.target as HTMLElement;
    target.setAttribute('data-dragging', 'true');
  };

  /**
   * Handle touch move
   */
  const handleTouchMove = (event: TouchEvent) => {
    if (!touchEnabled) return;

    const state = dragState();
    if (!state.isDragging) return;

    const touch = event.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);

    if (element) {
      const tabTrigger = element.closest('[role="tab"]');
      if (tabTrigger) {
        const index = parseInt(tabTrigger.getAttribute('data-tab-index') || '-1', 10);
        if (index !== -1 && state.overIndex !== index) {
          // Remove old drag-over state
          const tablist = tabTrigger.closest('[role="tablist"]');
          if (tablist) {
            tablist.querySelectorAll('[data-drag-over]').forEach((el) => {
              el.removeAttribute('data-drag-over');
            });
          }

          // Add new drag-over state
          tabTrigger.setAttribute('data-drag-over', 'true');
          dragState.set({ ...state, overIndex: index });
        }
      }
    }
  };

  /**
   * Handle touch end
   */
  const handleTouchEnd = (event: TouchEvent) => {
    if (!touchEnabled) return;

    const state = dragState();
    if (!state.isDragging) return;

    // Perform reordering if position changed
    if (state.draggedIndex !== state.overIndex && state.overIndex !== -1) {
      const target = event.target as HTMLElement;
      const tablist = target.closest('[role="tablist"]');
      if (tablist) {
        const triggers = Array.from(tablist.querySelectorAll('[role="tab"]')) as HTMLElement[];
        const newOrder = triggers.map((trigger) => trigger.getAttribute('data-value') || '').filter(Boolean);

        // Reorder array
        const [removed] = newOrder.splice(state.draggedIndex, 1);
        newOrder.splice(state.overIndex, 0, removed);

        // Call the callback with new order
        props.onTabsReorder?.(newOrder);
      }
    }

    // Clean up visual states
    const tablist = (event.target as HTMLElement).closest('[role="tablist"]');
    if (tablist) {
      const triggers = tablist.querySelectorAll('[role="tab"]');
      triggers.forEach((trigger) => {
        trigger.removeAttribute('data-dragging');
        trigger.removeAttribute('data-drag-over');
      });
    }

    // Reset drag state
    dragState.set({
      draggedValue: null,
      draggedIndex: -1,
      overIndex: -1,
      isDragging: false,
    });
  };

  return () => {
    const { enableDragDrop, onTabsReorder: _, touchEnabled: __, children, ...restProps } = props;

    if (!enableDragDrop) {
      // If drag-drop is disabled, just return the standard TabsList
      return jsx(TabsList, { ...restProps, children });
    }

    // Create TabsList with children
    const tabListElement = jsx(TabsList, {
      ...restProps,
      'aria-dropeffect': 'move',
      children,
    }) as HTMLElement;

    // Setup function to attach drag handlers
    const setupDragHandlers = () => {
      const triggers = tabListElement.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      triggers.forEach((trigger, index) => {
        // Extract value from the trigger's ID or aria-controls
        const triggerId = trigger.id;
        const value = triggerId.replace(/^.*-trigger-/, '');

        // Set drag attributes
        trigger.setAttribute('draggable', 'true');
        trigger.setAttribute('data-tab-index', String(index));
        trigger.setAttribute('data-value', value);

        // Add drag event listeners
        const dragStartHandler = (e: Event) => handleDragStart(e as DragEvent, value, index);
        const dragOverHandler = (e: Event) => handleDragOver(e as DragEvent, index);
        const dragLeaveHandler = (e: Event) => handleDragLeave(e as DragEvent);
        const dropHandler = (e: Event) => handleDrop(e as DragEvent, index);
        const dragEndHandler = (e: Event) => handleDragEnd(e as DragEvent);

        trigger.addEventListener('dragstart', dragStartHandler);
        trigger.addEventListener('dragover', dragOverHandler);
        trigger.addEventListener('dragleave', dragLeaveHandler);
        trigger.addEventListener('drop', dropHandler);
        trigger.addEventListener('dragend', dragEndHandler);

        // Add touch event listeners if enabled
        if (touchEnabled) {
          const touchStartHandler = (e: Event) => handleTouchStart(e as TouchEvent, value, index);
          const touchMoveHandler = (e: Event) => handleTouchMove(e as TouchEvent);
          const touchEndHandler = (e: Event) => handleTouchEnd(e as TouchEvent);

          trigger.addEventListener('touchstart', touchStartHandler);
          trigger.addEventListener('touchmove', touchMoveHandler);
          trigger.addEventListener('touchend', touchEndHandler);
        }
      });
    };

    // Use effect to set up handlers reactively (will run after render)
    effect(setupDragHandlers);

    // Also schedule setup to run after current call stack completes
    // This ensures the element and its children are in the DOM
    queueMicrotask(setupDragHandlers);

    return tabListElement;
  };
});

TabsListWithDragDrop.displayName = 'TabsListWithDragDrop';

// Type exports
export type { TabsPrimitiveProps as TabsProps };
