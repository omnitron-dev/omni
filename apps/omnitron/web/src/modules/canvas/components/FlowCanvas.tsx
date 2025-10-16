/**
 * Flow Canvas Component
 *
 * Main canvas component for rendering and interacting with flows
 */

import { defineComponent, signal, onMount, effect } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';
import { FlowNode } from './FlowNode';
import { FlowConnection } from './FlowConnection';
import { NodeProperties } from './NodeProperties';
import { FlowService, inject } from '../services/flow.service';
import { CanvasService } from '../services/canvas.service';
import { useCanvasStore } from '../stores/canvas.store';
import type { FlowDefinition } from '../../../../../../../shared/types/flow';

export interface FlowCanvasProps {
  flowId: string | null;
}

export const FlowCanvas = defineComponent<FlowCanvasProps>((props) => {
  // Inject services
  const flowService = inject(FlowService);
  const canvasService = inject(CanvasService);

  // Use canvas store
  const store = useCanvasStore();

  // Local state
  const currentFlow = signal<FlowDefinition | null>(null);
  let canvasRef: HTMLDivElement | null = null;

  // Load flow when flowId changes
  onMount(() => {
    if (props.flowId) {
      const flow = flowService.getFlow(props.flowId);
      if (flow) {
        currentFlow.set(flow);
      }
    }
  });

  // Handle canvas panning
  const handleCanvasMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return; // Only left click

    // If clicking on canvas background, start panning
    if (e.target === canvasRef || (e.target as HTMLElement).classList.contains('flow-canvas')) {
      store.setIsPanning(true);
      store.clearSelection();

      const startX = e.clientX;
      const startY = e.clientY;
      const startPanX = store.panX();
      const startPanY = store.panY();

      const handleMouseMove = (e: MouseEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        store.setPan(startPanX + dx, startPanY + dy);
      };

      const handleMouseUp = () => {
        store.setIsPanning(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
  };

  // Handle zoom with mouse wheel
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    store.setZoom(store.zoom() * delta);
  };

  // Handle node selection
  const handleNodeSelect = (nodeId: string, addToSelection: boolean) => {
    if (addToSelection) {
      const currentIds = store.selectedNodeIds();
      if (currentIds.includes(nodeId)) {
        store.setSelectedNodeIds(currentIds.filter((id) => id !== nodeId));
      } else {
        store.setSelectedNodeIds([...currentIds, nodeId]);
      }
    } else {
      store.setSelectedNodeIds([nodeId]);
      store.setSelectedConnectionIds([]);
    }
  };

  // Handle node movement
  const handleNodeMove = async (nodeId: string, x: number, y: number) => {
    if (!currentFlow() || !props.flowId) return;

    await flowService.updateNode(props.flowId, nodeId, {
      position: { x, y },
    });

    // Refresh current flow
    const updated = flowService.getFlow(props.flowId);
    if (updated) {
      currentFlow.set(updated);
    }
  };

  // Watch for flow changes and update current flow
  effect(() => {
    if (props.flowId) {
      const flow = flowService.getFlow(props.flowId);
      if (flow) {
        currentFlow.set(flow);
      }
    }
  });

  // Handle connection selection
  const handleConnectionSelect = (connectionId: string) => {
    store.setSelectedConnectionIds([connectionId]);
    store.setSelectedNodeIds([]);
  };

  // Toolbar actions
  const handleZoomIn = () => {
    store.setZoom(store.zoom() * 1.2);
  };

  const handleZoomOut = () => {
    store.setZoom(store.zoom() / 1.2);
  };

  const handleResetView = () => {
    store.resetTransform();
  };

  const handleAddNode = async () => {
    if (!props.flowId) return;

    const newNode = {
      id: crypto.randomUUID(),
      type: 'Transform',
      position: { x: 400, y: 300 },
      data: {},
      inputs: [{ id: 'input-1', name: 'Input', type: 'any' }],
      outputs: [{ id: 'output-1', name: 'Output', type: 'any' }],
    };

    await flowService.addNode(props.flowId, newNode);

    // Refresh current flow
    const updated = flowService.getFlow(props.flowId);
    if (updated) {
      currentFlow.set(updated);
    }
  };

  const handleDeleteSelected = async () => {
    if (!props.flowId) return;

    const selectedNodes = store.selectedNodeIds();
    const selectedConnections = store.selectedConnectionIds();

    // Delete selected nodes
    for (const nodeId of selectedNodes) {
      await flowService.removeNode(props.flowId, nodeId);
    }

    // Delete selected connections
    for (const connectionId of selectedConnections) {
      await flowService.removeConnection(props.flowId, connectionId);
    }

    // Clear selection
    store.clearSelection();

    // Refresh current flow
    const updated = flowService.getFlow(props.flowId);
    if (updated) {
      currentFlow.set(updated);
    }
  };

  return () => (
    <div class="flow-canvas-with-inspector">
      {/* Main Canvas Area */}
      <div class="flow-canvas-container">
        {/* Toolbar */}
        <div class="canvas-toolbar">
          <button class="tool-button" title="Add Node" onClick={handleAddNode}>
            <span>⊕</span>
          </button>
          <button
            class="tool-button"
            title="Delete"
            onClick={handleDeleteSelected}
            disabled={() => !store.hasSelection()}
          >
            <span>🗑</span>
          </button>
          <div class="toolbar-separator" />
          <button class="tool-button" title="Zoom In" onClick={handleZoomIn}>
            <span>🔍+</span>
          </button>
          <button class="tool-button" title="Zoom Out" onClick={handleZoomOut}>
            <span>🔍-</span>
          </button>
          <button class="tool-button" title="Reset View" onClick={handleResetView}>
            <span>⊡</span>
          </button>
          <span class="zoom-indicator">{() => Math.round(store.zoom() * 100)}%</span>
        </div>

        {/* Canvas */}
        <div
          ref={(el: HTMLDivElement) => (canvasRef = el)}
          class={() => `flow-canvas ${store.isPanning() ? 'panning' : ''}`}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
        >
          <Show
            when={() => currentFlow()}
            fallback={
              <div class="canvas-empty">
                <p>No flow selected</p>
              </div>
            }
          >
            <div
              class="canvas-content"
              style={{
                transform: () => `translate(${store.panX()}px, ${store.panY()}px) scale(${store.zoom()})`,
                'transform-origin': 'center center',
              }}
            >
              {/* SVG layer for connections */}
              <svg class="connections-layer" style={{ position: 'absolute', inset: 0 }}>
                <For each={() => currentFlow()?.connections || []}>
                  {(connection) => (
                    <FlowConnection
                      connection={connection()}
                      nodes={currentFlow()?.nodes || []}
                      selected={() => store.selectedConnectionIds().includes(connection().id)}
                      onSelect={handleConnectionSelect}
                    />
                  )}
                </For>
              </svg>

              {/* Nodes layer */}
              <div class="nodes-layer">
                <For each={() => currentFlow()?.nodes || []}>
                  {(node) => (
                    <FlowNode
                      node={node()}
                      selected={() => store.selectedNodeIds().includes(node().id)}
                      onSelect={handleNodeSelect}
                      onMove={handleNodeMove}
                    />
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        {/* Status bar */}
        <div class="canvas-status">
          <span>
            Nodes: {() => currentFlow()?.nodes.length || 0} | Connections:{' '}
            {() => currentFlow()?.connections.length || 0}
          </span>
          <Show when={() => store.hasSelection()}>
            <span>
              {' '}
              | Selected: {() => store.selectedNodeIds().length} nodes, {() => store.selectedConnectionIds().length}{' '}
              connections
            </span>
          </Show>
        </div>
      </div>

      {/* Properties Inspector Panel */}
      <NodeProperties flowId={props.flowId} />
    </div>
  );
});
