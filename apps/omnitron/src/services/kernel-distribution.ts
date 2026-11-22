import { readFileSync } from 'node:fs';
import path from 'node:path';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';
import { commandFailure } from '../execution/command-failure.js';
import { shellEscape } from '../shared/shell-escape.js';
import { resolveKernelBuild } from './kernel-catalog.js';
import { loadRuntimeExtractor } from '../release/runtime-extractor.js';
import { managedApplicationCommand } from './managed-rollout.js';
import { DEFAULT_LEASE_TIMING } from './node-deploy-lease.js';
import { remoteNode } from './host-upgrade.js';
import type { RemoteDeployer, DeployTarget } from './remote-deployer.service.js';

export function kernelReceiverSource(): string {
  return 'const loadRuntimeExtractor = ' + loadRuntimeExtractor.toString() + ';\n' +
    readFileSync(new URL('../../data/operations/stage-kernel.mjs', import.meta.url), 'utf8');
}

/** Caller holds the node deployment lease. Only local publisher receipts can name executable bytes. */
export async function stageCatalogRuntime(
  deployer: Pick<RemoteDeployer, 'inspectInstalledBundle' | 'readFromNode' | 'uploadToNode'>,
  target: DeployTarget,
  commit: string,
  excludeOwnerId?: string,
) {
  if (!target.expectedHostFingerprint) throw Error('A pinned SSH host key is required for kernel distribution');
  const bundle = await deployer.inspectInstalledBundle(target);
  if (!bundle.managed) throw Error('Kernel distribution requires independently supervised services');
  if (bundle.managed.ownerId === excludeOwnerId) throw Error('The target resolves to the coordinating execution owner');
  const { entry, archive } = await resolveKernelBuild(commit, bundle.managed);
  const release = path.posix.resolve(bundle.root, '../..');
  const registry = path.posix.resolve(release, '../..');
  if (path.posix.basename(registry) !== 'runtime' || path.posix.join(registry, 'releases', bundle.managed.backendArtifact, 'packages/0') !== bundle.root) {
    throw Error('Invalid managed runtime location');
  }
  const home = path.posix.dirname(registry);
  const account = bundle.managed.applicationAccount ?? { instanceHome: home };
  if (account.instanceHome !== home) throw Error('Kernel registry differs from the enrolled instance');
  // SFTP authenticates as the SSH administrator. Only open a file in the
  // administrator's fenced directory; the service gets one read-only descriptor.
  const archivePath = path.posix.join(DEFAULT_LEASE_TIMING.dir, 'kernel-' + entry.archive + '.tgz');
  const receiver = kernelReceiverSource();
  const read = async (command: string, phase: string) => {
    const result = await deployer.readFromNode(target, command, 600_000);
    if (result.code !== 0) {
      const reason = redactDiagnosticText(commandFailure(result.stderr, 'receiver exited ' + result.code));
      throw Error('Kernel staging ' + phase + ' failed: ' + reason);
    }
    return result.stdout.trim();
  };
  const invoke = async (phase: 'prepare' | 'install') => {
    const artifact = bundle.managed!.backendArtifact;
    const owner = managedApplicationCommand(account, { artifact, args: ['--input-type=module', '-e', receiver, phase, registry, artifact, JSON.stringify(entry)] });
    const command = phase === 'install' ? owner + ' < ' + shellEscape(archivePath) : owner;
    const answer = JSON.parse(await read(command, phase)) as { artifact: string; installed: boolean };
    if (answer.artifact !== entry.artifact || typeof answer.installed !== 'boolean') throw Error('Unconfirmed kernel staging receipt');
    return answer.installed;
  };
  if (!(await invoke('prepare'))) {
    const inspect = remoteNode(`import fs from 'node:fs';const file=${JSON.stringify(archivePath)};
      const stat=fs.lstatSync(file,{throwIfNoEntry:false});
      if(stat&&(!stat.isFile()||stat.uid!==process.getuid()||stat.nlink!==1||(stat.mode&0o077)||stat.size!==${entry.bytes}))
        throw Error('Unexpected administrative kernel archive');
      const disk=fs.statfsSync(${JSON.stringify(DEFAULT_LEASE_TIMING.dir)});
      if(!stat&&disk.bavail*disk.bsize<${entry.bytes}+256*1024**2)throw Error('Insufficient space for the administrative kernel archive');
      console.log(stat?'present':'absent');`);
    const state = await read(inspect, 'archive inspection');
    if (state === 'absent') await deployer.uploadToNode(target, archive, archivePath);
    else if (state !== 'present') throw Error('Unconfirmed administrative kernel archive');
    if (!(await invoke('install'))) throw Error('Receiver did not confirm sealed runtime installation');
  }
  // Unknown transfer or installation outcomes leave evidence. Only a verified
  // installed receipt permits cleanup, including when a later plan observes it.
  await read('rm -f -- ' + shellEscape(archivePath), 'archive cleanup');
  return entry.artifact;
}
