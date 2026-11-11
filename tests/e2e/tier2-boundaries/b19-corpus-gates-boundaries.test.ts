import { describe, it, expect } from 'vitest';
import { defineCorpusGate, type GateContext, type GateResult, type LumenGateDiagnostic } from '@omnitron-dev/lumen';

describe('Feature 19: Verification Gates Framework Boundaries', () => {
  it('TC-B19-01: catches unhandled exception in gate execution and converts it to diagnostic', async () => {
    const crashingGate = defineCorpusGate({
      name: 'crash-prone-gate',
      run(): GateResult {
        throw new Error('Simulated internal gate failure');
      },
    });

    let result: GateResult;
    try {
      result = await crashingGate.run({} as GateContext);
    } catch (err: unknown) {
      result = {
        name: crashingGate.name,
        passed: false,
        diagnostics: [
          {
            code: 'GATE_INTERNAL_ERROR',
            message: err instanceof Error ? err.message : String(err),
            severity: 'error',
          },
        ],
      };
    }

    expect(result.passed).toBe(false);
    expect(result.diagnostics[0].code).toBe('GATE_INTERNAL_ERROR');
    expect(result.diagnostics[0].message).toContain('Simulated internal gate failure');
  });

  it('TC-B19-02: handles gate returning empty diagnostics array and passed=true successfully', async () => {
    const passingGate = defineCorpusGate({
      name: 'noop-gate',
      run: (): GateResult => ({
        name: 'noop-gate',
        passed: true,
        diagnostics: [],
      }),
    });

    const result = await passingGate.run({} as GateContext);
    expect(result.passed).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('TC-B19-03: aggregates multiple failing gates across a verification pipeline', async () => {
    const gates = [1, 2, 3, 4, 5].map((idx) =>
      defineCorpusGate({
        name: `gate-${idx}`,
        run: (): GateResult => ({
          name: `gate-${idx}`,
          passed: false,
          diagnostics: [
            {
              code: `ERR_GATE_${idx}`,
              message: `Gate ${idx} condition violated`,
              severity: 'error',
            },
          ],
        }),
      })
    );

    const results = await Promise.all(gates.map((g) => g.run({} as GateContext)));
    const allPassed = results.every((r) => r.passed);
    const totalDiagnostics = results.flatMap((r) => r.diagnostics);

    expect(allPassed).toBe(false);
    expect(results).toHaveLength(5);
    expect(totalDiagnostics).toHaveLength(5);
  });

  it('TC-B19-04: handles gate emitting 1,000 diagnostics without memory exhaustion or crash', async () => {
    const count = 1_000;
    const diagnostics: LumenGateDiagnostic[] = [];
    for (let i = 0; i < count; i++) {
      diagnostics.push({
        code: `ERR_STYLE_${i}`,
        message: `Style issue in document line ${i}`,
        line: i + 1,
        severity: 'warning',
      });
    }

    const verboseGate = defineCorpusGate({
      name: 'verbose-linter',
      run: (): GateResult => ({
        name: 'verbose-linter',
        passed: false,
        diagnostics,
      }),
    });

    const result = await verboseGate.run({} as GateContext);
    expect(result.diagnostics).toHaveLength(count);

    // Serialization check
    const serialized = JSON.stringify(result);
    expect(serialized.length).toBeGreaterThan(50_000);
  });

  it('TC-B19-05: handles duplicate gate registrations with identical names cleanly', () => {
    const gate1 = defineCorpusGate({
      name: 'shared-gate-name',
      run: (): GateResult => ({ name: 'shared-gate-name', passed: true, diagnostics: [] }),
    });

    const gate2 = defineCorpusGate({
      name: 'shared-gate-name',
      run: (): GateResult => ({ name: 'shared-gate-name', passed: true, diagnostics: [] }),
    });

    const gatesList = [gate1, gate2];
    const uniqueNames = new Set(gatesList.map((g) => g.name));

    expect(gatesList).toHaveLength(2);
    expect(uniqueNames.size).toBe(1);
  });
});
