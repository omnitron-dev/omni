import { createHash } from 'crypto';

/**
 * Compute checksum of data
 */
export function computeChecksum(data: any): string {
  const hash = createHash('sha256');
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  hash.update(str);
  return hash.digest('hex');
}
