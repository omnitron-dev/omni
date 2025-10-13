/**
 * Popover Primitive
 *
 * Non-modal floating element positioned relative to a trigger
 *
 * Based on WAI-ARIA practices:
 * https://www.w3.org/WAI/ARIA/apg/patterns/
 */

import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';

// ============================================================================
// Create Base Popover using Factory
// ============================================================================

const PopoverBase = createOverlayPrimitive({
  name: 'popover',
  modal: false,
  role: 'dialog',
  positioning: true,
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: true,
  closeOnClickOutside: true,
  hasTitle: false, // Popover typically doesn't have title/description
  hasDescription: false,
  hasArrow: true,
});

// ============================================================================
// Types
// ============================================================================

/**
 * Popover context
 */
export interface PopoverContextValue {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  anchorElement: () => HTMLElement | null;
  setAnchorElement: (el: HTMLElement | null) => void;
}

/**
 * Popover props
 */
export interface PopoverProps {
  /**
   * Controlled open state
   */
  open?: boolean;

  /**
   * Initial open state (uncontrolled)
   */
  defaultOpen?: boolean;

  /**
   * Whether the popover is modal (default: false)
   */
  modal?: boolean;

  /**
   * Callback when open state changes
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Children
   */
  children: any;
}

/**
 * Popover trigger props
 */
export interface PopoverTriggerProps {
  children: any;
  [key: string]: any;
}

/**
 * Popover content props
 */
export interface PopoverContentProps {
  /**
   * Preferred side
   */
  side?: 'top' | 'right' | 'bottom' | 'left';

  /**
   * Alignment
   */
  align?: 'start' | 'center' | 'end';

  /**
   * Offset from anchor
   */
  sideOffset?: number;

  /**
   * Offset along alignment axis
   */
  alignOffset?: number;

  /**
   * Auto-flip/shift to avoid viewport edges
   */
  avoidCollisions?: boolean;

  /**
   * Padding from edges
   */
  collisionPadding?: number;

  /**
   * Callback on Escape key
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;

  /**
   * Callback on pointer down outside
   */
  onPointerDownOutside?: (event: PointerEvent) => void;

  /**
   * Children
   */
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Popover arrow props
 */
export interface PopoverArrowProps {
  /**
   * Arrow width
   */
  width?: number;

  /**
   * Arrow height
   */
  height?: number;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Popover anchor props
 */
export interface PopoverAnchorProps {
  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

/**
 * Popover close button
 */
export interface PopoverCloseProps {
  children: any;
  [key: string]: any;
}

// ============================================================================
// Context Export
// ============================================================================

export const PopoverContext = PopoverBase.Context;

// ============================================================================
// Component Exports
// ============================================================================

/**
 * Popover root component
 */
export const Popover = PopoverBase.Root;

/**
 * Popover trigger button
 */
export const PopoverTrigger = PopoverBase.Trigger;

/**
 * Popover content
 */
export const PopoverContent = PopoverBase.Content;

/**
 * Popover arrow
 */
export const PopoverArrow = PopoverBase.Arrow;

/**
 * Popover anchor - provides a reference element for positioning
 */
export const PopoverAnchor = PopoverBase.Anchor;

/**
 * Popover close button
 */
export const PopoverClose = PopoverBase.Close;

// ============================================================================
// Sub-component Attachment
// ============================================================================

(Popover as any).Trigger = PopoverTrigger;
(Popover as any).Content = PopoverContent;
(Popover as any).Arrow = PopoverArrow;
(Popover as any).Anchor = PopoverAnchor;
(Popover as any).Close = PopoverClose;
