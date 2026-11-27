import { isStableHostBootIdentity } from '@omnitron-dev/common/process-identity';
import type { LegacyStageFenceObservation, NativeLegacyStageFence } from '../shared/dto/nodes.js';

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);

/** Invoke only the administrative CLI installed on the pinned recipient. Never run a service-owned release as root. */
export async function inspectRegisteredStageFence(nodeId: string, sshFingerprint: string, inspectorArtifact: string,
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
  const data = envelope?.data;
  if (envelope?.ok !== true || data?.state !== 'unresolved-legacy-stage' || !uuid(data.bootId) || !isStableHostBootIdentity(data.bootId) ||
      !uuid(data.commandId) || !digest(data.machineIdSha256) || !digest(data.executionSha256) || !digest(data.leaseSha256) ||
      typeof data.timeoutMs !== 'number' || !Number.isSafeInteger(data.timeoutMs) || data.timeoutMs < 1 || data.timeoutMs > 86_400_000)
    throw Error('Incomplete reply from the installed fence inspector');
  return { state: data.state, nodeId, sshFingerprint, inspectorArtifact, bootId: data.bootId, commandId: data.commandId, timeoutMs: data.timeoutMs,
    machineIdSha256: data.machineIdSha256, leaseSha256: data.leaseSha256, executionSha256: data.executionSha256 };
}
