/**
 * Flow Connection Component
 *
 * Renders a connection line between two nodes
 */

import { defineComponent } from '@omnitron-dev/aether';
import type { FlowConnection as FlowConnectionType, FlowNode } from '../../../../../../../shared/types/flow';

export interface FlowConnectionProps {
  connection: FlowConnectionType;
  nodes: FlowNode[];
  selected?: boolean;
  onSelect?: (connectionId: string) => void;
}

/**
 * Calculate the port position on screen
 */
function getPortPosition(
  nodeId: string,
  portId: string,
  isOutput: boolean,
  nodes: FlowNode[],
): { x: number; y: number } | null {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const ports = isOutput ? node.outputs : node.inputs;
  const portIndex = ports.findIndex((p) => p.id === portId);
  if (portIndex === -1) return null;

  // Estimate port position (simplified)
  const nodeX = node.position.x;
  const nodeY = node.position.y;
  const portOffsetY = portIndex * 24 + 40; // Approximate offset

  return {
    x: nodeX + (isOutput ? 100 : -100), // Offset from center
    y: nodeY + portOffsetY - 50, // Offset from top
  };
}

/**
 * Generate SVG path for connection
 */
function generatePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Control point offset (for smooth curves)
  const offset = Math.min(distance * 0.5, 100);

  return `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
}

export const FlowConnection = defineComponent<FlowConnectionProps>((props) => {
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.onSelect) {
      props.onSelect(props.connection.id);
    }
  };

  return () => {
    const fromPos = getPortPosition(
      props.connection.from.nodeId,
      props.connection.from.portId,
      true,
      props.nodes,
    );

    const toPos = getPortPosition(
      props.connection.to.nodeId,
      props.connection.to.portId,
      false,
      props.nodes,
    );

    if (!fromPos || !toPos) {
      return null;
    }

    const path = generatePath(fromPos.x, fromPos.y, toPos.x, toPos.y);

    return (
      <g class={() => `flow-connection ${props.selected ? 'selected' : ''}`} onClick={handleClick}>
        {/* Invisible wider path for easier clicking */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          stroke-width="20"
          style={{ cursor: 'pointer' }}
        />
        {/* Visible path */}
        <path
          d={path}
          fill="none"
          stroke={props.selected ? '#4a9eff' : '#666'}
          stroke-width="2"
          style={{
            transition: 'stroke 0.2s',
            cursor: 'pointer',
          }}
        />
        {/* Arrow marker */}
        <circle
          cx={toPos.x}
          cy={toPos.y}
          r="4"
          fill={props.selected ? '#4a9eff' : '#666'}
          style={{ transition: 'fill 0.2s' }}
        />
      </g>
    );
  };
});
