import { readFileSync } from 'node:fs';
import path from 'node:path';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';
import { commandFailure } from '../execution/command-failure.js';
import { shellEscape } from '../shared/shell-escape.js';
import { resolveKernelBuild } from './kernel-catalog.js';
import { loadRuntimeExtractor } from '../release/runtime-extractor.js';
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
  const destination = path.posix.join(registry, '.incoming-' + entry.artifact, 'runtime.tgz');
  const receiver = kernelReceiverSource();
  const invoke = async (phase: 'prepare' | 'install') => {
    const command = ['env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH', path.posix.join(release, 'node'), '--input-type=module', '-e', receiver, phase,
      registry, bundle.managed!.backendArtifact, JSON.stringify(entry)].map(shellEscape).join(' ');
    const result = await deployer.readFromNode(target, command, 600_000);
    if (result.code !== 0) {
      const reason = redactDiagnosticText(commandFailure(result.stderr, 'receiver exited ' + result.code));
      throw Error('Kernel staging ' + phase + ' failed: ' + reason);
    }
    const answer = JSON.parse(result.stdout) as { artifact: string; installed: boolean };
    if (answer.artifact !== entry.artifact || typeof answer.installed !== 'boolean') throw Error('Unconfirmed kernel staging receipt');
    return answer.installed;
  };
  if (!(await invoke('prepare'))) {
    await deployer.uploadToNode(target, archive, destination);
    if (!(await invoke('install'))) throw Error('Receiver did not confirm sealed runtime installation');
  }
  return entry.artifact;
}
