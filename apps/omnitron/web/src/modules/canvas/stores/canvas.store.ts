/**
 * Canvas Store
 *
 * Reactive state management for canvas
 */

import { defineStore, signal, computed, readonly } from '@omnitron-dev/aether/store';

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  selectedNodeIds: string[];
  selectedConnectionIds: string[];
  isDragging: boolean;
  isPanning: boolean;
}

/**
 * Canvas Store
 *
 * Manages canvas state including zoom, pan, and selection.
 *
 * @example
 * ```typescript
 * const canvasStore = useCanvasStore();
 *
 * // Set zoom level
 * canvasStore.setZoom(1.5);
 *
 * // Pan the canvas
 * canvasStore.setPan(100, 50);
 *
 * // Select nodes
 * canvasStore.setSelectedNodeIds(['node-1', 'node-2']);
 * ```
 */
export const useCanvasStore = defineStore('canvas', () => {
  // State signals
  const zoom = signal(1.0);
  const panX = signal(0);
  const panY = signal(0);
  const selectedNodeIds = signal<string[]>([]);
  const selectedConnectionIds = signal<string[]>([]);
  const isDragging = signal(false);
  const isPanning = signal(false);

  // Computed values
  const hasSelection = computed(
    () => selectedNodeIds().length > 0 || selectedConnectionIds().length > 0,
  );

  const state = computed(() => ({
    zoom: zoom(),
    panX: panX(),
    panY: panY(),
    selectedNodeIds: selectedNodeIds(),
    selectedConnectionIds: selectedConnectionIds(),
    isDragging: isDragging(),
    isPanning: isPanning(),
  }));

  // Actions

  /**
   * Set zoom level (clamped between 0.1 and 3.0)
   */
  const setZoom = (value: number) => {
    zoom.set(Math.max(0.1, Math.min(3.0, value)));
  };

  /**
   * Set pan position
   */
  const setPan = (x: number, y: number) => {
    panX.set(x);
    panY.set(y);
  };

  /**
   * Set selected node IDs
   */
  const setSelectedNodeIds = (ids: string[]) => {
    selectedNodeIds.set(ids);
  };

  /**
   * Set selected connection IDs
   */
  const setSelectedConnectionIds = (ids: string[]) => {
    selectedConnectionIds.set(ids);
  };

  /**
   * Clear all selections
   */
  const clearSelection = () => {
    selectedNodeIds.set([]);
    selectedConnectionIds.set([]);
  };

  /**
   * Set dragging state
   */
  const setIsDragging = (value: boolean) => {
    isDragging.set(value);
  };

  /**
   * Set panning state
   */
  const setIsPanning = (value: boolean) => {
    isPanning.set(value);
  };

  /**
   * Reset transform to default (zoom 1.0, pan 0,0)
   */
  const resetTransform = () => {
    zoom.set(1.0);
    panX.set(0);
    panY.set(0);
  };

  return {
    // State (readonly)
    zoom: readonly(zoom),
    panX: readonly(panX),
    panY: readonly(panY),
    selectedNodeIds: readonly(selectedNodeIds),
    selectedConnectionIds: readonly(selectedConnectionIds),
    isDragging: readonly(isDragging),
    isPanning: readonly(isPanning),

    // Computed
    hasSelection,
    state,

    // Actions
    setZoom,
    setPan,
    setSelectedNodeIds,
    setSelectedConnectionIds,
    clearSelection,
    setIsDragging,
    setIsPanning,
    resetTransform,
  };
});
