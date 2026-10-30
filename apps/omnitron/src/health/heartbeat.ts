import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppHealthAnswer } from '../config/types.js';
import { validateHeartbeat, type HealthHeartbeat } from './contracts.js';

/**
 * Publish the result of real work. No timer is created and no success is inferred.
 * Standalone execution without OMNITRON_HEALTH_FILE is a no-op. Await each write.
 */
export async function writeHealthHeartbeat(
  answer: AppHealthAnswer,
  options: { file?: string; runId?: string; now?: number } = {},
): Promise<void> {
  const file = options.file ?? process.env['OMNITRON_HEALTH_FILE'];
  if (!file) return;
  const report: HealthHeartbeat = {
    schemaVersion: 1,
    timestamp: options.now ?? Date.now(),
    runId: options.runId ?? process.env['OMNITRON_RUN_ID'] ?? '',
    status: answer.status,
    checks: answer.checks ?? [],
  };
  validateHeartbeat(report);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(report), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}
