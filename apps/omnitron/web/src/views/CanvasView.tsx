import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';
import { FlowCanvas } from '../modules/canvas/components/FlowCanvas';
import { FlowService, inject } from '../modules/canvas/services/flow.service';

/**
 * Flow Canvas View
 *
 * Visual programming interface for creating and editing flows
 */
export default defineComponent(() => {
  const flowService = inject(FlowService);
  const flows = signal<Array<{ id: string; name: string; nodes: number }>>([]);
  const loading = signal(true);
  const selectedFlow = signal<string | null>(null);

  onMount(async () => {
    // Load flows from FlowService
    const loadedFlows = await flowService.loadFlows();
    flows.set(
      loadedFlows.map((f) => ({
        id: f.id,
        name: f.metadata.name,
        nodes: f.nodes.length,
      }))
    );
    loading.set(false);
  });

  const createNewFlow = async () => {
    const newFlow = await flowService.createFlow(`Flow ${flows().length + 1}`);
    flows.update((f) => [
      ...f,
      {
        id: newFlow.id,
        name: newFlow.metadata.name,
        nodes: newFlow.nodes.length,
      },
    ]);
    // Auto-select the newly created flow
    selectedFlow.set(newFlow.id);
  };

  const selectFlow = (id: string) => {
    selectedFlow.set(id);
  };

  const deleteFlow = async (id: string, event: Event) => {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this flow?')) {
      await flowService.deleteFlow(id);
      flows.update((f) => f.filter((flow) => flow.id !== id));
      if (selectedFlow() === id) {
        selectedFlow.set(null);
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
            <div class="flow-list">
              <h3>Available Flows</h3>
              <Show
                when={() => flows().length > 0}
                fallback={<p class="empty-state">No flows yet. Create your first flow!</p>}
              >
                <For each={flows}>
                  {(flow) => (
                    <div
                      class={() => `flow-item ${selectedFlow() === flow().id ? 'selected' : ''}`}
                      onClick={() => selectFlow(flow().id)}
                    >
                      <div class="flow-item-content">
                        <div class="flow-name">{flow().name}</div>
                        <div class="flow-meta">{flow().nodes} nodes</div>
                      </div>
                      <button
                        class="delete-button"
                        onClick={(e: Event) => deleteFlow(flow().id, e)}
                        title="Delete flow"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            <div class="canvas-workspace">
              <Show
                when={() => selectedFlow()}
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
                <FlowCanvas flowId={selectedFlow()} />
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
});