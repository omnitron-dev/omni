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
    `Routes:  ${report.matchedRoutes} / ${report.totalRoutes} matched (${report.missingRoutes.length} missing)`,
    `Anchors: ${report.matchedAnchors} / ${report.totalAnchors} matched (${report.missingAnchors.length} missing)`,
  ];

  if (report.missingRoutes.length > 0) {
    lines.push('', 'Missing Routes:');
    for (const r of report.missingRoutes) {
      lines.push(`  - ${r}`);
    }
  }

  if (report.missingAnchors.length > 0) {
    lines.push('', 'Missing Anchors:');
    for (const a of report.missingAnchors) {
      lines.push(`  - ${a}`);
    }
  }

  return lines.join('\n');
}
