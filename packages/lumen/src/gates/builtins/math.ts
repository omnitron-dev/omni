import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';

export const mathKernelGate: CorpusGate = {
  name: 'mathKernelGate',
  description: 'Verifies mathematical theorem dependency DAG acyclicity and theorem reference integrity',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    // 1. Detect cyclic mathematical dependencies
    const cycles = context.graph.detectMathCycles();
    for (const cycle of cycles) {
      diagnostics.push({
        code: 'LUMEN_CYCLIC_MATH_DEPENDENCY',
        message: `Cyclic dependency detected in mathematical theorem graph: ${cycle.join(' -> ')}`,
        severity: 'error',
      });
    }

    // 2. Scan documents for dangling theorem references
    for (const doc of context.documents) {
      const deps = doc.relations?.dependsOn ?? [];
      for (const ref of deps) {
        if (ref.startsWith('thm-') || ref.startsWith('ax-') || ref.startsWith('lem-') || ref.startsWith('def-')) {
          const resolved = context.graph.resolveMathRef(ref);
          const docFound = context.graph
            .getAllDocuments()
            .some((d) => d.mathObjects?.some((m) => m.id === ref) || d.anchors?.includes(ref));

          if (!resolved && !docFound) {
            diagnostics.push({
              code: 'LUMEN_DANGLING_THEOREM_REF',
              message: `Referenced mathematical object ${ref} does not exist in corpus`,
              file: doc.path,
              severity: 'error',
            });
          }
        }
      }
    }

    // 3. Check outdated translations
    const outdated = context.graph.getOutdatedTranslations();
    for (const item of outdated) {
      diagnostics.push({
        code: 'LUMEN_OUTDATED_TRANSLATION',
        message: `Translation for canonical document "${item.canonicalId}" in locale "${item.locale}" is outdated`,
        severity: 'warning',
      });
    }

    return {
      name: 'mathKernelGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
