import { isDeepStrictEqual } from 'node:util';
import type { OperationReceipt } from './dto/execution-operations.js';

/** Completion must belong to the exact attempt the operator reviewed. */
export function assertReviewedBackupCompletion(previous: OperationReceipt, actual: OperationReceipt | null): void {
  const intent = (receipt: OperationReceipt) => ({ protocol: receipt.protocol, id: receipt.id, kind: receipt.kind,
    resources: receipt.resources, inputDigest: receipt.inputDigest, createdAt: receipt.createdAt });
  if (!actual || previous.kind !== 'backup' || !['prepared', 'running'].includes(previous.state) ||
      !['succeeded', 'failed', 'cancelled'].includes(actual.state) || actual.revision <= previous.revision ||
      !isDeepStrictEqual(intent(previous), intent(actual)) ||
      previous.execution && !isDeepStrictEqual(previous.execution, actual.execution))
    throw Error('Reviewed backup completion is unconfirmed: ' + previous.id);
}

/** Preserve the approved references when the same backup finishes before apply.
 * This only inspects receipts; cancellation remains the owner's CAS operation. */
export async function retainReviewedBackups(current: OperationReceipt[], reviewed: OperationReceipt[] | undefined,
  read: (id: string) => Promise<OperationReceipt | null>): Promise<OperationReceipt[]> {
  if (reviewed && new Set(reviewed.map(value => value.id)).size !== reviewed.length ||
      new Set(current.map(value => value.id)).size !== current.length)
    throw Error('Duplicate backup operation in the runtime update review');
  if (current.some(value => value.kind !== 'backup' || !['prepared', 'running'].includes(value.state)))
    throw Error('Runtime update review contains an unknown or non-backup operation');
  if (!reviewed) return [...current].sort((a, b) => a.id.localeCompare(b.id));
  const expected = new Map(reviewed.map(value => [value.id, value]));
  for (const receipt of current) {
    if (!isDeepStrictEqual(receipt, expected.get(receipt.id)))
      throw Error('Backup operations changed after review; prepare the current update plan');
  }
  const pending = new Set(current.map(value => value.id));
  for (const previous of reviewed) {
    if (!pending.has(previous.id)) assertReviewedBackupCompletion(previous, await read(previous.id));
  }
  return structuredClone(reviewed);
}
