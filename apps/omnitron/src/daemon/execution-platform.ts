import fs from 'node:fs';

/** A detached child still belongs to its parent's systemd cgroup. Fail closed. */
export function residentOwnerRefusal(): string | null {
  if (process.platform === 'win32') return 'Resident execution currently requires owner-only Unix sockets';
  if (process.env['INVOCATION_ID'] || process.env['SYSTEMD_EXEC_PID'] ||
      process.env['XPC_SERVICE_NAME']?.includes('omnitron')) {
    return 'The backend runs under an OS service. Configure independent execution-owner supervision before transferring the backend; detaching does not isolate an OS service process group.';
  }
  if (process.platform === 'linux') {
    try {
      const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
      if (/\/(?:system|user)\.slice\/.*\.service(?:\/|\n|$)/m.test(cgroup)) {
        return 'The backend belongs to a systemd service cgroup; resident-owner activation needs a separate service cgroup';
      }
    } catch { return 'Cannot verify OS process-group isolation; resident-owner activation is refused'; }
  }
  return null;
}
