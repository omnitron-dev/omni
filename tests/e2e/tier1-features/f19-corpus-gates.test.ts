import { describe, it, expect } from 'vitest';
import { defineCorpusGate, type GateContext, type GateResult } from '@omnitron-dev/lumen';
import { createCorpusBuilder } from '../harness/corpus-builder.js';

describe('Feature 19: Verification Gates Framework', () => {
  it('TC-F19-01: defines a custom corpus gate using defineCorpusGate', () => {
    const gate = defineCorpusGate({
      name: 'frontmatter-title-gate',
      description: 'Checks that all documents declare a title',
      run(context: GateContext): GateResult {
        const diagnostics = [];
        for (const doc of context.documents) {
          if (!doc.title) {
            diagnostics.push({
              code: 'ERR_MISSING_TITLE',
              message: `Document ${doc.id} is missing a title`,
              severity: 'error' as const,
            });
          }
        }
        return {
          name: 'frontmatter-title-gate',
          passed: diagnostics.length === 0,
          diagnostics,
        };
      },
    });

    expect(gate.name).toBe('frontmatter-title-gate');
    expect(typeof gate.run).toBe('function');
  });

  it('TC-F19-02: executes gate successfully when all documents pass invariants', async () => {
    const gate = defineCorpusGate({
      name: 'valid-docs-gate',
      run(): GateResult {
        return {
          name: 'valid-docs-gate',
          passed: true,
          diagnostics: [],
        };
      },
    });

    const result = await gate.run({} as any);
    expect(result.passed).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('TC-F19-03: reports structured diagnostics when gate detects invalid state', async () => {
    const gate = defineCorpusGate({
      name: 'broken-link-gate',
      run(): GateResult {
        return {
          name: 'broken-link-gate',
          passed: false,
          diagnostics: [
            {
              code: 'ERR_BROKEN_LINK',
              message: 'Target ./missing.pdx not found',
              file: 'docs/page-a.pdx',
              line: 12,
              severity: 'error',
            },
          ],
        };
      },
    });

    const result = await gate.run({} as any);
    expect(result.passed).toBe(false);
    expect(result.diagnostics[0].code).toBe('ERR_BROKEN_LINK');
    expect(result.diagnostics[0].line).toBe(12);
  });

  it('TC-F19-04: detects cyclic dependencies in mathematical theorem graph', () => {
    const builder = createCorpusBuilder()
      .addMathObject({
        id: 'thm-1',
        envType: 'theorem',
        title: 'Theorem 1',
        docId: 'doc',
        dependsOn: ['thm-2'],
      })
      .addMathObject({
        id: 'thm-2',
        envType: 'theorem',
        title: 'Theorem 2',
        docId: 'doc',
        dependsOn: ['thm-1'],
      });

    const graph = builder.build();
    const cycles = graph.detectMathCycles();
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toContain('thm-1');
    expect(cycles[0]).toContain('thm-2');
  });

  it('TC-F19-05: aggregates results across a pipeline of multiple verification gates', async () => {
    const gateA = defineCorpusGate({
      name: 'gate-a',
      run: () => ({ name: 'gate-a', passed: true, diagnostics: [] }),
    });

    const gateB = defineCorpusGate({
      name: 'gate-b',
      run: () => ({
        name: 'gate-b',
        passed: false,
        diagnostics: [{ code: 'WARN_STYLE', message: 'Spacing', severity: 'warning' }],
      }),
    });

    const results = await Promise.all([gateA.run({} as any), gateB.run({} as any)]);
    const overallPassed = results.every((r) => r.passed);

    expect(overallPassed).toBe(false);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });
});
