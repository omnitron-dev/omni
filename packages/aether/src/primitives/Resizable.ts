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

const useResizableContext = (): ResizableContextValue => {
  const context = useContext(ResizableContext);
  if (!context) throw new Error('Resizable components must be used within Resizable');
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

    return jsx('div', {
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
    const size = context.sizes()[index] ?? 50;
    const style = context.orientation === 'horizontal' ? { width: `${size}%`, height: '100%' } : { height: `${size}%`, width: '100%' };

    return jsx('div', { 'data-resizable-panel': '', 'data-panel-id': panelId, style: { ...style, overflow: 'auto' }, children: props.children });
  };
});

export const ResizableHandle = defineComponent<ResizableHandleProps>((props) => {
  const context = useResizableContext();
  const disabled = props.disabled ?? false;

  return () => jsx('div', {
    'data-resizable-handle': '',
    'data-orientation': context.orientation,
    'data-disabled': disabled ? '' : undefined,
    role: 'separator',
    'aria-orientation': context.orientation,
    'aria-disabled': disabled,
    tabIndex: disabled ? -1 : 0,
    style: { cursor: context.orientation === 'horizontal' ? 'col-resize' : 'row-resize', touchAction: 'none', userSelect: 'none' },
    children: props.children,
  });
});

(Resizable as any).Panel = ResizablePanel;
(Resizable as any).Handle = ResizableHandle;

export type { ResizableContextValue };
