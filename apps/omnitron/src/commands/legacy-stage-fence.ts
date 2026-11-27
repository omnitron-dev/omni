import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readHostBootIdentity } from '@omnitron-dev/common/process-identity';
import { readOwnedServiceBytes, serviceReadFlags } from './service-record.js';
import { DEFAULT_LEASE_TIMING, type LeaseRecord } from '../services/node-deploy-lease.js';
import type { NativeLegacyStageFence } from '../shared/dto/nodes.js';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
type Intent = { schema: number; id: string; token: string; timeoutMs: number };

/** Decode the exact bytes produced by the historical lease and guard. The bearer token never leaves this process. */
export function readLegacyStageRecords(leaseBytes: Buffer, executionBytes: Buffer) {
  let lease: Partial<LeaseRecord>, intent: Partial<Intent>;
  try {
    lease = JSON.parse(leaseBytes.toString());
    intent = JSON.parse(executionBytes.toString());
  } catch { throw Error('Invalid protected machine fence records'); }
  if (!lease || lease.stack !== 'stage managed kernel' || typeof lease.token !== 'string' || !uuid.test(lease.token) ||
      typeof lease.holder !== 'string' || !lease.holder || typeof lease.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(lease.startedAt)) || new Date(lease.startedAt).toISOString() !== lease.startedAt)
    throw Error('The lease does not identify a legacy passive stage');
  if (!intent || intent.schema !== 1 || intent.token !== lease.token || typeof intent.id !== 'string' || !uuid.test(intent.id) ||
      intent.id === lease.token || typeof intent.timeoutMs !== 'number' || !Number.isSafeInteger(intent.timeoutMs) ||
      intent.timeoutMs < 1 || intent.timeoutMs > 86_400_000)
    throw Error('The records do not identify a matching legacy passive-stage lease and command');
  const expectedLease = JSON.stringify({ token: lease.token, holder: lease.holder, stack: lease.stack, startedAt: lease.startedAt });
  const expectedIntent = JSON.stringify({ schema: 1, id: intent.id, token: intent.token, timeoutMs: intent.timeoutMs }) + '\n';
  if (!leaseBytes.equals(Buffer.from(expectedLease)) || !executionBytes.equals(Buffer.from(expectedIntent)))
    throw Error('The records differ from the original passive-stage encoding');
  return { commandId: intent.id, timeoutMs: intent.timeoutMs, leaseSha256: hash(leaseBytes), executionSha256: hash(executionBytes) };
}

