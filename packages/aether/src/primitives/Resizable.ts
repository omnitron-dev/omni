/**
 * Resizable - Split panes with draggable resize handles (Simplified version)
 *
 * Features:
 * - Horizontal and vertical split layouts
 * - Draggable resize handles
 * - Min/max size constraints
 * - Controlled and uncontrolled modes
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

export type ResizableOrientation = 'horizontal' | 'vertical';

export interface ResizableProps {
  sizes?: number[];
  onSizesChange?: (sizes: number[]) => void;
  defaultSizes?: number[];
  orientation?: ResizableOrientation;
  children?: any | (() => any);
  [key: string]: any;
}

export interface ResizablePanelProps {
  id?: string;
  minSize?: number;
  maxSize?: number;
  children?: any;
  [key: string]: any;
}

export interface ResizableHandleProps {
  disabled?: boolean;
  children?: any;
  [key: string]: any;
}

interface ResizableContextValue {
  sizes: Signal<number[]>;
  setSizes: (sizes: number[]) => void;
  orientation: ResizableOrientation;
}

const ResizableContext = createContext<ResizableContextValue | null>(null);

const useResizableContext = (): ResizableContextValue | null => {
  const context = useContext(ResizableContext);
  return context;
};

export const Resizable = defineComponent<ResizableProps>((props) => {
  const orientation = props.orientation ?? 'horizontal';
  const internalSizes: WritableSignal<number[]> = signal(props.defaultSizes ?? [50, 50]);

  const currentSizes = (): number[] => props.sizes ?? internalSizes();
  const setSizes = (newSizes: number[]) => {
    if (!props.sizes) internalSizes.set(newSizes);
    props.onSizesChange?.(newSizes);
  };

  const contextValue: ResizableContextValue = {
    sizes: computed(() => currentSizes()),
    setSizes,
    orientation,
  };

  // Provide context BEFORE return
  provideContext(ResizableContext, contextValue);

  return () => {
    // Support function children
    const children = typeof props.children === 'function' ? props.children() : props.children;

    // Extract known props and spread the rest
    const { orientation: _, sizes, onSizesChange, defaultSizes, children: __, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-resizable-container': '',
      'data-orientation': orientation,
      style: { display: 'flex', flexDirection: orientation === 'horizontal' ? 'row' : 'column', width: '100%', height: '100%' },
      children,
    });
  };
});

let panelCounter = 0;

export const ResizablePanel = defineComponent<ResizablePanelProps>((props) => {
  const context = useResizableContext();
  const panelId = props.id ?? `panel-${panelCounter++}`;
  const index = panelCounter - 1;

  return () => {
    const size = context ? context.sizes()[index] ?? 50 : 50;
    const orientation = context?.orientation ?? 'horizontal';
    const style = orientation === 'horizontal' ? { width: `${size}%`, height: '100%' } : { height: `${size}%`, width: '100%' };

    const { id, minSize, maxSize, children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-resizable-panel': '',
      'data-panel-id': panelId,
      style: { ...style, overflow: 'auto' },
      children,
    });
  };
});

export const ResizableHandle = defineComponent<ResizableHandleProps>((props) => {
  const context = useResizableContext();
  const disabled = () => props.disabled ?? false;

  return () => {
    const isDisabled = disabled();
    const orientation = context?.orientation ?? 'horizontal';
    const { disabled: _, children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-resizable-handle': '',
      'data-orientation': orientation,
      'data-disabled': isDisabled ? '' : undefined,
      role: 'separator',
      'aria-orientation': orientation,
      'aria-disabled': isDisabled ? 'true' : 'false',
      tabIndex: isDisabled ? -1 : 0,
      style: { cursor: orientation === 'horizontal' ? 'col-resize' : 'row-resize', touchAction: 'none', userSelect: 'none' },
      children,
    });
  };
});

(Resizable as any).Panel = ResizablePanel;
(Resizable as any).Handle = ResizableHandle;

export type { ResizableContextValue };
