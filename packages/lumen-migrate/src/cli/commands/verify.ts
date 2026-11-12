import type { ParityReport } from '../../types.js';

import { formatParityReport } from '../../parity/reporter.js';
import { verifyUrlAndAnchorParity } from '../../parity/parity-engine.js';

export async function verifyCommand(
  source: string,
  target: string,
  options: { json?: boolean } = {}
): Promise<ParityReport> {
  const report = verifyUrlAndAnchorParity(source, target);

  if (!report.passed) {
    process.exitCode = 1;
  }

  if (options.json) {
    console.log(formatParityReport(report, 'json'));
  } else {
    console.log(formatParityReport(report, 'summary'));
  }

  return report;
}
