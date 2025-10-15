/**
 * SplitView - High-level split-pane layout component
 *
 * A composition of the Resizable primitive that makes it easy to create
 * split-pane layouts with multiple panels, size constraints, collapsible
 * panels, and optional persistence to localStorage.
 *
 * Features:
 * - Support for horizontal and vertical splits
 * - Multiple panels (not just 2)
 * - Default size configuration for each panel
 * - Minimum and maximum size constraints
 * - Collapsible panels
 * - Persistence of panel sizes to localStorage (optional)
 *
 * @example
 * ```tsx
 * <SplitView direction="horizontal" panels={[
 *   { id: 'sidebar', defaultSize: 250, minSize: 200, maxSize: 400, collapsible: true },
 *   { id: 'main', defaultSize: '*', minSize: 400 },
 *   { id: 'inspector', defaultSize: 300, minSize: 200, collapsible: true }
 * ]}>
 *   <SplitView.Panel id="sidebar">{content}</SplitView.Panel>
 *   <SplitView.Panel id="main">{content}</SplitView.Panel>
 *   <SplitView.Panel id="inspector">{content}</SplitView.Panel>
 * </SplitView>
 * ```
 */

import { defineComponent } from '../../core/component/define.js';
import { createContext, useContext, provideContext } from '../../core/component/context.js';
import type { Signal, WritableSignal } from '../../core/reactivity/types.js';
import { signal, computed } from '../../core/reactivity/index.js';
import { effect } from '../../core/reactivity/effect.js';
import { jsx } from '../../jsx-runtime.js';
import { styled } from '../../styling/styled.js';
import {
  Resizable as ResizablePrimitive,
  ResizablePanel as ResizablePanelPrimitive,
  ResizableHandle as ResizableHandlePrimitive,
} from '../../primitives/Resizable.js';

// ============================================================================
// Types
// ============================================================================

export type SplitViewDirection = 'horizontal' | 'vertical';

export interface PanelConfig {
  /**
   * Unique identifier for the panel
   */
  id: string;

  /**
   * Default size in pixels or '*' for flexible sizing
   */
  defaultSize: number | string;

  /**
   * Minimum size in pixels
   */
  minSize?: number;

  /**
   * Maximum size in pixels
   */
  maxSize?: number;

  /**
   * Whether the panel can be collapsed
   */
  collapsible?: boolean;

  /**
   * Initial collapsed state
   */
  defaultCollapsed?: boolean;
}

export interface SplitViewProps {
  /**
   * Direction of the split (horizontal = left-right, vertical = top-bottom)
   */
  direction?: SplitViewDirection;

  /**
   * Panel configurations
   */
  panels: PanelConfig[];

  /**
   * Storage key for persisting panel sizes to localStorage
   */
  storageKey?: string;

  /**
   * Callback when panel sizes change
   */
  onSizesChange?: (sizes: number[]) => void;

  /**
   * Children (should be SplitView.Panel components)
   */
  children?: any | (() => any);

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface SplitViewPanelProps {
  /**
   * Panel ID (must match one in the panels config)
   */
  id: string;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface SplitViewContextValue {
  direction: SplitViewDirection;
  panels: PanelConfig[];
  sizes: Signal<number[]>;
  collapsed: Signal<Map<string, boolean>>;
  setSizes: (sizes: number[]) => void;
  togglePanel: (id: string) => void;
  isCollapsed: (id: string) => boolean;
}

const SplitViewContext = createContext<SplitViewContextValue | null>(null);

const useSplitViewContext = (): SplitViewContextValue => {
  const context = useContext(SplitViewContext);
  if (!context) {
    throw new Error('SplitView.Panel must be used within a SplitView component');
  }
  return context;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate initial sizes based on panel configurations
 */
function calculateInitialSizes(panels: PanelConfig[], totalSize: number): number[] {
  const sizes: number[] = [];
  const flexPanels: number[] = [];
  let totalFixed = 0;

  // First pass: calculate fixed sizes
  panels.forEach((panel, index) => {
    if (typeof panel.defaultSize === 'number') {
      sizes[index] = panel.defaultSize;
      totalFixed += panel.defaultSize;
    } else {
      flexPanels.push(index);
    }
  });

  // Second pass: distribute remaining space to flex panels
  const remainingSize = totalSize - totalFixed;
  const flexSize = remainingSize / flexPanels.length;

  flexPanels.forEach((index) => {
    sizes[index] = flexSize;
  });

  return sizes;
}

/**
 * Load sizes from localStorage
 */
function loadSizesFromStorage(storageKey: string): number[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to load panel sizes from localStorage:', error);
  }

  return null;
}

/**
 * Save sizes to localStorage
 */
function saveSizesToStorage(storageKey: string, sizes: number[]): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(storageKey, JSON.stringify(sizes));
  } catch (error) {
    console.warn('Failed to save panel sizes to localStorage:', error);
  }
}

/**
 * Convert pixel sizes to percentages
 */
function sizesToPercentages(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => (size / total) * 100);
}

// ============================================================================
// Components
// ============================================================================

/**
 * SplitView - Root component
 */
