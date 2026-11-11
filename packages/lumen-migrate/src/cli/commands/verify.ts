import type { ParityReport } from '../../types.js';

import { formatParityReport } from '../../parity/reporter.js';
import { verifyUrlAndAnchorParity } from '../../parity/parity-engine.js';

export async function verifyCommand(
  source: string,
  target: string,
  options: { json?: boolean; format?: string; strict?: boolean } = {}
): Promise<ParityReport> {
  const isJson = options.json || options.format === 'json';
  const report = verifyUrlAndAnchorParity(source, target);

  if (!report.passed) {
    process.exitCode = 1;
  }

  if (isJson) {
    console.log(formatParityReport(report, 'json'));
  } else {
    console.log(formatParityReport(report, 'summary'));
  }

  if (!report.passed && options.strict) {
    throw new Error(`Parity verification failed (score: ${report.parityScore})`);
  }

  return report;
}
