import { verifyUrlAndAnchorParity } from '../../parity/parity-engine.js';
import { formatParityReport } from '../../parity/reporter.js';
import type { ParityReport } from '../../types.js';

export async function verifyCommand(
  source: string,
  target: string,
  options: { json?: boolean; format?: string } = {}
): Promise<ParityReport> {
  const isJson = options.json || options.format === 'json';
  const report = verifyUrlAndAnchorParity(source, target);

  if (isJson) {
    console.log(formatParityReport(report, 'json'));
  } else {
    console.log(formatParityReport(report, 'summary'));
  }

  return report;
}