export const SplitView = defineComponent<SplitViewProps>((props) => {
  const direction = props.direction ?? 'horizontal';
  const panels = props.panels || [];

  // Initialize sizes
  const defaultSize = direction === 'horizontal' ? 1000 : 600; // Default container size
  const initialSizes = props.storageKey
    ? loadSizesFromStorage(props.storageKey) || calculateInitialSizes(panels, defaultSize)
    : calculateInitialSizes(panels, defaultSize);

  const internalSizes: WritableSignal<number[]> = signal(initialSizes);

  // Track collapsed state for each panel
  const collapsedMap = new Map<string, boolean>();
  panels.forEach((panel) => {
    if (panel.collapsible && panel.defaultCollapsed) {
      collapsedMap.set(panel.id, true);
    }
  });
  const collapsedState: WritableSignal<Map<string, boolean>> = signal(collapsedMap);

  const setSizes = (newSizes: number[]) => {
    // Apply min/max constraints
    const constrainedSizes = newSizes.map((size, index) => {
      const panel = panels[index];
      if (!panel) return size;

      let constrainedSize = size;
      if (panel.minSize !== undefined) {
        constrainedSize = Math.max(constrainedSize, panel.minSize);
      }
      if (panel.maxSize !== undefined) {
        constrainedSize = Math.min(constrainedSize, panel.maxSize);
      }
      return constrainedSize;
    });

    internalSizes.set(constrainedSizes);

    // Save to localStorage if configured
    if (props.storageKey) {
      saveSizesToStorage(props.storageKey, constrainedSizes);
    }

    // Call callback
    props.onSizesChange?.(constrainedSizes);
  };

  const togglePanel = (id: string) => {
    const currentCollapsed = collapsedState();
    const newCollapsed = new Map(currentCollapsed);
    const isCurrentlyCollapsed = newCollapsed.get(id) || false;
    newCollapsed.set(id, !isCurrentlyCollapsed);
    collapsedState.set(newCollapsed);
  };

  const isCollapsed = (id: string): boolean => {
    return collapsedState().get(id) || false;
  };

  const contextValue: SplitViewContextValue = {
    direction,
    panels,
    sizes: computed(() => internalSizes()),
    collapsed: computed(() => collapsedState()),
    setSizes,
    togglePanel,
    isCollapsed,
  };

  // Provide context for children
  provideContext(SplitViewContext, contextValue);

  return () => {
    const children = typeof props.children === 'function' ? props.children() : props.children;

    // Filter out component-specific props
    const {
      direction: _direction,
      panels: _panels,
      storageKey: _storageKey,
      onSizesChange: _onSizesChange,
      children: _children,
      ...restProps
    } = props;

    // Convert pixel sizes to percentages for Resizable
    const percentages = sizesToPercentages(internalSizes());

    return jsx(
      ResizablePrimitive,
      {
        ...restProps,
        orientation: direction,
        sizes: percentages,
        onSizesChange: (newPercentages: number[]) => {
          // Convert percentages back to pixels (approximate)
          const total = internalSizes().reduce((sum, size) => sum + size, 0);
          const pixelSizes = newPercentages.map((pct) => (pct / 100) * total);
          setSizes(pixelSizes);
        },
      },
      children
    );
  };
});

/**
 * SplitViewPanel - Individual panel within a SplitView
 */
export const SplitViewPanel = defineComponent<SplitViewPanelProps>((props) => {
  const context = useSplitViewContext();
  const panelId = props.id;

  // Find panel config
  const panelConfig = context.panels.find((p) => p.id === panelId);
  if (!panelConfig) {
    throw new Error(`Panel config not found for id: ${panelId}`);
  }

  return () => {
    const isCollapsed = context.isCollapsed(panelId);
    const { id: _id, children, ...restProps } = props;

    return jsx(
      ResizablePanelPrimitive,
      {
        ...restProps,
        id: panelId,
        minSize: panelConfig.minSize,
        maxSize: panelConfig.maxSize,
        style: {
          ...props.style,
          display: isCollapsed ? 'none' : undefined,
        },
      },
      children
    );
  };
});

/**
 * SplitViewHandle - Draggable handle between panels
 */
const SplitViewHandlePrimitive = defineComponent<{
  panelId?: string;
  children?: any;
  [key: string]: any;
}>((props) => {
  const context = useSplitViewContext();

  return () => {
    const { panelId, children, ...restProps } = props;

    // If associated with a collapsible panel, add toggle functionality
    const panelConfig = panelId ? context.panels.find((p) => p.id === panelId) : null;
    const isCollapsible = panelConfig?.collapsible || false;
    const isCollapsed = panelId ? context.isCollapsed(panelId) : false;

    const handleDoubleClick = isCollapsible && panelId ? () => context.togglePanel(panelId) : undefined;

    return jsx(ResizableHandlePrimitive, {
      ...restProps,
      'data-collapsible': isCollapsible ? '' : undefined,
      'data-collapsed': isCollapsed ? '' : undefined,
      onDblClick: handleDoubleClick,
      title: isCollapsible ? 'Double-click to collapse/expand' : undefined,
      children,
    });
  };
});

// Styled Handle with visual feedback
export const SplitViewHandle = styled<{
  direction?: 'horizontal' | 'vertical';
}>(SplitViewHandlePrimitive, {
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
    '&[data-collapsible]:hover': {
      backgroundColor: '#8b5cf6',
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
(SplitView as any).Panel = SplitViewPanel;
(SplitView as any).Handle = SplitViewHandle;

// Display names
SplitView.displayName = 'SplitView';
SplitViewPanel.displayName = 'SplitViewPanel';
SplitViewHandle.displayName = 'SplitViewHandle';
