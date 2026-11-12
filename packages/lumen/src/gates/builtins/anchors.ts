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

function isExternalHref(href: string): boolean {
  const trimmed = href.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed === '#unsafe-url' ||
    /^(?:https?:|mailto:|tel:|javascript:|vbscript:|data:)/i.test(trimmed)
  );
}

export const anchorsGate: CorpusGate = {
  name: 'anchorsGate',
  description: 'Verifies heading anchor uniqueness, valid slug syntax, and anchor target existence',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    for (const doc of context.documents) {
      // 1. Check anchor uniqueness within document
      const seenAnchors = new Map<string, number>();
      for (const anchor of doc.anchors ?? []) {
        const count = (seenAnchors.get(anchor) ?? 0) + 1;
        seenAnchors.set(anchor, count);

        if (count > 1) {
          diagnostics.push({
            code: 'LUMEN_DUPLICATE_ANCHOR',
            message: `Duplicate heading anchor "${anchor}" found in document "${doc.id}"`,
            file: doc.path,
            severity: 'error',
            suggestedFix: `{#${anchor}-${count - 1}}`,
          });
        }

        // 2. Check anchor formatting and invalid characters in anchors
        if (/[^\p{L}\p{N}\-_]/u.test(anchor)) {
          const normalized = anchor
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\-_]+/gu, '-')
            .replace(/^-+|-+$/g, '');
          diagnostics.push({
            code: 'LUMEN_INVALID_HEADING_SLUG',
            message: `Heading anchor "${anchor}" contains reserved or invalid characters`,
            file: doc.path,
            severity: 'warning',
            suggestedFix: normalized ? `{#${normalized}}` : undefined,
          });
        }
      }

      const checkedRefs = new Set<string>();
      const verifyAnchorRef = (ref: string, line?: number) => {
        const trimmed = ref.trim();
        if (!trimmed || !trimmed.includes('#') || isExternalHref(trimmed) || checkedRefs.has(trimmed)) {
          return;
        }
        checkedRefs.add(trimmed);

        const res = context.graph.resolveAnchor(trimmed, doc.id);
        if (!res.resolved) {
          diagnostics.push({
            code: 'ERR_BROKEN_ANCHOR',
            message: `Anchor ${trimmed} does not resolve`,
            file: doc.path,
            ...(line !== undefined ? { line } : {}),
            severity: 'error',
          });
        }
      };

      // 3. Check cross-document and local anchor links in relations.seeAlso
      if (doc.relations?.seeAlso) {
        for (const ref of doc.relations.seeAlso) {
          verifyAnchorRef(ref);
        }
      }

      // 4. Inspect AST link nodes directly for `#anchor` and `doc#anchor` references
      if (doc.ast?.children) {
        walkAstNodes(doc.ast.children, (node) => {
          if (node.type === 'link' && typeof node.url === 'string' && node.url.includes('#')) {
            verifyAnchorRef(node.url, node.position?.start?.line);
          }
        });
      }
    }

    return {
      name: 'anchorsGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
