// Native imports only: this boundary must work when the framework cannot load.
import { writeSync, fsyncSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { persistStartupFailure } from './startup-failure-journal.js';

export async function guardEntry(component: string, load: () => Promise<unknown>): Promise<void> {
  try { await load(); }
  catch (error) {
    const id = randomUUID();
    const time = new Date().toISOString();
    const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
    const bytes = Buffer.from(JSON.stringify({ level: 60, time, component, event: 'runtime.startup_failed',
      _omnitron: { id, capturedAt: time, timeBasis: 'reported', processId: `bootstrap:${process.pid}`, stream: 'stderr' },
      msg: `${component} could not start: ${err.message}`, err }) + '\n');
    try { persistStartupFailure(id, bytes); } catch { /* stderr remains the final evidence if local storage is unavailable */ }
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(2, bytes, offset, bytes.length - offset);
        if (!written) break;
        offset += written;
      }
      // OS-service stderr is a file; pipes/terminals need no fsync here.
      try { fsyncSync(2); } catch { /* not a regular file */ }
    } finally { process.exit(1); }
  }
}
