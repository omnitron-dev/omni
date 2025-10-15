/**
 * Canvas Service
 *
 * Manages canvas state and interactions (zoom, pan, selection, etc.)
 */

import { signal, computed } from '@omnitron-dev/aether';
import { Injectable } from './flow.service';

export interface CanvasTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CanvasSelection {
  nodeIds: string[];
  connectionIds: string[];
}

@Injectable({ scope: 'module' })
export class CanvasService {
  // Transform state
  private zoom = signal(1.0);
  private panX = signal(0);
  private panY = signal(0);

  // Selection state
  private selectedNodeIds = signal<string[]>([]);
  private selectedConnectionIds = signal<string[]>([]);

  // Computed properties
  transform = computed(() => ({
    zoom: this.zoom(),
    panX: this.panX(),
    panY: this.panY(),
  }));

  selection = computed(() => ({
    nodeIds: this.selectedNodeIds(),
    connectionIds: this.selectedConnectionIds(),
  }));

  hasSelection = computed(() => this.selectedNodeIds().length > 0 || this.selectedConnectionIds().length > 0);

  /**
   * Set zoom level
   */
  setZoom(zoom: number): void {
    this.zoom.set(Math.max(0.1, Math.min(3.0, zoom)));
  }

  /**
   * Zoom in
   */
  zoomIn(): void {
    this.zoom.update((z) => Math.min(3.0, z * 1.2));
  }

  /**
   * Zoom out
   */
  zoomOut(): void {
    this.zoom.update((z) => Math.max(0.1, z / 1.2));
  }

  /**
   * Reset zoom to 100%
   */
  resetZoom(): void {
    this.zoom.set(1.0);
  }

  /**
   * Set pan offset
   */
  setPan(x: number, y: number): void {
    this.panX.set(x);
    this.panY.set(y);
  }

  /**
   * Pan by delta
   */
  panBy(dx: number, dy: number): void {
    this.panX.update((x) => x + dx);
    this.panY.update((y) => y + dy);
  }

  /**
   * Reset pan to origin
   */
  resetPan(): void {
    this.panX.set(0);
    this.panY.set(0);
  }

  /**
   * Reset both zoom and pan
   */
  resetTransform(): void {
    this.resetZoom();
    this.resetPan();
  }

  /**
   * Select a single node
   */
  selectNode(nodeId: string, addToSelection: boolean = false): void {
    if (addToSelection) {
      this.selectedNodeIds.update((ids) => {
        if (ids.includes(nodeId)) {
          return ids.filter((id) => id !== nodeId);
        }
        return [...ids, nodeId];
      });
    } else {
      this.selectedNodeIds.set([nodeId]);
      this.selectedConnectionIds.set([]);
    }
  }

  /**
   * Select multiple nodes
   */
  selectNodes(nodeIds: string[]): void {
    this.selectedNodeIds.set(nodeIds);
    this.selectedConnectionIds.set([]);
  }

  /**
   * Select a connection
   */
  selectConnection(connectionId: string, addToSelection: boolean = false): void {
    if (addToSelection) {
      this.selectedConnectionIds.update((ids) => {
        if (ids.includes(connectionId)) {
          return ids.filter((id) => id !== connectionId);
        }
        return [...ids, connectionId];
      });
    } else {
      this.selectedConnectionIds.set([connectionId]);
      this.selectedNodeIds.set([]);
    }
  }

  /**
   * Clear all selections
   */
  clearSelection(): void {
    this.selectedNodeIds.set([]);
    this.selectedConnectionIds.set([]);
  }

  /**
   * Check if a node is selected
   */
  isNodeSelected(nodeId: string): boolean {
    return this.selectedNodeIds().includes(nodeId);
  }

  /**
   * Check if a connection is selected
   */
  isConnectionSelected(connectionId: string): boolean {
    return this.selectedConnectionIds().includes(connectionId);
  }

  /**
   * Convert screen coordinates to canvas coordinates
   */
  screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const zoom = this.zoom();
    const panX = this.panX();
    const panY = this.panY();

    return {
      x: (screenX - panX) / zoom,
      y: (screenY - panY) / zoom,
    };
  }

  /**
   * Convert canvas coordinates to screen coordinates
   */
  canvasToScreen(canvasX: number, canvasY: number): { x: number; y: number } {
    const zoom = this.zoom();
    const panX = this.panX();
    const panY = this.panY();

    return {
      x: canvasX * zoom + panX,
      y: canvasY * zoom + panY,
    };
  }

  /**
   * Get current transform values
   */
  getTransform(): CanvasTransform {
    return this.transform();
  }

  /**
   * Get current selection
   */
  getSelection(): CanvasSelection {
    return this.selection();
  }
}
