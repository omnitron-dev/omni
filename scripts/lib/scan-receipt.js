import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const scanReceiptPrefix = 'OMNITRON_SOURCE_SCAN ';

/** Written by the analyzer after its last check. Node also uses exit 1 for an uncaught exception. */
export function completeScan(url, status, counts = {}) {
  if (process.env.OMNITRON_SOURCE_SCAN === '1') {
    const name = path.parse(fileURLToPath(url)).name;
    console.log(scanReceiptPrefix + JSON.stringify({ version: 1, name, status, counts }));
  }
  process.exitCode = status === 'findings' ? 1 : 0;
}
