/**
 * Positioning Utilities for Popover/Tooltip
 *
 * Simple positioning system for floating elements
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

export interface PositionConfig {
  side?: Side;
  align?: Align;
  sideOffset?: number;
  alignOffset?: number;
  avoidCollisions?: boolean;
  collisionPadding?: number;
}

export interface Position {
  top: number;
  left: number;
  side: Side;
  align: Align;
}

/**
 * Calculate position for floating element
 */
export function calculatePosition(anchor: HTMLElement, floating: HTMLElement, config: PositionConfig = {}): Position {
  const {
    side = 'bottom',
    align = 'center',
    sideOffset = 0,
    alignOffset = 0,
    avoidCollisions = true,
    collisionPadding = 10,
  } = config;

  const anchorRect = anchor.getBoundingClientRect();
  const floatingRect = floating.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let finalSide = side;
  let top = 0;
  let left = 0;

  // Calculate base position
  switch (side) {
    case 'top':
      top = anchorRect.top - floatingRect.height - sideOffset;
      break;
    case 'bottom':
      top = anchorRect.bottom + sideOffset;
      break;
    case 'left':
      left = anchorRect.left - floatingRect.width - sideOffset;
      break;
    case 'right':
      left = anchorRect.right + sideOffset;
      break;
  }

  // Calculate alignment
  if (side === 'top' || side === 'bottom') {
    switch (align) {
      case 'start':
        left = anchorRect.left + alignOffset;
        break;
      case 'center':
        left = anchorRect.left + anchorRect.width / 2 - floatingRect.width / 2 + alignOffset;
        break;
      case 'end':
        left = anchorRect.right - floatingRect.width - alignOffset;
        break;
    }
  } else {
    switch (align) {
      case 'start':
        top = anchorRect.top + alignOffset;
        break;
      case 'center':
        top = anchorRect.top + anchorRect.height / 2 - floatingRect.height / 2 + alignOffset;
        break;
      case 'end':
        top = anchorRect.bottom - floatingRect.height - alignOffset;
        break;
    }
  }

  // Collision detection and flipping
  if (avoidCollisions) {
    const padding = collisionPadding;

    // Check vertical overflow
    if (side === 'top' && top < padding) {
      // Flip to bottom
      finalSide = 'bottom';
      top = anchorRect.bottom + sideOffset;
    } else if (side === 'bottom' && top + floatingRect.height > viewportHeight - padding) {
      // Flip to top
      finalSide = 'top';
      top = anchorRect.top - floatingRect.height - sideOffset;
    }

    // Check horizontal overflow
    if (side === 'left' && left < padding) {
      // Flip to right
      finalSide = 'right';
      left = anchorRect.right + sideOffset;
    } else if (side === 'right' && left + floatingRect.width > viewportWidth - padding) {
      // Flip to left
      finalSide = 'left';
      left = anchorRect.left - floatingRect.width - sideOffset;
    }

    // Constrain to viewport (shift)
    if (left < padding) {
      left = padding;
    } else if (left + floatingRect.width > viewportWidth - padding) {
      left = viewportWidth - floatingRect.width - padding;
    }

    if (top < padding) {
      top = padding;
    } else if (top + floatingRect.height > viewportHeight - padding) {
      top = viewportHeight - floatingRect.height - padding;
    }
  }

  return {
    top,
    left,
    side: finalSide,
    align,
  };
}

/**
 * Apply position to floating element
 */
export function applyPosition(element: HTMLElement, position: Position): void {
  element.style.position = 'fixed';
  element.style.top = `${position.top}px`;
  element.style.left = `${position.left}px`;
  element.style.margin = '0';
}

/**
 * Calculate arrow position
 */
export function calculateArrowPosition(
  anchor: HTMLElement,
  floating: HTMLElement,
  side: Side,
  align: Align
): { top?: string; left?: string; bottom?: string; right?: string } {
  const anchorRect = anchor.getBoundingClientRect();
  const floatingRect = floating.getBoundingClientRect();

  const arrowPos: any = {};

  if (side === 'top' || side === 'bottom') {
    // Horizontal arrow position
    if (align === 'start') {
      arrowPos.left = `${anchorRect.width / 2}px`;
    } else if (align === 'center') {
      const anchorCenter = anchorRect.left + anchorRect.width / 2 - floatingRect.left;
      arrowPos.left = `${Math.max(10, Math.min(floatingRect.width - 10, anchorCenter))}px`;
    } else {
      arrowPos.right = `${anchorRect.width / 2}px`;
    }

    // Vertical arrow position
    if (side === 'top') {
      arrowPos.bottom = '-5px';
    } else {
      arrowPos.top = '-5px';
    }
  } else {
    // Vertical arrow position
    if (align === 'start') {
      arrowPos.top = `${anchorRect.height / 2}px`;
    } else if (align === 'center') {
      const anchorCenter = anchorRect.top + anchorRect.height / 2 - floatingRect.top;
      arrowPos.top = `${Math.max(10, Math.min(floatingRect.height - 10, anchorCenter))}px`;
    } else {
      arrowPos.bottom = `${anchorRect.height / 2}px`;
    }

    // Horizontal arrow position
    if (side === 'left') {
      arrowPos.right = '-5px';
    } else {
      arrowPos.left = '-5px';
    }
  }

  return arrowPos;
}
