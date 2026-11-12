import type { ParityReport } from '../types.js';

export function formatParityReport(report: ParityReport, format: 'summary' | 'json' = 'summary'): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const lines = [
    '=== Lumen URL & Anchor Parity Report ===',
    `Status: ${report.passed ? 'PASSED (100% Parity)' : 'FAILED'}`,
    `Parity Score: ${(report.parityScore * 100).toFixed(2)}%`,
    '',
    `Routes:  ${report.routes.preserved} / ${report.routes.total} matched (${report.routes.missing.length} missing)`,
    `Anchors: ${report.anchors.preserved} / ${report.anchors.total} matched (${report.anchors.missing.length} missing)`,
  ];

  if (report.routes.missing.length > 0) {
    lines.push('', 'Missing Routes:');
    for (const r of report.routes.missing) {
      lines.push(`  - ${r}`);
    }
  }

  if (report.anchors.missing.length > 0) {
    lines.push('', 'Missing Anchors:');
    for (const a of report.anchors.missing) {
      lines.push(`  - ${a}`);
    }
  }

  return lines.join('\n');
}
