/**
 * Styled Resizable Component
 *
 * Resizable panels with drag handles.
 * Built on top of the Resizable primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Resizable as ResizablePrimitive,
  ResizablePanel as ResizablePanelPrimitive,
  ResizableHandle as ResizableHandlePrimitive,
  type ResizableProps as ResizablePrimitiveProps,
} from '../../primitives/Resizable.js';

/**
 * Resizable - Root container
 */
export const Resizable = styled<{
  direction?: 'horizontal' | 'vertical';
}>(ResizablePrimitive, {
  base: {
    display: 'flex',
    width: '100%',
    height: '100%',
  },
  variants: {
    direction: {
      horizontal: {
        flexDirection: 'row',
      },
      vertical: {
        flexDirection: 'column',
      },
    },
  },
  defaultVariants: {
    direction: 'horizontal',
  },
});

/**
 * ResizablePanel - Individual resizable panel
 */
export const ResizablePanel = styled(ResizablePanelPrimitive, {
  base: {
    flex: '1',
    overflow: 'auto',
    minWidth: '0',
    minHeight: '0',
  },
});

/**
 * ResizableHandle - Drag handle between panels
 */
export const ResizableHandle = styled<{
  direction?: 'horizontal' | 'vertical';
}>(ResizableHandlePrimitive, {
  base: {
    position: 'relative',
    flexShrink: '0',
    backgroundColor: '#e5e7eb',
    transition: 'background-color 0.15s ease',
    '&:hover': {
      backgroundColor: '#3b82f6',
    },
    '&:focus': {
      outline: 'none',
      backgroundColor: '#3b82f6',
    },
    '&[data-dragging]': {
      backgroundColor: '#2563eb',
    },
  },
  variants: {
    direction: {
      horizontal: {
        width: '4px',
        cursor: 'col-resize',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '20px',
          height: '40px',
        },
      },
      vertical: {
        height: '4px',
        cursor: 'row-resize',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '40px',
          height: '20px',
        },
      },
    },
  },
  defaultVariants: {
    direction: 'horizontal',
  },
});

// Attach sub-components
(Resizable as any).Panel = ResizablePanel;
(Resizable as any).Handle = ResizableHandle;

// Display names
Resizable.displayName = 'Resizable';
ResizablePanel.displayName = 'ResizablePanel';
ResizableHandle.displayName = 'ResizableHandle';

// Type exports
export type { ResizablePrimitiveProps as ResizableProps };
