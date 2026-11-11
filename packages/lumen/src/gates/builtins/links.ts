import type { LumenNode } from '@omnitron-dev/lumen-ast';
import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';

function walkAstNodes(nodes: LumenNode[], visitor: (node: LumenNode) => void): void {
  for (const node of nodes) {
    visitor(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      walkAstNodes(node.children, visitor);
    }
  }
}

function isExternalLinkHref(href: string): boolean {
  const trimmed = href.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed === '#unsafe-url' ||
    /^(?:https?:|mailto:|tel:|javascript:|vbscript:|data:)/i.test(trimmed)
  );
}

export const linksGate: CorpusGate = {
  name: 'linksGate',
  description: 'Verifies all internal document cross-links resolve in the CorpusGraph',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];
    const allDocIds = context.graph.getAllDocuments().map((d) => d.id);

    for (const doc of context.documents) {
      const reportedTargets = new Set<string>();

      const verifyLinkTarget = (target: string, line?: number, deduplicate = false) => {
        const trimmed = target.trim();
        if (deduplicate && reportedTargets.has(trimmed)) {
          return;
        }

        const isExplicitRelative = trimmed.startsWith('./') || trimmed.startsWith('../');
        const targetDoc = !isExplicitRelative && trimmed ? context.graph.getDocument(trimmed) : undefined;
        const targetMath = !isExplicitRelative && trimmed ? context.graph.resolveMathRef(trimmed) : undefined;
        const targetLink = context.graph.resolveLink(doc.id, target);

        if (!targetDoc && !targetMath && !targetLink.resolved) {
          if (trimmed) {
            reportedTargets.add(trimmed);
          }
          const candidate = trimmed ? allDocIds.find((id) => id.includes(trimmed) || trimmed.includes(id)) : undefined;

          diagnostics.push({
            code: 'ERR_BROKEN_LINK',
            message: `Target ${target} not found from document ${doc.id}`,
            file: doc.path,
            ...(line !== undefined ? { line } : {}),
            severity: 'error',
            suggestedFix: candidate || undefined,
          });
        }
      };

      if (doc.relations?.dependsOn) {
        for (const target of doc.relations.dependsOn) {
          verifyLinkTarget(target, undefined, false);
        }
      }

      if (doc.ast?.children) {
        walkAstNodes(doc.ast.children, (node) => {
          if (node.type === 'link' && typeof node.url === 'string') {
            const rawUrl = node.url.trim();
            if (!rawUrl || rawUrl.startsWith('#') || isExternalLinkHref(rawUrl)) {
              return;
            }
            const docPart = (rawUrl.split('#')[0] ?? '').trim();
            if (docPart) {
              verifyLinkTarget(docPart, node.position?.start?.line, true);
            }
          }
        });
      }
    }

    // Cycle detection for document dependencies
    const adj = new Map<string, string[]>();
    for (const doc of context.documents) {
      if (doc.relations?.dependsOn) {
        const resolvedNeighbors: string[] = [];
        for (const rawTarget of doc.relations.dependsOn) {
          if (context.graph.getDocument(rawTarget)) {
            resolvedNeighbors.push(rawTarget);
          } else {
            const linkRes = context.graph.resolveLink(doc.id, rawTarget);
            if (linkRes.resolved && linkRes.targetDocId) {
              resolvedNeighbors.push(linkRes.targetDocId);
            }
          }
        }
        adj.set(doc.id, resolvedNeighbors);
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