export function assertNoStageCompletion(directory: string): void {
  try {
    fs.lstatSync(path.join(directory, 'deploy.execution.completed'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw Error('A completion record is present; use its own reconciliation protocol');
}

/** Both advisory locks stay on their original open file descriptions for the entire observation. */
export function lockStageGuards(directory: string, uid: number, readingTerminal = false) {
  const descriptors: number[] = [];
  try {
    const dev = fs.statSync(directory, { bigint: true }).dev;
    const safeGuard = (st: fs.BigIntStats) => st.isFile() && st.dev === dev && st.uid === BigInt(uid) && st.nlink === 1n && !(st.mode & 0o022n);
    const guards = ['deploy.guard', 'deploy.execution.guard'].map(name => {
      const file = path.join(directory, name);
      const fd = fs.openSync(file, serviceReadFlags);
      descriptors.push(fd);
      const st = fs.fstatSync(fd, { bigint: true });
      if (!safeGuard(st)) throw Error('Unsafe machine deployment guard');
      try {
        execFileSync('/usr/bin/flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
          { env: { LC_ALL: 'C' }, stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 3000 });
      } catch (error) {
        if ((error as { status?: number }).status === 73) throw Error('Machine deployment or execution guard is busy', { cause: error });
        throw Error('Could not acquire the existing Linux machine guard', { cause: error });
      }
      return { file, ino: st.ino };
    });
    const check = (terminal = false) => {
      for (const guard of guards) {
        const st = fs.lstatSync(guard.file, { bigint: true });
        if (!safeGuard(st) || st.ino !== guard.ino) throw Error('Machine fence guard changed during inspection');
      }
      if (!terminal) assertNoStageCompletion(directory);
    };
    check(readingTerminal);
    return { check, close: () => { for (const fd of descriptors.reverse()) fs.closeSync(fd); } };
  } catch (error) {
    for (const fd of descriptors.reverse()) fs.closeSync(fd);
    throw error;
  }
}

export function withExistingStageGuards<T>(directory: string, uid: number, inspect: () => T): T {
  const guards = lockStageGuards(directory, uid);
  try { const result = inspect(); guards.check(); return result; }
  finally { guards.close(); }
}

/** Pin each physical ancestor before opening the next component. Only deployment's fixed lock directory is inspected. */
export function openMachineStageGuards(readingTerminal = false) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw Error('Machine fence inspection requires the Linux host administrator');
  const directory = DEFAULT_LEASE_TIMING.dir;
  const descriptors: number[] = [];
  try {
    let opened = '/';
    for (const component of ['', ...directory.split('/').filter(Boolean)]) {
      const fd = fs.openSync(path.join(opened, component), serviceReadFlags | fs.constants.O_DIRECTORY);
      descriptors.push(fd);
      const st = fs.fstatSync(fd);
      if (st.uid !== 0 || st.mode & 0o022) throw Error('Machine fence directory requires root-owned physical ancestors');
      opened = '/proc/self/fd/' + fd;
    }
    const current = fs.statSync(opened, { bigint: true });
    const type = fs.statfsSync(opened, { bigint: true }).type;
    if (![0xef53n, 0x58465342n, 0x9123683en].includes(type)) throw Error('Machine fence requires a persistent local ext, XFS or Btrfs filesystem');
    const checkDirectory = () => {
      const actual = fs.lstatSync(directory, { bigint: true });
      if (fs.realpathSync(directory) !== directory || actual.dev !== current.dev || actual.ino !== current.ino)
        throw Error('Machine fence directory changed during inspection');
    };
    checkDirectory();
    const guards = lockStageGuards(opened, 0, readingTerminal);
    return {
      directory: opened,
      check: (terminal = false) => { checkDirectory(); guards.check(terminal); },
      close: () => { guards.close(); for (const fd of descriptors.reverse()) fs.closeSync(fd); },
    };
  } catch (error) {
    for (const fd of descriptors.reverse()) fs.closeSync(fd);
    throw error;
  }
}

export function readStageMachineIdentity() {
  const machine = readOwnedServiceBytes('/etc/machine-id', 0, 64).toString();
  if (!/^[0-9a-f]{32}\n$/.test(machine) || /^0+\n$/.test(machine)) throw Error('Linux machine identity is unavailable');
  return { bootId: readHostBootIdentity(), machineIdSha256: hash('omnitron-stage-fence-v1\0' + machine.trim()) };
}

export function readStageFile(directory: string, name: 'deploy.lease' | 'deploy.execution.json', uid = 0) {
  const file = path.join(directory, name);
  if (fs.lstatSync(file, { bigint: true }).dev !== fs.statSync(directory, { bigint: true }).dev)
    throw Error('Machine fence file is on a different filesystem');
  return readOwnedServiceBytes(file, uid, 4096);
}

/** Runs in the installed administrative CLI on Linux. No daemon, lease renewal or installation is involved. */
export function inspectLocalLegacyStageFence(): NativeLegacyStageFence {
  const guard = openMachineStageGuards();
  try {
    const records = readLegacyStageRecords(readStageFile(guard.directory, 'deploy.lease'), readStageFile(guard.directory, 'deploy.execution.json'));
    const identity = readStageMachineIdentity();
    guard.check();
    return { state: 'unresolved-legacy-stage', ...records, ...identity };
  } finally { guard.close(); }
}
