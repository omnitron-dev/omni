import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';
import type { LumenNode, LumenSmartRefNode } from '@omnitron-dev/lumen-ast';

function walkNodes(nodes: LumenNode[], visitor: (node: LumenNode) => void): void {
  for (const node of nodes) {
    visitor(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      walkNodes(node.children, visitor);
    }
  }
}

export const undocumentedExportsGate: CorpusGate = {
  name: 'undocumentedExportsGate',
  description: 'Verifies workspace package exports have corresponding documentation entries',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    // 1. Build an index of all documented symbols, anchors, IDs, and definitions across the corpus
    const documentedSymbols = new Set<string>();
    const documentedDocs = new Map<string, string>();

    for (const doc of context.documents) {
      documentedSymbols.add(doc.id);
      documentedDocs.set(doc.id, doc.path);

      if (doc.routePath) {
        documentedSymbols.add(doc.routePath);
      }

      for (const anchor of doc.anchors ?? []) {
        documentedSymbols.add(anchor);
        documentedDocs.set(anchor, doc.path);
      }

      for (const header of doc.headers ?? []) {
        if (header.id) {
          documentedSymbols.add(header.id);
          documentedDocs.set(header.id, doc.path);
        }
        if (header.title) {
          documentedSymbols.add(header.title);
        }
      }

      for (const math of doc.mathObjects ?? []) {
        documentedSymbols.add(math.id);
        documentedDocs.set(math.id, doc.path);
      }

      if (doc.frontmatter?.['symbols'] && Array.isArray(doc.frontmatter['symbols'])) {
        for (const sym of doc.frontmatter['symbols']) {
          if (typeof sym === 'string') {
            documentedSymbols.add(sym);
            documentedDocs.set(sym, doc.path);
          }
        }
      }
    }

    // 2. Verify declared exports in frontmatter (exports: string[] or packageExports: Record<string, string[]>)
    for (const doc of context.documents) {
      const declaredExports: string[] = [];

      if (Array.isArray(doc.frontmatter?.['exports'])) {
        for (const exp of doc.frontmatter['exports']) {
          if (typeof exp === 'string') declaredExports.push(exp);
        }
      }

      if (doc.frontmatter?.['packageExports'] && typeof doc.frontmatter['packageExports'] === 'object') {
        const pkgExports = doc.frontmatter['packageExports'] as Record<string, unknown>;
        for (const list of Object.values(pkgExports)) {
          if (Array.isArray(list)) {
            for (const exp of list) {
              if (typeof exp === 'string') declaredExports.push(exp);
            }
          }
        }
      }

      for (const exp of declaredExports) {
        const hasDocEntry =
          documentedSymbols.has(exp) ||
          (doc.anchors ?? []).includes(exp) ||
          (doc.headers ?? []).some((h) => h.id === exp || h.title === exp);

        if (!hasDocEntry) {
          const candidate = Array.from(documentedSymbols).find(
            (s) => s.toLowerCase().includes(exp.toLowerCase()) || exp.toLowerCase().includes(s.toLowerCase())
          );

          diagnostics.push({
            code: 'LUMEN_UNDOCUMENTED_EXPORT',
            message: `Export "${exp}" declared in document "${doc.id}" has no corresponding documentation entry or anchor in corpus`,
            file: doc.path,
            severity: 'error',
            suggestedFix: candidate ? `{#${candidate}}` : `## ${exp}\n\n{#${exp}}`,
          });
        }
      }
    }

    // 3. Verify @api smart references point to documented symbols
    for (const doc of context.documents) {
      if (doc.ast?.children) {
        walkNodes(doc.ast.children, (node) => {
          if (node.type === 'smartRef') {
            const ref = node as LumenSmartRefNode;
            if (ref.domain === 'api') {
              const target = ref.symbol ?? ref.target;
              if (target) {
                const resolvedDoc = context.graph.getDocument(target);
                const resolvedMath = context.graph.resolveMathRef(target);
                const resolvedAnchor = context.graph.resolveAnchor(target);
                const inIndex = documentedSymbols.has(target) || (ref.symbol && documentedSymbols.has(ref.symbol));

                if (!resolvedDoc && !resolvedMath && !resolvedAnchor.resolved && !inIndex) {
                  const candidate = Array.from(documentedSymbols).find(
                    (s) =>
                      s.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(s.toLowerCase())
                  );

                  diagnostics.push({
                    code: 'LUMEN_UNDOCUMENTED_API_SYMBOL',
                    message: `Referenced API symbol "${target}" has no corresponding documentation entry or anchor in corpus`,
                    file: doc.path,
                    line: ref.position?.start?.line,
                    severity: 'error',
                    suggestedFix: candidate ? `@api:${candidate}` : undefined,
                  });
                }
              }
            }
          }
        });
      }
    }

    return {
      name: 'undocumentedExportsGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
