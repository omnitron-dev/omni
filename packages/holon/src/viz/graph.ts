/**
 * Flow graph generation and visualization
 */

import type { Flow } from '@holon/flow';
import type { VisualizationConfig, FlowGraph, GraphNode, GraphEdge } from '../types.js';

/**
 * Generate visual representation of a flow
 */
export function visualizeFlow(
  flow: Flow<unknown, unknown>,
  config: VisualizationConfig = { format: 'mermaid' }
): string {
  const graph = analyzeFlow(flow);

  switch (config.format) {
    case 'dot':
      return generateDot(graph, config);
    case 'mermaid':
      return generateMermaid(graph, config);
    case 'd3':
      return JSON.stringify(generateD3(graph, config), null, 2);
    case 'json':
      return JSON.stringify(graph, null, 2);
    default:
      throw new Error(`Unsupported format: ${config.format}`);
  }
}

/**
 * Analyze flow structure
 */
function analyzeFlow(flow: Flow<unknown, unknown>): FlowGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Extract flow information
  const flowName = (flow as any).name || 'anonymous';
  const flowId = generateId(flowName);

  // Add input node
  nodes.push({
    id: 'input',
    label: 'Input',
    type: 'input',
  });

  // Add flow node
  nodes.push({
    id: flowId,
    label: flowName,
    type: 'flow',
    metadata: {
      source: flow.toString().slice(0, 100),
    },
  });

  // Add output node
  nodes.push({
    id: 'output',
    label: 'Output',
    type: 'output',
  });

  // Add edges
  edges.push({
    from: 'input',
    to: flowId,
  });

  edges.push({
    from: flowId,
    to: 'output',
  });

  return {
    nodes,
    edges,
    metadata: {
      flowName,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Generate DOT format (Graphviz)
 */
function generateDot(graph: FlowGraph, config: VisualizationConfig): string {
  const lines: string[] = ['digraph Flow {'];

  // Add graph attributes
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style=rounded];');

  // Add nodes
  for (const node of graph.nodes) {
    const shape = node.type === 'flow' ? 'box' : 'ellipse';
    const color = node.type === 'input' ? 'lightblue' : node.type === 'output' ? 'lightgreen' : 'white';
    lines.push(`  "${node.id}" [label="${node.label}", shape=${shape}, fillcolor=${color}, style=filled];`);
  }

  // Add edges
  for (const edge of graph.edges) {
    const label = edge.label ? ` [label="${edge.label}"]` : '';
    lines.push(`  "${edge.from}" -> "${edge.to}"${label};`);
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Generate Mermaid diagram
 */
function generateMermaid(graph: FlowGraph, config: VisualizationConfig): string {
  const lines: string[] = ['```mermaid', 'graph LR'];

  // Add nodes
  for (const node of graph.nodes) {
    const shape = node.type === 'input' ? '([' : node.type === 'output' ? '])' : '[';
    const endShape = node.type === 'input' ? '])' : node.type === 'output' ? '])' : ']';
    lines.push(`  ${node.id}${shape}${node.label}${endShape}`);
  }

  // Add edges
  for (const edge of graph.edges) {
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
  }

  lines.push('```');
  return lines.join('\n');
}

/**
 * Generate D3.js data structure
 */
function generateD3(graph: FlowGraph, config: VisualizationConfig): object {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      ...node.metadata,
    })),
    links: graph.edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      label: edge.label,
      ...edge.metadata,
    })),
  };
}

/**
 * Generate unique identifier
 */
function generateId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Export flow graph to file
 */
export async function exportFlowGraph(
  flow: Flow<unknown, unknown>,
  format: 'dot' | 'mermaid' | 'd3' | 'json',
  outputPath: string
): Promise<void> {
  const visualization = visualizeFlow(flow, { format });

  // Would write to file system
  // For now, just return the content
  console.log(`Exporting to ${outputPath}:\n${visualization}`);
}
