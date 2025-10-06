/**
 * UI Primitives
 *
 * Headless, accessible UI components
 *
 * @module primitives
 */

// Dialog
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogContext,
  type DialogProps,
  type DialogContextValue,
  type DialogTriggerProps,
  type DialogContentProps,
} from './Dialog.js';

// Popover
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverClose,
  PopoverContext,
  type PopoverProps,
  type PopoverContextValue,
  type PopoverTriggerProps,
  type PopoverContentProps,
  type PopoverArrowProps,
  type PopoverCloseProps,
} from './Popover.js';

// Utilities
export {
  // ID generation
  generateId,
  useId,
  createIdGenerator,
  // Focus management
  getFocusableElements,
  getFocusableBounds,
  focusFirst,
  saveFocus,
  restoreFocus,
  trapFocus,
  // Scroll lock
  disableBodyScroll,
  enableBodyScroll,
  isBodyScrollLocked,
  forceUnlockBodyScroll,
  // Positioning
  calculatePosition,
  applyPosition,
  calculateArrowPosition,
  type Side,
  type Align,
  type PositionConfig,
  type Position,
} from './utils/index.js';
