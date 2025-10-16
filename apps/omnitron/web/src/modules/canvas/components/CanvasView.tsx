import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';

/**
 * Canvas View Component
 *
 * Main view component for the Canvas module.
 * Provides the visual programming interface for creating and editing flows.
 *
 * Features:
 * - Flow list management
 * - Visual canvas workspace
 * - Flow editing tools
 * - Node palette
 */
export default defineComponent(() => {
  const flows = signal<Array<{ id: string; name: string; nodes: number }>>([]);
  const loading = signal(true);
  const selectedFlow = signal<string | null>(null);

  onMount(() => {
    // Simulate loading flows
    setTimeout(() => {
      flows.set([
        { id: '1', name: 'Data Processing Pipeline', nodes: 12 },
        { id: '2', name: 'API Gateway Flow', nodes: 8 },
        { id: '3', name: 'ML Training Workflow', nodes: 24 },
      ]);
      loading.set(false);
    }, 500);
  });

  const createNewFlow = () => {
    const newFlow = {
      id: Date.now().toString(),
      name: `New Flow ${flows().length + 1}`,
      nodes: 0,
    };
    flows.update((f) => [...f, newFlow]);
  };

  const selectFlow = (id: string) => {
    selectedFlow.set(id);
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
                      <div class="flow-name">{flow().name}</div>
                      <div class="flow-meta">{flow().nodes} nodes</div>
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
                <div class="canvas-editor">
                  <div class="canvas-toolbar">
                    <button class="tool-button" title="Select">
                      <span>⬚</span>
                    </button>
                    <button class="tool-button" title="Add Node">
                      <span>⊕</span>
                    </button>
                    <button class="tool-button" title="Connect">
                      <span>↗</span>
                    </button>
                    <button class="tool-button" title="Delete">
                      <span>🗑</span>
                    </button>
                    <div class="toolbar-separator" />
                    <button class="tool-button" title="Zoom In">
                      <span>🔍+</span>
                    </button>
                    <button class="tool-button" title="Zoom Out">
                      <span>🔍-</span>
                    </button>
                    <button class="tool-button" title="Fit to Screen">
                      <span>⊡</span>
                    </button>
                  </div>
                  <div class="canvas-area">
                    <div class="flow-canvas">
                      {/* Canvas will be rendered here */}
                      <p>
                        Flow Editor for:{' '}
                        {() => {
                          const flow = flows().find((f) => f.id === selectedFlow());
                          return flow?.name || 'Unknown';
                        }}
                      </p>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
});
