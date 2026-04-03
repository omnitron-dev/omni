'use client';

/**
 * Popover Component
 *
 * Enhanced popover component with arrow support and useful hook.
 *
 * @module @omnitron-dev/prism/components/popover
 */

import type { ReactNode, MouseEvent, Dispatch, SetStateAction } from 'react';
import { useState, useCallback } from 'react';
import Popover from '@mui/material/Popover';
import { styled, alpha } from '@mui/material/styles';
import type { PopoverProps, PopoverOrigin } from '@mui/material/Popover';
import type { SxProps, Theme, CSSObject } from '@mui/material/styles';
import { listClasses } from '@mui/material/List';
import { menuItemClasses } from '@mui/material/MenuItem';

// =============================================================================
// TYPES
// =============================================================================

export type ArrowPlacement =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'left-top'
  | 'left-center'
  | 'left-bottom'
  | 'right-top'
  | 'right-center'
  | 'right-bottom';

export interface PopoverArrowProps {
  /** Hide the arrow */
  hide?: boolean;
  /** Arrow size in pixels */
  size?: number;
  /** Offset from edge */
  offset?: number;
  /** Arrow placement */
  placement?: ArrowPlacement;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

export interface CustomPopoverProps extends Omit<PopoverProps, 'open'> {
  /** Whether the popover is open */
  open: boolean | Element | null;
  /** Close handler */
  onClose: () => void;
  /** Arrow configuration */
  arrow?: PopoverArrowProps;
  /** Minimum width of the popover */
  minWidth?: number | string;
}

// =============================================================================
// UTILS
// =============================================================================

const POPOVER_DISTANCE = 0.75;

interface AnchorOriginConfig {
  paperStyles?: CSSObject;
  anchorOrigin: PopoverOrigin;
  transformOrigin: PopoverOrigin;
}

function calculateAnchorOrigin(arrow: ArrowPlacement = 'top-right'): AnchorOriginConfig {
  const configs: Record<ArrowPlacement, AnchorOriginConfig> = {
    'top-left': {
      paperStyles: { ml: -POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
      transformOrigin: { vertical: 'top', horizontal: 'left' },
    },
    'top-center': {
      paperStyles: undefined,
      anchorOrigin: { vertical: 'bottom', horizontal: 'center' },
      transformOrigin: { vertical: 'top', horizontal: 'center' },
    },
    'top-right': {
      paperStyles: { ml: POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
      transformOrigin: { vertical: 'top', horizontal: 'right' },
    },
    'bottom-left': {
      paperStyles: { ml: -POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      transformOrigin: { vertical: 'bottom', horizontal: 'left' },
    },
    'bottom-center': {
      paperStyles: undefined,
      anchorOrigin: { vertical: 'top', horizontal: 'center' },
      transformOrigin: { vertical: 'bottom', horizontal: 'center' },
    },
    'bottom-right': {
      paperStyles: { ml: POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'top', horizontal: 'right' },
      transformOrigin: { vertical: 'bottom', horizontal: 'right' },
    },
    'left-top': {
      paperStyles: { mt: -POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'top', horizontal: 'right' },
      transformOrigin: { vertical: 'top', horizontal: 'left' },
    },
    'left-center': {
      paperStyles: undefined,
      anchorOrigin: { vertical: 'center', horizontal: 'right' },
      transformOrigin: { vertical: 'center', horizontal: 'left' },
    },
    'left-bottom': {
      paperStyles: { mt: POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
      transformOrigin: { vertical: 'bottom', horizontal: 'left' },
    },
    'right-top': {
      paperStyles: { mt: -POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'top', horizontal: 'left' },
      transformOrigin: { vertical: 'top', horizontal: 'right' },
    },
    'right-center': {
      paperStyles: undefined,
      anchorOrigin: { vertical: 'center', horizontal: 'left' },
      transformOrigin: { vertical: 'center', horizontal: 'right' },
    },
    'right-bottom': {
      paperStyles: { mt: POPOVER_DISTANCE },
      anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
      transformOrigin: { vertical: 'bottom', horizontal: 'right' },
    },
  };

  return configs[arrow] || configs['top-right'];
}

// =============================================================================
// ARROW COMPONENT
// =============================================================================

interface ArrowStyledProps {
  ownerState: {
    size: number;
    offset: number;
    placement: ArrowPlacement;
  };
}

const Arrow = styled('span', {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<ArrowStyledProps>(({ theme, ownerState }) => {
  const { size, offset, placement } = ownerState;

  const directions: Record<string, CSSObject> = {
    top: { top: 0, rotate: '135deg', translate: '0 -50%' },
    bottom: { bottom: 0, rotate: '-45deg', translate: '0 50%' },
    left: { left: 0, rotate: '45deg', translate: '-50% 0' },
    right: { right: 0, rotate: '-135deg', translate: '50% 0' },
  };

  const getDirection = () => {
    if (placement.startsWith('top-')) return directions.top;
    if (placement.startsWith('bottom-')) return directions.bottom;
    if (placement.startsWith('left-')) return directions.left;
    if (placement.startsWith('right-')) return directions.right;
    return {};
  };

  const getPosition = () => {
    if (placement.endsWith('-left')) return { left: offset };
    if (placement.endsWith('-right')) return { right: offset };
    if (placement.endsWith('-top')) return { top: offset };
    if (placement.endsWith('-bottom')) return { bottom: offset };
    if (placement.endsWith('-center')) {
      if (placement.startsWith('top-') || placement.startsWith('bottom-')) {
        return { left: 0, right: 0, margin: 'auto' };
      }
      return { top: 0, bottom: 0, margin: 'auto' };
    }
    return {};
  };

  return {
    width: size,
    height: size,
    position: 'absolute',
    borderBottomLeftRadius: size / 4,
    clipPath: 'polygon(0% 0%, 100% 100%, 0% 100%)',
    backgroundColor: theme.palette.background.paper,
    border: `solid 1px ${alpha(theme.palette.grey[500], 0.12)}`,
    ...getDirection(),
    ...getPosition(),
  };
});

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * CustomPopover - Enhanced popover with arrow support.
 *
 * @example
 * ```tsx
 * const popover = usePopover();
 *
 * <Button onClick={popover.onOpen}>Open Menu</Button>
 *
 * <CustomPopover
 *   open={popover.open}
 *   onClose={popover.onClose}
 *   anchorEl={popover.anchorEl}
 *   arrow={{ placement: 'top-right' }}
 * >
 *   <MenuItem>Option 1</MenuItem>
 *   <MenuItem>Option 2</MenuItem>
 * </CustomPopover>
 * ```
 */
export function CustomPopover({
  open,
  onClose,
  children,
  anchorEl,
  arrow,
  minWidth = 140,
  slotProps,
  ...other
}: CustomPopoverProps): ReactNode {
  const arrowSize = arrow?.size ?? 14;
  const arrowOffset = arrow?.offset ?? 17;
  const arrowPlacement = arrow?.placement ?? 'top-right';
  const hideArrow = arrow?.hide ?? false;

  const { paperStyles, anchorOrigin, transformOrigin } = calculateAnchorOrigin(arrowPlacement);

  const isOpen = Boolean(open);

  return (
    <Popover
      open={isOpen}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        ...slotProps,
        paper: {
          ...(typeof slotProps?.paper === 'object' ? slotProps.paper : {}),
          sx: [
            paperStyles as SxProps<Theme>,
            {
              overflow: 'inherit',
              [`& .${listClasses.root}`]: { minWidth },
              [`& .${menuItemClasses.root}`]: { gap: 2 },
            },
            ...(typeof slotProps?.paper === 'object' && slotProps.paper && 'sx' in slotProps.paper
              ? Array.isArray(slotProps.paper.sx)
                ? slotProps.paper.sx
                : [slotProps.paper.sx]
              : []),
          ],
        },
      }}
      {...other}
    >
      {!hideArrow && (
        <Arrow
          ownerState={{
            size: arrowSize,
            offset: arrowOffset,
            placement: arrowPlacement,
          }}
          sx={arrow?.sx}
        />
      )}
      {children}
    </Popover>
  );
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Return type for usePopover hook with generic element type.
 *
 * @typeParam T - The HTML element type (default: HTMLElement)
 */
export interface UsePopoverReturn<T extends HTMLElement = HTMLElement> {
  /** Whether the popover is open */
  open: boolean;
  /** The anchor element (typed to T) */
  anchorEl: T | null;
  /** Open the popover - accepts MouseEvent with typed currentTarget */
  onOpen: (event: MouseEvent<T>) => void;
  /** Close the popover */
  onClose: () => void;
  /** Set the anchor element directly (typed to T | null) */
  setAnchorEl: Dispatch<SetStateAction<T | null>>;
}

/**
 * usePopover - Generic hook for managing popover state.
 *
 * Type-safe hook that accepts a generic type parameter for the anchor element.
 * This ensures type safety when accessing `event.currentTarget` and `anchorEl`.
 *
 * @typeParam T - The HTML element type (default: HTMLElement)
 * @returns Popover state and controls with typed elements
 *
 * @example
 * ```tsx
 * // Basic usage with default HTMLElement
 * function MenuButton() {
 *   const popover = usePopover();
 *
 *   return (
 *     <>
 *       <IconButton onClick={popover.onOpen}>
 *         <MoreVertIcon />
 *       </IconButton>
 *
 *       <CustomPopover
 *         open={popover.open}
 *         onClose={popover.onClose}
 *         anchorEl={popover.anchorEl}
 *       >
 *         <MenuItem onClick={popover.onClose}>Edit</MenuItem>
 *         <MenuItem onClick={popover.onClose}>Delete</MenuItem>
 *       </CustomPopover>
 *     </>
 *   );
 * }
 *
 * // Type-safe usage with specific element type
 * function TypedButton() {
 *   const popover = usePopover<HTMLButtonElement>();
 *
 *   // TypeScript knows anchorEl is HTMLButtonElement | null
 *   // and onOpen accepts MouseEvent<HTMLButtonElement>
 *
 *   return (
 *     <>
 *       <button onClick={popover.onOpen}>Click me</button>
 *       <Popover open={popover.open} anchorEl={popover.anchorEl} onClose={popover.onClose}>
 *         Content here
 *       </Popover>
 *     </>
 *   );
 * }
 * ```
 */
export function usePopover<T extends HTMLElement = HTMLElement>(): UsePopoverReturn<T> {
  const [anchorEl, setAnchorEl] = useState<T | null>(null);

  const onOpen = useCallback((event: MouseEvent<T>) => {
    setAnchorEl(event.currentTarget as T);
  }, []);

  const onClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  return {
    open: Boolean(anchorEl),
    anchorEl,
    onOpen,
    onClose,
    setAnchorEl,
  };
}
