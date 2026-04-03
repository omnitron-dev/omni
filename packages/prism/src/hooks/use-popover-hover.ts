'use client';

/**
 * usePopoverHover Hook
 *
 * Manages hover-based popover state with proper enter/leave handling.
 * Different from click-based popovers - opens on mouse enter, closes on leave.
 *
 * @module @omnitron/prism/hooks
 */

import { useState, useCallback, useRef, type RefObject, type Dispatch, type SetStateAction } from 'react';

/**
 * Return type for usePopoverHover hook.
 */
export interface UsePopoverHoverReturn<T extends HTMLElement = HTMLElement> {
  /** Whether the popover is open */
  open: boolean;
  /** The element the popover is anchored to (for MUI Popover) */
  anchorEl: T | null;
  /** Handler for mouse enter - opens the popover */
  onOpen: () => void;
  /** Handler for mouse leave - closes the popover */
  onClose: () => void;
  /** Ref to attach to the trigger element */
  elementRef: RefObject<T | null>;
  /** Manual control of open state */
  setOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * usePopoverHover - Hook for hover-based popover management.
 *
 * This hook is SSR-safe. It doesn't access browser APIs directly.
 * During SSR, elementRef.current is null and open defaults to false,
 * so anchorEl will always be null on the server.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { open, anchorEl, onOpen, onClose, elementRef } = usePopoverHover<HTMLButtonElement>();
 *
 * return (
 *   <>
 *     <Button
 *       ref={elementRef}
 *       onMouseEnter={onOpen}
 *       onMouseLeave={onClose}
 *     >
 *       Hover me
 *     </Button>
 *     <Popover
 *       open={open}
 *       anchorEl={anchorEl}
 *       onClose={onClose}
 *       anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
 *     >
 *       <Typography sx={{ p: 2 }}>Popover content</Typography>
 *     </Popover>
 *   </>
 * );
 *
 * // With existing ref
 * const myRef = useRef<HTMLDivElement>(null);
 * const { open, onOpen, onClose } = usePopoverHover(myRef);
 *
 * // With delay (using inline)
 * const { open, anchorEl, elementRef, setOpen } = usePopoverHover();
 * const timeoutRef = useRef<NodeJS.Timeout>();
 *
 * const handleOpen = () => {
 *   clearTimeout(timeoutRef.current);
 *   setOpen(true);
 * };
 *
 * const handleClose = () => {
 *   timeoutRef.current = setTimeout(() => setOpen(false), 200);
 * };
 * ```
 */
export function usePopoverHover<T extends HTMLElement = HTMLElement>(
  inputRef?: RefObject<T | null>
): UsePopoverHoverReturn<T> {
  const internalRef = useRef<T>(null);
  const elementRef = (inputRef ?? internalRef) as RefObject<T | null>;

  const [open, setOpen] = useState(false);

  const onOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
  }, []);

  // anchorEl is the current element when open, null when closed
  const anchorEl = open ? elementRef.current : null;

  return {
    open,
    anchorEl,
    onOpen,
    onClose,
    elementRef,
    setOpen,
  };
}
