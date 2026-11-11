import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';

export const linksGate: CorpusGate = {
  name: 'linksGate',
  description: 'Verifies all internal document cross-links resolve in the CorpusGraph',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    for (const doc of context.documents) {
      if (doc.relations?.dependsOn) {
        for (const target of doc.relations.dependsOn) {
          // Check if resolved as document or math object or anchor
          const targetDoc = context.graph.getDocument(target);
          const targetMath = context.graph.resolveMathRef(target);
          const targetLink = context.graph.resolveLink(doc.id, target);

          if (!targetDoc && !targetMath && !targetLink.resolved) {
            // Find closest candidate if possible
            const allDocIds = context.graph.getAllDocuments().map((d) => d.id);
            const candidate = allDocIds.find((id) => id.includes(target) || target.includes(id));

            diagnostics.push({
              code: 'ERR_BROKEN_LINK',
              message: `Target ${target} not found from document ${doc.id}`,
              file: doc.path,
              severity: 'error',
              suggestedFix: candidate ? candidate : undefined,
            });
          }
        }
      }
    }

    // Cycle detection for document dependencies
    const adj = new Map<string, string[]>();
    for (const doc of context.documents) {
      if (doc.relations?.dependsOn) {
        adj.set(doc.id, doc.relations.dependsOn);
      }
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const reportedCycles = new Set<string>();

    function dfs(nodeId: string, path: string[]) {
      visited.add(nodeId);
      recStack.add(nodeId);
      path.push(nodeId);

      const neighbors = adj.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        } else if (recStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart).concat(neighbor);
          const cycleKey = [...cycle].sort().join(',');
          if (!reportedCycles.has(cycleKey)) {
            reportedCycles.add(cycleKey);
            const sourceDoc = context.graph.getDocument(nodeId);
            diagnostics.push({
              code: 'ERR_CIRCULAR_DEPENDENCY',
              message: `Circular dependency detected: cycle ${cycle.join(' -> ')}`,
              file: sourceDoc?.path ?? nodeId,
              severity: 'error',
            });
          }
        }
      }

      path.pop();
      recStack.delete(nodeId);
    }

    for (const doc of context.documents) {
      if (!visited.has(doc.id)) {
        dfs(doc.id, []);
      }
    }

    return {
      name: 'linksGate',
      passed: diagnostics.length === 0,
      diagnostics,
    };
  },
};
