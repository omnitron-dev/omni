/**
 * ContextMenu Primitive
 *
 * A menu triggered by right-clicking (or long-pressing on touch devices) on an element.
 *
 * Based on WAI-ARIA Menu pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/menu/
 */

import { defineComponent } from '../core/component/define.js';
import { useContext } from '../core/component/context.js';
import { jsx } from '../jsx-runtime.js';
import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';

// ============================================================================
// Create Base ContextMenu using Factory
// ============================================================================

const ContextMenuBase = createOverlayPrimitive({
  name: 'context-menu',
  modal: false,
  role: 'menu',
  positioning: false, // Uses custom mouse position, not anchor positioning
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: true,
  closeOnClickOutside: true,
  triggerBehavior: 'contextmenu', // Right-click to open
  hasTitle: false,
  hasDescription: false,
});

// ============================================================================
// Types
// ============================================================================

export interface ContextMenuProps {
  children?: any;
  onOpenChange?: (open: boolean) => void;
}

export interface ContextMenuTriggerProps {
  children?: any;
  disabled?: boolean;
  [key: string]: any;
}

export interface ContextMenuContentProps {
  children?: any;
  loop?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface ContextMenuContextValue {
  isOpen: () => boolean;
  open: (x: number, y: number) => void;
  close: () => void;
  position: () => { x: number; y: number } | null;
  menuId: string;
  triggerId: string;
  contentId: string;
}

export const ContextMenuContext = ContextMenuBase.Context;

// ============================================================================
// Components
// ============================================================================

/**
 * ContextMenu root component
 *
 * @example
 * ```tsx
 * <ContextMenu>
 *   <ContextMenu.Trigger>
 *     <div>Right click here</div>
 *   </ContextMenu.Trigger>
 *   <ContextMenu.Content>
 *     <ContextMenu.Item>Cut</ContextMenu.Item>
 *     <ContextMenu.Item>Copy</ContextMenu.Item>
 *     <ContextMenu.Item>Paste</ContextMenu.Item>
 *   </ContextMenu.Content>
 * </ContextMenu>
 * ```
 */
export const ContextMenu = ContextMenuBase.Root;

/**
 * ContextMenu Trigger component
 * Uses factory-generated Trigger with contextmenu behavior
 */
export const ContextMenuTrigger = ContextMenuBase.Trigger;

/**
 * ContextMenu Content component
 * Uses factory-generated Content with custom positioning at mouse coordinates
 */
export const ContextMenuContent = ContextMenuBase.Content;

/**
 * ContextMenu Item component
 */
export const ContextMenuItem = defineComponent<{
  children?: any;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
  [key: string]: any;
}>((props) => {
  const ctx = useContext(ContextMenuContext);

  const handleClick = (e: Event) => {
    if (props.disabled) return;

    props.onSelect?.(e);
    ctx.close();
  };

  return () =>
    jsx('div', {
      ...props,
      role: 'menuitem',
      tabIndex: props.disabled ? -1 : 0,
      'data-disabled': props.disabled ? '' : undefined,
      onClick: handleClick,
    });
});

/**
 * ContextMenu Separator component
 */
export const ContextMenuSeparator = defineComponent<{ [key: string]: any }>(
  (props) => () =>
    jsx('div', {
      ...props,
      role: 'separator',
      'aria-orientation': 'horizontal',
    })
);

/**
 * ContextMenu Label component
 */
export const ContextMenuLabel = defineComponent<{ children?: any; [key: string]: any }>(
  (props) => () =>
    jsx('div', {
      ...props,
      'data-context-menu-label': '',
    })
);

// ============================================================================
// Sub-component Attachment
// ============================================================================

(ContextMenu as any).Trigger = ContextMenuTrigger;
(ContextMenu as any).Content = ContextMenuContent;
(ContextMenu as any).Item = ContextMenuItem;
(ContextMenu as any).Separator = ContextMenuSeparator;
(ContextMenu as any).Label = ContextMenuLabel;
