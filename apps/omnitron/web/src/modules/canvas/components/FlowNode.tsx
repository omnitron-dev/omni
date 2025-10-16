/**
 * Flow Node Component
 *
 * Renders a single node in the flow canvas
 */

import { defineComponent } from '@omnitron-dev/aether';
import type { FlowNode as FlowNodeType } from '../../../../../../../shared/types/flow';

export interface FlowNodeProps {
  node: FlowNodeType;
  selected?: boolean;
  onSelect?: (nodeId: string, addToSelection: boolean) => void;
  onMove?: (nodeId: string, x: number, y: number) => void;
}

export const FlowNode = defineComponent<FlowNodeProps>((props) => {
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let nodeStartX = 0;
  let nodeStartY = 0;

  const handleMouseDown = (e: MouseEvent) => {
    e.stopPropagation();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    nodeStartX = props.node.position.x;
    nodeStartY = props.node.position.y;

    // Select the node
    if (props.onSelect) {
      props.onSelect(props.node.id, e.shiftKey || e.metaKey);
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      if (props.onMove) {
        props.onMove(props.node.id, nodeStartX + dx, nodeStartY + dy);
      }
    };

    const handleMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return () => {
    // Extract appearance properties from node data
    const color = props.node.data.color || '#4a9eff';
    const opacity = props.node.data.opacity !== undefined ? props.node.data.opacity : 1;
    const visible = props.node.data.visible !== undefined ? props.node.data.visible : true;
    const label = props.node.data.label || props.node.type;

    return (
      <div
        class={() => `flow-node ${props.selected ? 'selected' : ''}`}
        style={{
          position: 'absolute',
          left: `${props.node.position.x}px`,
          top: `${props.node.position.y}px`,
          transform: 'translate(-50%, -50%)',
          opacity,
          display: visible ? 'block' : 'none',
          borderColor: color,
        }}
        onMouseDown={handleMouseDown}
      >
        <div class="flow-node-header" style={{ borderBottomColor: color }}>
          <div class="flow-node-type">{label}</div>
        </div>
        <div class="flow-node-body">
          {/* Input ports */}
          {props.node.inputs.length > 0 && (
            <div class="flow-node-ports flow-node-inputs">
              {props.node.inputs.map((port) => (
                <div key={port.id} class="flow-node-port" title={port.name}>
                  <div class="flow-node-port-dot input" />
                  <span class="flow-node-port-label">{port.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Node data display */}
          {Object.keys(props.node.data).length > 0 && (
            <div class="flow-node-data">
              {Object.entries(props.node.data).map(([key, value]) => (
                <div key={key} class="flow-node-data-item">
                  <span class="flow-node-data-key">{key}:</span>
                  <span class="flow-node-data-value">{String(value)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Output ports */}
          {props.node.outputs.length > 0 && (
            <div class="flow-node-ports flow-node-outputs">
              {props.node.outputs.map((port) => (
                <div key={port.id} class="flow-node-port" title={port.name}>
                  <span class="flow-node-port-label">{port.name}</span>
                  <div class="flow-node-port-dot output" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };
});
