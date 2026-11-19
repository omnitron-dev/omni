import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TraceReport } from './finite-traces.js';

/** Serialize public fixture observations. When requested, publish a complete receipt for CI. */
export async function recordTraceReceipt<View>(
  profile: string,
  report: TraceReport<View>,
  { directory = process.env['OMNITRON_TEST_EVIDENCE_DIR'], sourceCommit = process.env['OMNITRON_TEST_SOURCE_COMMIT'] }:
    { directory?: string; sourceCommit?: string } = {},
): Promise<string> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(profile)) throw Error('Invalid trace profile name');
  if (sourceCommit !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sourceCommit))
    throw Error('A trace source commit must be a full Git object ID');
  const receipt = JSON.stringify({
    schemaVersion: 1, profile, sourceCommit,
    runtime: { node: process.versions.node, platform: process.platform, arch: process.arch }, ...report,
  });
  if (directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `${profile}-${randomUUID()}.json`);
    const temporary = destination + '.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try { await handle.writeFile(receipt + '\n'); }
      finally { await handle.close(); }
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return receipt;
}
