/**
 * Canvas View (Updated)
 *
 * Main view for the Flow Canvas using the new CanvasModule
 */

import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';
import { FlowCanvas } from '../modules/canvas/components/FlowCanvas';
import { FlowService, inject } from '../modules/canvas/services/flow.service';

export default defineComponent(() => {
  // Inject services
  const flowService = inject(FlowService);

  // Local state
  const loading = signal(true);
  const selectedFlowId = signal<string | null>(null);

  onMount(async () => {
    loading.set(true);
    try {
      await flowService.loadFlows();
    } catch (error) {
      console.error('Failed to load flows:', error);
    } finally {
      loading.set(false);
    }
  });

  const createNewFlow = async () => {
    const name = prompt('Enter flow name:', `New Flow ${flowService.getFlows().length + 1}`);
    if (name) {
      try {
        const flow = await flowService.createFlow(name);
        selectedFlowId.set(flow.id);
      } catch (error) {
        console.error('Failed to create flow:', error);
        alert('Failed to create flow');
      }
    }
  };

  const selectFlow = (id: string) => {
    selectedFlowId.set(id);
  };

  const deleteFlow = async (id: string) => {
    if (confirm('Are you sure you want to delete this flow?')) {
      try {
        await flowService.deleteFlow(id);
        if (selectedFlowId() === id) {
          selectedFlowId.set(null);
        }
      } catch (error) {
        console.error('Failed to delete flow:', error);
        alert('Failed to delete flow');
      }
    }
  };

  return () => (
    <div class="view canvas-view">
      <div class="view-header">
        <h2>Flow Canvas</h2>
        <button class="primary-button" onClick={createNewFlow}>
          + New Flow
        </button>
      </div>

      <div class="view-content">
        <Show
          when={() => !loading()}
          fallback={
            <div class="loading-container">
              <div class="loading-spinner" />
              <p>Loading flows...</p>
            </div>
          }
        >
          <div class="canvas-container">
            {/* Flow List Sidebar */}
            <div class="flow-list">
              <h3>Available Flows</h3>
              <Show
                when={() => flowService.getFlows().length > 0}
                fallback={<p class="empty-state">No flows yet. Create your first flow!</p>}
              >
                <For each={() => flowService.getFlows()}>
                  {(flow) => (
                    <div
                      class={() =>
                        `flow-item ${selectedFlowId() === flow().id ? 'selected' : ''}`
                      }
                      onClick={() => selectFlow(flow().id)}
                    >
                      <div class="flow-item-content">
                        <div class="flow-name">{flow().metadata.name}</div>
                        <div class="flow-meta">
                          {flow().nodes.length} nodes, {flow().connections.length} connections
                        </div>
                      </div>
                      <button
                        class="delete-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFlow(flow().id);
                        }}
                        title="Delete flow"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            {/* Canvas Workspace */}
            <div class="canvas-workspace">
              <Show
                when={() => selectedFlowId()}
                fallback={
                  <div class="canvas-placeholder">
                    <svg width="200" height="200" viewBox="0 0 200 200" class="placeholder-icon">
                      <rect x="20" y="20" width="60" height="40" rx="4" fill="#333" />
                      <rect x="120" y="20" width="60" height="40" rx="4" fill="#333" />
                      <rect x="20" y="100" width="60" height="40" rx="4" fill="#333" />
                      <rect x="120" y="100" width="60" height="40" rx="4" fill="#333" />
                      <path d="M80 40 L120 40" stroke="#666" stroke-width="2" />
                      <path d="M80 120 L120 120" stroke="#666" stroke-width="2" />
                      <path d="M50 60 L50 100" stroke="#666" stroke-width="2" />
                      <path d="M150 60 L150 100" stroke="#666" stroke-width="2" />
                    </svg>
                    <h3>Select or create a flow</h3>
                    <p>Choose a flow from the list or create a new one to get started</p>
                  </div>
                }
              >
                <FlowCanvas flowId={selectedFlowId()} />
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
});
