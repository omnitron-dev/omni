import { createHash } from 'node:crypto';
import { isStableHostBootIdentity } from '@omnitron-dev/common/process-identity';
import type { LegacyStageFenceObservation, NativeLegacyStageFence, StageFenceRecipient } from '../shared/dto/nodes.js';
import { pinnedRolloutEndpoint } from './managed-rollout.js';
import type { DeployTarget } from './remote-deployer.service.js';

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);

export function stageFenceRecipient(target: DeployTarget): StageFenceRecipient {
  if (!target.registrationId || !target.expectedHostFingerprint) throw Error('Fence inspection requires a pinned registered remote node');
  return { nodeId: target.registrationId, sshFingerprint: target.expectedHostFingerprint,
    endpointSha256: createHash('sha256').update(pinnedRolloutEndpoint(target)).digest('hex') };
}

/** Project the same public fields when accepting a host observation and when recovering its durable receipt. */
export function readNativeFence(value: Partial<NativeLegacyStageFence> | undefined): NativeLegacyStageFence {
  if (value?.state !== 'unresolved-legacy-stage' || !uuid(value.bootId) || !isStableHostBootIdentity(value.bootId) ||
      !uuid(value.commandId) || !digest(value.machineIdSha256) || !digest(value.executionSha256) || !digest(value.leaseSha256) ||
      typeof value.timeoutMs !== 'number' || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 86_400_000)
    throw Error('Incomplete reply from the installed fence inspector');
  return { state: value.state, bootId: value.bootId, commandId: value.commandId, timeoutMs: value.timeoutMs,
    machineIdSha256: value.machineIdSha256, leaseSha256: value.leaseSha256, executionSha256: value.executionSha256 };
}

/** Invoke only the administrative CLI installed on the pinned recipient. Never run a service-owned release as root. */
export async function inspectRegisteredStageFence(recipient: StageFenceRecipient, inspectorArtifact: string,
  read: (command: string) => Promise<{ code: number; stdout: string }>): Promise<LegacyStageFenceObservation> {
  if (!digest(inspectorArtifact)) throw Error('Invalid inspector artifact');
  // backend install copies a sealed, internally linked closure into this private store.
  // The service account cannot supply a program via PATH, a selected release, a global npm link or a forwarded environment.
  const home = '/root/.omnitron-maintenance';
  const runtime = home + '/runtime/releases/' + inspectorArtifact;
  const node = runtime + '/node', cli = runtime + '/packages/0/dist/cli/omnitron.js';
  const command = [
    'cd /', '[ "$(/usr/bin/stat -c %u:%a /root)" = 0:700 ]',
    ...[node, cli].map(file => '[ "$(/usr/bin/realpath -e ' + file + ')" = ' + file + ' ] && [ "$(/usr/bin/stat -c %u ' + file + ')" = 0 ]'),
    '/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C OMNITRON_HOME=' + home + ' ' + node + ' ' + cli + ' --json service inspect-stage-fence',
  ].join(' && ');
  const result = await read(command);
  if (result.code !== 0) throw Error('The recipient administrative CLI could not inspect the legacy passive-stage fence (exit ' + result.code +
    '). Check CLI support, administrative ownership, the two guards and the protected stage records.');
  let envelope: { ok?: unknown; data?: Partial<NativeLegacyStageFence> };
  try { envelope = JSON.parse(result.stdout); } catch { throw Error('Invalid reply from the installed fence inspector'); }
  if (envelope?.ok !== true) throw Error('Invalid reply from the installed fence inspector');
  return { ...readNativeFence(envelope.data), ...recipient, inspectorArtifact };
}
