// Native imports only: this boundary must work when the framework cannot load.
import { fsyncSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { persistStartupFailure } from './startup-failure-journal.js';
import { writeEmergencyStderr } from '../shared/emergency-output.js';

export async function guardEntry(component: string, load: () => Promise<unknown>,
  options: { persistFailure?: boolean } = {}): Promise<void> {
  try { await load(); }
  catch (error) {
    const id = randomUUID();
    const time = new Date().toISOString();
    const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
    const bytes = Buffer.from(JSON.stringify({ level: 60, time, component, event: 'runtime.startup_failed',
      _omnitron: { id, capturedAt: time, timeBasis: 'reported', processId: `bootstrap:${process.pid}`, stream: 'stderr' },
      msg: `${component} could not start: ${err.message}`, err }) + '\n');
    if (options.persistFailure !== false) {
      try { persistStartupFailure(id, bytes); } catch { /* stderr remains the final evidence if local storage is unavailable */ }
    }
    try {
      writeEmergencyStderr(bytes);
      // OS-service stderr is a file; pipes/terminals need no fsync here.
      try { fsyncSync(2); } catch { /* not a regular file */ }
    } finally { process.exit(1); }
  }
}
