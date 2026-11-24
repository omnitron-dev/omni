import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { signRecoveryEnvelope } from '@omnitron-dev/titan-auth/owner-recovery';
import { validateRecoveryCommission } from '../owner-recovery/authority.js';
import { readOwnedServiceBytes } from './service-record.js';
import { emitError, emitJson, emitSuccess } from './output.js';

/** The commissioning host keeps its long-lived key offline. Only the envelope is transferred. */
export function signOwnerRecoveryManifest(manifest: string, options: { keyFile: string; output: string }): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw Error('Cannot establish commissioning key ownership');
  const reviewed = JSON.parse(readOwnedServiceBytes(manifest, uid, 32768).toString('utf8'));
  validateRecoveryCommission(reviewed);
  const key = readOwnedServiceBytes(options.keyFile, uid, 16384, true);
  let content: string;
  try { content = JSON.stringify(signRecoveryEnvelope('commission', reviewed, createPrivateKey(key)), null, 2) + '\n'; }
  finally { key.fill(0); }
  const target = path.resolve(options.output);
  const temp = target + '.' + randomUUID();
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.linkSync(temp, target);
  } finally { fs.unlinkSync(temp); }
  return target;
}

export async function signOwnerRecoveryCommand(manifest: string, options: { keyFile: string; output: string }): Promise<void> {
  try {
    const output = signOwnerRecoveryManifest(manifest, options);
    if (!emitJson({ output })) emitSuccess('Wrote signed recovery enrollment to ' + output);
  } catch (error) {
    if (!emitError(error)) console.error(error instanceof Error ? error.message : 'Recovery commissioning failed');
    process.exitCode = 1;
  }
}
