import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';

export const codeExamplesGate: CorpusGate = {
  name: 'codeExamplesGate',
  description: 'Rejects empty top-level code blocks; does not compile or execute examples',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    for (const doc of context.documents) {
      if (doc.ast?.children) {
        for (const node of doc.ast.children) {
          if (node.type === 'codeBlock' && typeof node.value === 'string' && node.value.trim().length === 0) {
            diagnostics.push({
              code: 'EMPTY_CODE_BLOCK',
              message: 'Code block is empty',
              file: doc.path,
              severity: 'error',
            });
          }
        }
      }
    }

    return {
      name: 'codeExamplesGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
