import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';
import { commandFailure } from '../execution/command-failure.js';
import { shellEscape } from '../shared/shell-escape.js';
import { resolveKernelBuild } from './kernel-catalog.js';
import { loadRuntimeExtractor } from '../release/runtime-extractor.js';
import { publishRuntimeTree, syncRuntimeEntries } from '../daemon/runtime-publication.js';
import { managedApplicationCommand, pinnedRolloutEndpoint } from './managed-rollout.js';
import { DEFAULT_LEASE_TIMING } from './node-deploy-lease.js';
import { remoteNode } from './host-upgrade.js';
import type { RemoteDeployer, DeployTarget } from './remote-deployer.service.js';

export function kernelReceiverSource(): string {
  return 'const loadRuntimeExtractor = ' + loadRuntimeExtractor.toString() + ';\n' +
    'const syncRuntimeEntries = ' + syncRuntimeEntries.toString() + ';\n' +
    'const publishRuntimeTree = ' + publishRuntimeTree.toString() + ';\n' +
    readFileSync(new URL('../../data/operations/stage-kernel.mjs', import.meta.url), 'utf8');
}

/** Never include the receiver's data-channel stdout in a failure receipt. */
export function kernelStageFailure(phase: string, exit: number, stderr: string, elapsedMs: number): string {
  let lastStep: string | undefined;
  const diagnostics = stderr.split(/\r?\n/).filter(line => {
    const progress = /^omnitron\.kernel\.stage (archive-digest|archive-inventory|extract|file-modes|candidate-verification|durable-publication|installed-verification)$/.exec(line);
    if (progress) lastStep = progress[1];
    return !line.startsWith('omnitron.kernel.stage ');
  });
  const detail = redactDiagnosticText(commandFailure(diagnostics.join('\n'), 'receiver did not report a diagnostic'));
  return `Kernel staging ${phase} failed (exit ${exit}, ${Math.round(elapsedMs)} ms${lastStep ? ', last step ' + lastStep : ''}): ${detail}`;
}

/** A lease holder stages bytes; recovery only observes a previously witnessed installation. */
export async function stageCatalogRuntime(
  deployer: Pick<RemoteDeployer, 'inspectInstalledBundle' | 'readFromNode' | 'uploadToNode'>,
  target: DeployTarget,
  commit: string,
  excludeOwnerId?: string,
  completedScope?: string,
) {
  if (!target.expectedHostFingerprint) throw Error('A pinned SSH host key is required for kernel distribution');
  const bundle = await deployer.inspectInstalledBundle(target);
  if (!bundle.managed) throw Error('Kernel distribution requires independently supervised services');
  if (excludeOwnerId !== undefined && bundle.managed.ownerId === excludeOwnerId) throw Error('The target resolves to the coordinating execution owner');
  const managed = bundle.managed;
  if (!managed.ownerId || !/^[a-f0-9]{64}$/.test(managed.ownerArtifact) ||
      ![managed.ownerPid, managed.backendPid].every(pid => Number.isSafeInteger(pid) && pid > 0))
    throw Error('Kernel distribution requires the verified serving backend and execution owner identities');
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
  const read = async (command: string, phase: string, kernelInstallScope?: string) => {
    const started = performance.now();
    const result = await deployer.readFromNode(target, command, 600_000, kernelInstallScope);
    if (result.code !== 0) throw Error(kernelStageFailure(phase, result.code, result.stderr, performance.now() - started));
    return result.stdout.trim();
  };
  const scope = (revision: number) => createHash('sha256').update(JSON.stringify([
    'kernel-install@1', target.registrationId ?? null, pinnedRolloutEndpoint(target), home, managed.applicationAccount?.uid, managed.applicationAccount?.gid,
    managed.ownerId, managed.ownerPid, managed.ownerArtifact, bundle.applicationRuntime?.execution?.epoch, bundle.applicationRuntime?.execution?.lifetime,
    managed.backendPid, managed.backendArtifact, revision,
    entry.commit, entry.artifact, entry.archive,
  ])).digest('hex');
  const invoke = async (phase: 'observe' | 'prepare' | 'install', revision?: number) => {
    const artifact = managed.backendArtifact;
    const args = ['--input-type=module', '-e', receiver, phase, registry, artifact, JSON.stringify(entry)];
    if (revision !== undefined) args.push(String(revision));
    const owner = managedApplicationCommand(account, { artifact, args });
    const command = phase === 'install' ? owner + ' < ' + shellEscape(archivePath) : owner;
    const answer = JSON.parse(await read(command, phase, revision === undefined ? undefined : scope(revision))) as
      { artifact: string; installed: boolean; revision: number };
    if (answer.artifact !== entry.artifact || typeof answer.installed !== 'boolean' ||
        (phase !== 'install' && (!Number.isSafeInteger(answer.revision) || answer.revision < 1))) throw Error('Unconfirmed kernel staging receipt');
    return answer;
  };
  if (completedScope !== undefined) {
    const observation = await invoke('observe');
    if (!observation.installed || scope(observation.revision) !== completedScope)
      throw Error('The installed artifact, selected revision, owner or registered target differs from the completed command');
    return entry.artifact;
  }
  const prepared = await invoke('prepare');
  if (!prepared.installed) {
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
    if (!(await invoke('install', prepared.revision)).installed) throw Error('Receiver did not confirm sealed runtime installation');
  }
  // Unknown transfer or installation outcomes leave evidence. Only a verified
  // installed receipt permits cleanup, including when a later plan observes it.
  await read('rm -f -- ' + shellEscape(archivePath), 'archive cleanup');
  return entry.artifact;
}
