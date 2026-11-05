// Native imports only: usable before framework startup and when logging fails.
import { writeSync } from 'node:fs';

/** A stream.write() error can arrive after try/catch. Keep this final boundary synchronous. */
export function writeEmergencyStderr(bytes: Uint8Array): void {
  let offset = 0, interruptions = 0;
  while (offset < bytes.length) {
    let written: number;
    try { written = writeSync(2, bytes, offset, bytes.length - offset); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EINTR' && ++interruptions <= 3) continue;
      // ENOSPC/EPIPE/EAGAIN are failures, not an unbounded retry queue.
      throw error;
    }
    if (written <= 0 || written > bytes.length - offset) throw new Error('Emergency stderr write made no valid progress');
    offset += written;
  }
}
