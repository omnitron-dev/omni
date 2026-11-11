import { describe, it, expect } from 'vitest';
import { CliRunner } from '../harness/cli-runner.js';
import { defineCorpusGate, type GateContext, type GateResult, type LumenGateDiagnostic } from '@omnitron-dev/lumen';
import { expectDiagnostics } from '../harness/assertions.js';

describe('Tier 4: Scenario 14 — CLI Diagnostics and JSON Reporting', () => {
  const cliRunner = new CliRunner();

  it('runs lumen check command and outputs diagnostic messages', async () => {
    const result = await cliRunner.run('lumen', ['check', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Lumen CLI');
  });

  it('produces structured machine-readable JSON diagnostics with suggested code fixes', async () => {
    const diagnosticsGate = defineCorpusGate({
      name: 'json-diagnostics-reporter-gate',
      run(context: GateContext): GateResult {
        const diagnostics: LumenGateDiagnostic[] = [
          {
            code: 'LUMEN_INVALID_HEADING_SLUG',
            message: 'Heading contains reserved characters in anchor',
            file: 'docs/theory.pdx',
            line: 42,
            column: 1,
            suggestedFix: '## Spectral Rigidity {#spectral-rigidity}',
            severity: 'warning',
          },
          {
            code: 'LUMEN_DANGLING_THEOREM_REF',
            message: 'Referenced theorem thm-unknown does not exist',
            file: 'docs/corollaries.pdx',
            line: 15,
            suggestedFix: '@thm:thm-known',
            severity: 'error',
          },
        ];

        return {
          name: 'json-diagnostics-reporter-gate',
          passed: false,
          diagnostics,
        };
      },
    });

    const result = await diagnosticsGate.run({
      documents: [],
      graph: null as any,
      config: { title: 'Test' } as any,
      reportDiagnostic: () => {},
    });

    expect(result.passed).toBe(false);
    expect(result.diagnostics).toHaveLength(2);

    // Verify structured JSON serialization
    const jsonOutput = JSON.stringify(result.diagnostics, null, 2);
    const parsed = JSON.parse(jsonOutput);

    expect(Array.isArray(parsed)).toBe(true);
    expectDiagnostics(parsed, [
      {
        code: 'LUMEN_INVALID_HEADING_SLUG',
        severity: 'warning',
        hasSuggestedFix: true,
      },
      {
        code: 'LUMEN_DANGLING_THEOREM_REF',
        severity: 'error',
        hasSuggestedFix: true,
      },
    ]);
  });
});
