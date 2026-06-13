/**
 * Dependency-graph diagnostics for the Nexus container.
 *
 * NX-5: extracted from the former experimental `devtools.ts`. `Container.exportGraph()`
 * builds a {@link DependencyGraph} (inline) and these formatters render/filter it
 * for diagnostics + CLI output. This is the only LIVE part of the old devtools
 * module — the heavyweight `DevToolsServer`/`DevToolsPlugin` debugger and its
 * wire protocol had zero consumers and were removed.
 */

/**
 * A container dependency graph: provider nodes + dependency/parent edges.
 * Produced by `Container.exportGraph()`.
 */
export interface DependencyGraph {
  nodes: Array<{ id: string; label?: string; type?: string }>;
  edges: Array<{ from: string; to: string; type?: 'dependency' | 'parent' }>;
  roots?: string[];
  leaves?: string[];
}

/**
 * Render a DependencyGraph as Graphviz DOT.
 */
export function exportToDot(graph: DependencyGraph): string {
  const lines: string[] = ['digraph Dependencies {'];
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box];');

  // Add nodes
  graph.nodes.forEach((node) => {
    const label = node.label || node.id;
    // Only quote node IDs if they contain special characters
    const nodeId = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.id) ? node.id : `"${node.id}"`;
    lines.push(`  ${nodeId} [label="${label}"];`);
  });

  // Add edges
  graph.edges.forEach((edge) => {
    // Only quote node IDs if they contain special characters
    const fromId = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(edge.from) ? edge.from : `"${edge.from}"`;
    const toId = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(edge.to) ? edge.to : `"${edge.to}"`;
    lines.push(`  ${fromId} -> ${toId};`);
  });

  lines.push('}');
  return lines.join('\n');
}

/**
 * Render a DependencyGraph as a Mermaid flowchart.
 */
export function exportToMermaid(graph: DependencyGraph): string {
  const lines: string[] = ['graph TD'];

  // Add nodes
  graph.nodes.forEach((node) => {
    const label = node.label || node.id;
    const nodeId = node.id.replace(/[^a-zA-Z0-9]/g, ''); // Sanitize ID for Mermaid

    // Use simple rectangle shape for all nodes
    lines.push(`  ${nodeId}[${label}]`);
  });

  // Add edges
  graph.edges.forEach((edge) => {
    const fromId = edge.from.replace(/[^a-zA-Z0-9]/g, '');
    const toId = edge.to.replace(/[^a-zA-Z0-9]/g, '');
    lines.push(`  ${fromId} --> ${toId}`);
  });

  return lines.join('\n');
}

/**
 * Serialise a DependencyGraph to compact JSON. Used by the CLI's
 * `--format=json` mode and by failed-init telemetry that wants a
 * machine-readable snapshot of the graph at the moment of failure.
 */
export function exportToJson(graph: DependencyGraph, options: { pretty?: boolean } = {}): string {
  return options.pretty ? JSON.stringify(graph, null, 2) : JSON.stringify(graph);
}

/**
 * Filter the graph down to a focus node and its closure. `directions`
 * controls which side(s) of the focus to keep:
 *   - `'ancestors'` — everything that depends on the focus, recursively
 *     (the "things that break when this provider fails to init").
 *   - `'descendants'` — everything the focus depends on, recursively
 *     (the "things this provider needs to start").
 *   - `'both'` (default) — union of the two.
 *
 * Edges between nodes outside the kept set are dropped. Useful for
 * diagnostics: instead of dumping the whole module graph, we render
 * only the failing token's transitive closure.
 */
export function focusGraph(
  graph: DependencyGraph,
  focusId: string,
  directions: 'ancestors' | 'descendants' | 'both' = 'both',
): DependencyGraph {
  const adjFwd = new Map<string, Set<string>>();
  const adjRev = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!adjFwd.has(e.from)) adjFwd.set(e.from, new Set());
    if (!adjRev.has(e.to)) adjRev.set(e.to, new Set());
    adjFwd.get(e.from)!.add(e.to);
    adjRev.get(e.to)!.add(e.from);
  }
  const keep = new Set<string>([focusId]);
  const visit = (start: string, adj: Map<string, Set<string>>): void => {
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const nbrs = adj.get(cur);
      if (!nbrs) continue;
      for (const n of nbrs) {
        if (!keep.has(n)) {
          keep.add(n);
          stack.push(n);
        }
      }
    }
  };
  if (directions === 'descendants' || directions === 'both') visit(focusId, adjFwd);
  if (directions === 'ancestors' || directions === 'both') visit(focusId, adjRev);

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}
