import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OMNITRON_HOME } from '../config/defaults.js';
import { readPrivateRecord } from './execution-journal.js';
import type { ServiceScope } from '../commands/service-units.js';

export interface ManagedRuntime {
  protocol: 1;
  instanceHome: string;
  directory: string;
  scope: ServiceScope;
  cwd: string;
  environment: Record<string, string>;
  owner: { label: string; unit: string; artifact: string };
  backend: { label: string; unit: string; artifact: string };
}

export const managedRuntimeFile = () => path.join(OMNITRON_HOME, 'runtime', 'supervision.json');
export const managedSupervisorSocket = (config: ManagedRuntime) => path.join(config.directory, 'supervisor.sock');

export async function readManagedRuntime(): Promise<ManagedRuntime | null> {
  const config = await readPrivateRecord<ManagedRuntime>(managedRuntimeFile());
  if (!config) return null;
  if (config.protocol !== 1 || path.resolve(config.instanceHome) !== path.resolve(OMNITRON_HOME) ||
      !path.isAbsolute(config.directory) || !path.isAbsolute(config.cwd) ||
      !['user', 'system'].includes(config.scope) || !config.environment ||
      config.environment['OMNITRON_HOME'] !== config.instanceHome ||
      Object.values(config.environment).some(value => typeof value !== 'string') ||
      [config.owner, config.backend].some(job => !job || !/^[a-f0-9]{64}$/.test(job.artifact) ||
        !/^dev\.omnitron\.[a-z0-9.-]+$/.test(job.label) || !/^omnitron-[a-z0-9-]+\.service$/.test(job.unit)) ||
      config.owner.label === config.backend.label || config.owner.unit === config.backend.unit ||
      Buffer.byteLength(managedSupervisorSocket(config)) > 100) {
    throw new Error('Invalid independent supervision configuration');
  }
  const directory = await fs.lstat(config.directory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 ||
      (process.getuid && directory.uid !== process.getuid())) throw new Error('Supervision sockets require a private directory owned by the instance user');
  return config;
}

async function native(command: string, args: string[]): Promise<string> {
  return (await promisify(execFile)(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 })).stdout;
}

export async function managedJobPid(config: ManagedRuntime, job: 'owner' | 'backend'): Promise<number> {
  const target = config[job];
  let value: string | undefined;
  if (process.platform === 'darwin') {
    const domain = config.scope === 'system' ? 'system' : `gui/${process.getuid!()}`;
    value = (await native('/bin/launchctl', ['print', `${domain}/${target.label}`])).match(/^\s*pid = (\d+)\s*$/m)?.[1];
  } else if (process.platform === 'linux') {
    value = (await native('systemctl', [...(config.scope === 'user' ? ['--user'] : []), 'show', target.unit, '--property=MainPID', '--value'])).trim();
  } else throw new Error('Independent supervision requires launchd or systemd');
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`The ${job} OS service has no live main process`);
  return pid;
}

/** Native supervisor evidence, not a trusted environment flag. */
export async function verifyManagedIsolation(config: ManagedRuntime, ownerPid: number, guardianPid: number, backendPid?: number): Promise<void> {
  const [owner, backend] = await Promise.all([managedJobPid(config, 'owner'), managedJobPid(config, 'backend')]);
  if (owner !== ownerPid || backend !== guardianPid || owner === backend) throw new Error('OS service ownership disagrees with the resident process identities');
  if (process.platform === 'linux') {
    const group = (pid: number) => fs.readFile(`/proc/${pid}/cgroup`, 'utf8');
    const [ownerGroup, guardianGroup, childGroup] = await Promise.all([group(owner), group(backend), backendPid ? group(backendPid) : Promise.resolve(null)]);
    if (ownerGroup === guardianGroup || !ownerGroup.includes(`/${config.owner.unit}`) || !guardianGroup.includes(`/${config.backend.unit}`) ||
        (childGroup !== null && childGroup !== guardianGroup)) throw new Error('Owner and backend must occupy their separate configured systemd cgroups');
  }
  if (backendPid === process.pid && process.ppid !== guardianPid) throw new Error('The backend was not launched by its OS-supervised guardian');
}

export async function hostBootIdentity(): Promise<string> {
  if (process.platform === 'linux') return (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (process.platform === 'darwin') return (await native('/usr/sbin/sysctl', ['-n', 'kern.boottime'])).trim();
  throw new Error('Cannot verify this host boot identity');
}

export function assertCleanOwnerBoot(previous: unknown, bootId: string): void {
  if (previous === null) return;
  const receipt = previous as { bootId?: unknown; clean?: unknown; pid?: unknown };
  if (typeof receipt !== 'object' || !receipt || typeof receipt.bootId !== 'string' || !receipt.bootId ||
      typeof receipt.clean !== 'boolean' || !Number.isSafeInteger(receipt.pid) || Number(receipt.pid) < 1) {
    throw new Error('Invalid owner shutdown receipt; reconcile ownership before starting another owner');
  }
  if (!receipt.clean && receipt.bootId === bootId) {
    throw new Error('The previous owner did not shut down cleanly on this host boot. Reconcile its application processes before starting another owner; no processes were adopted or killed.');
  }
}
