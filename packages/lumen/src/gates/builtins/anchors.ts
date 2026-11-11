import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';

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
        if (/[^a-zA-Z0-9\-_]/.test(anchor)) {
          const normalized = anchor
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\-_]+/g, '-')
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

      // 3. Check cross-document anchor links
      if (doc.relations?.seeAlso) {
        for (const ref of doc.relations.seeAlso) {
          if (ref.includes('#')) {
            const res = context.graph.resolveAnchor(ref);
            if (!res.resolved) {
              diagnostics.push({
                code: 'ERR_BROKEN_ANCHOR',
                message: `Anchor ${ref} does not resolve`,
                file: doc.path,
                severity: 'error',
              });
            }
          }
        }
      }
    }

    return {
      name: 'anchorsGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
