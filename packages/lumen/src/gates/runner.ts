import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from './types.js';

export interface RunGatesOptions {
  bail?: boolean;
}

export interface GatePipelineSummary {
  passed: boolean;
  results: GateResult[];
  diagnostics: LumenGateDiagnostic[];
  totalDiagnosticsCount: number;
}

export async function runCorpusGates(
  context: GateContext,
  gates: CorpusGate[],
  options?: RunGatesOptions
): Promise<GatePipelineSummary> {
  const results: GateResult[] = [];
  const reportedDiagnostics: LumenGateDiagnostic[] = [];

  const wrappedContext: GateContext = {
    ...context,
    reportDiagnostic(d: LumenGateDiagnostic) {
      reportedDiagnostics.push(d);
      if (typeof context.reportDiagnostic === 'function') {
        context.reportDiagnostic(d);
      }
    },
  };

  for (const gate of gates) {
    try {
      const result = await gate.run(wrappedContext);
      results.push(result);
      if (options?.bail && !result.passed) {
        break;
      }
    } catch (err: unknown) {
      const diagnostic: LumenGateDiagnostic = {
        code: 'GATE_INTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      };
      results.push({
        name: gate.name,
        passed: false,
        diagnostics: [diagnostic],
      });
      if (options?.bail) {
        break;
      }
    }
  }

  // Deduplicate diagnostics by code, file, line, column, and message
  const seenDiagKeys = new Set<string>();
  const allDiagnostics: LumenGateDiagnostic[] = [];
  for (const d of [...results.flatMap((r) => r.diagnostics), ...reportedDiagnostics]) {
    const key = `${d.code}:${d.file ?? ''}:${d.line ?? ''}:${d.column ?? ''}:${d.message}`;
    if (!seenDiagKeys.has(key)) {
      seenDiagKeys.add(key);
      allDiagnostics.push(d);
    }
  }

  const hasErrors = allDiagnostics.some((d) => d.severity === 'error');
  const allPassed = results.every((r) => r.passed) && !hasErrors;

  return {
    passed: allPassed,
    results,
    diagnostics: allDiagnostics,
    totalDiagnosticsCount: allDiagnostics.length,
  };
}
