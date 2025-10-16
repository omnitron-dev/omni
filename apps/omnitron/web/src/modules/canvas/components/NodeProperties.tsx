/**
 * NodeProperties Component
 *
 * Property inspector panel for editing flow node properties using PropertyGrid.
 * Displays when a node is selected in the canvas.
 */

import { defineComponent, computed } from '@omnitron-dev/aether';
import { PropertyGrid } from '@omnitron-dev/aether/components/forms';
import type { PropertyDescriptor } from '@omnitron-dev/aether/components/forms';
import { Show } from '@omnitron-dev/aether/control-flow';
import { FlowService, inject } from '../services/flow.service';
import { useCanvasStore } from '../stores/canvas.store';
import type { FlowNode } from '../../../../../../../shared/types/flow';

export interface NodePropertiesProps {
  flowId: string | null;
}

export const NodeProperties = defineComponent<NodePropertiesProps>((props) => {
  const flowService = inject(FlowService);
  const store = useCanvasStore();

  // Get the currently selected node
  const selectedNode = computed(() => {
    if (!props.flowId) return null;

    const selectedIds = store.selectedNodeIds();
    if (selectedIds.length !== 1) return null; // Only show properties for single selection

    const flow = flowService.getFlow(props.flowId);
    if (!flow) return null;

    return flow.nodes.find((n) => n.id === selectedIds[0]) || null;
  });

  // Node type options
  const nodeTypeOptions = [
    { label: 'Transform', value: 'Transform' },
    { label: 'Filter', value: 'Filter' },
    { label: 'Source', value: 'Source' },
    { label: 'Sink', value: 'Sink' },
    { label: 'Aggregator', value: 'Aggregator' },
    { label: 'Router', value: 'Router' },
    { label: 'Processor', value: 'Processor' },
  ];

  // Build property descriptors based on selected node
  const properties = computed((): PropertyDescriptor[] => {
    const node = selectedNode();
    if (!node) return [];

    return [
      // Basic Properties Group
      {
        type: 'group',
        key: 'basic',
        label: 'Basic',
        defaultExpanded: true,
        children: [
          {
            type: 'string',
            key: 'id',
            label: 'Node ID',
            value: node.id,
            readonly: true,
            description: 'Unique identifier for this node',
          },
          {
            type: 'select',
            key: 'type',
            label: 'Node Type',
            value: node.type,
            options: nodeTypeOptions,
            description: 'The type of node determines its behavior',
          },
        ],
      },

      // Layout Properties Group
      {
        type: 'group',
        key: 'layout',
        label: 'Layout',
        defaultExpanded: true,
        children: [
          {
            type: 'number',
            key: 'position.x',
            label: 'Position X',
            value: node.position.x,
            step: 10,
            description: 'Horizontal position on canvas',
          },
          {
            type: 'number',
            key: 'position.y',
            label: 'Position Y',
            value: node.position.y,
            step: 10,
            description: 'Vertical position on canvas',
          },
        ],
      },

      // Appearance Properties Group
      {
        type: 'group',
        key: 'appearance',
        label: 'Appearance',
        defaultExpanded: false,
        children: [
          {
            type: 'color',
            key: 'data.color',
            label: 'Color',
            value: node.data.color || '#4a9eff',
            description: 'Node color for visual identification',
          },
          {
            type: 'number',
            key: 'data.opacity',
            label: 'Opacity',
            value: node.data.opacity !== undefined ? node.data.opacity : 1,
            min: 0,
            max: 1,
            step: 0.1,
            description: 'Node opacity (0 = transparent, 1 = opaque)',
          },
          {
            type: 'boolean',
            key: 'data.visible',
            label: 'Visible',
            value: node.data.visible !== undefined ? node.data.visible : true,
            description: 'Toggle node visibility',
          },
        ],
      },

      // Data Properties Group
      {
        type: 'group',
        key: 'data',
        label: 'Data',
        defaultExpanded: false,
        children: [
          {
            type: 'string',
            key: 'data.label',
            label: 'Label',
            value: node.data.label || '',
            placeholder: 'Enter a custom label',
            description: 'Optional label for the node',
          },
          {
            type: 'string',
            key: 'data.description',
            label: 'Description',
            value: node.data.description || '',
            placeholder: 'Enter a description',
            description: 'Optional description for documentation',
          },
          {
            type: 'custom',
            key: 'ports',
            label: 'Ports',
            value: { inputs: node.inputs.length, outputs: node.outputs.length },
            render: ({ value }) => (
              <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                <div>Inputs: {value.inputs}</div>
                <div>Outputs: {value.outputs}</div>
              </div>
            ),
            description: 'Number of input and output ports',
          },
        ],
      },
    ];
  });

  // Handle property changes
  const handlePropertyChange = async (key: string, value: any) => {
    if (!props.flowId) return;

    const node = selectedNode();
    if (!node) return;

    // Parse the property key to handle nested paths (e.g., 'position.x', 'data.color')
    const parts = key.split('.');

    let updates: Partial<FlowNode>;

    if (parts.length === 1) {
      // Top-level property (e.g., 'type')
      updates = { [key]: value };
    } else if (parts[0] === 'position') {
      // Position updates
      updates = {
        position: {
          ...node.position,
          [parts[1]]: value,
        },
      };
    } else if (parts[0] === 'data') {
      // Data updates
      updates = {
        data: {
          ...node.data,
          [parts[1]]: value,
        },
      };
    } else {
      // Fallback for other nested properties
      updates = { [parts[0]]: value };
    }

    // Update the node via FlowService
    await flowService.updateNode(props.flowId, node.id, updates);
  };

  return () => (
    <div class="node-properties-panel">
      <div class="panel-header">
        <h3>Properties</h3>
      </div>
      <div class="panel-content">
        <Show
          when={() => selectedNode() !== null}
          fallback={
            <div class="empty-state">
              <p>No node selected</p>
              <p class="hint">Select a node to edit its properties</p>
            </div>
          }
        >
          <PropertyGrid properties={properties()} onChange={handlePropertyChange} searchable={true} size="sm" />
        </Show>
      </div>
    </div>
  );
});
