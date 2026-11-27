import { createHash } from 'node:crypto';
import { isStableHostBootIdentity } from '@omnitron-dev/common/process-identity';
import type { LegacyStageFenceObservation, NativeLegacyStageFence, StageFenceRecipient, StageRecoveryRequest, StageRecoveryReceipt } from '../shared/dto/nodes.js';
import { stageSelectionRefusals, validStageSelection } from '../shared/stage-selection.js';
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

function adminStageCommand(inspectorArtifact: string, subcommand: string) {
  if (!digest(inspectorArtifact)) throw Error('Invalid inspector artifact');
  // backend install copies a sealed, internally linked closure into this private store.
  // The service account cannot supply a program via PATH, a selected release, a global npm link or a forwarded environment.
  const home = '/root/.omnitron-maintenance';
  const runtime = home + '/runtime/releases/' + inspectorArtifact;
  const node = runtime + '/node', cli = runtime + '/packages/0/dist/cli/omnitron.js';
  return [
    'cd /', '[ "$(/usr/bin/stat -c %u:%a /root)" = 0:700 ]',
    ...[node, cli].map(file => '[ "$(/usr/bin/realpath -e ' + file + ')" = ' + file + ' ] && [ "$(/usr/bin/stat -c %u ' + file + ')" = 0 ]'),
    '/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C OMNITRON_HOME=' + home + ' ' + node + ' ' + cli + ' --json service ' + subcommand,
  ].join(' && ');
}

/** Invoke only the administrative CLI installed on the pinned recipient. Never run a service-owned release as root. */
export async function inspectRegisteredStageFence(recipient: StageFenceRecipient, inspectorArtifact: string,
  read: (command: string) => Promise<{ code: number; stdout: string }>): Promise<LegacyStageFenceObservation> {
  if (!digest(inspectorArtifact)) throw Error('Invalid inspector artifact');
  const command = adminStageCommand(inspectorArtifact, 'inspect-stage-fence');
  const result = await read(command);
  if (result.code !== 0) throw Error('The recipient administrative CLI could not inspect the legacy passive-stage fence (exit ' + result.code +
    '). Check CLI support, administrative ownership, the two guards and the protected stage records.');
  let envelope: { ok?: unknown; data?: Partial<NativeLegacyStageFence> };
  try { envelope = JSON.parse(result.stdout); } catch { throw Error('Invalid reply from the installed fence inspector'); }
  if (envelope?.ok !== true) throw Error('Invalid reply from the installed fence inspector');
  return { ...readNativeFence(envelope.data), ...recipient, inspectorArtifact };
}

export async function recoverRegisteredStageFence(inspector: string, request: StageRecoveryRequest,
  run: (command: string) => Promise<{ code: number; stdout: string; stderr?: string }>): Promise<StageRecoveryReceipt> {
  if (!['prepare','finish'].includes(request.action) || !uuid(request.recordId) || !digest(request.scope)) throw Error('Invalid stage recovery request');
  const observed = readNativeFence(request.observation);
  const args = ['recover-stage-fence', request.action, '--record', request.recordId, '--scope', request.scope,
    '--boot', observed.bootId, '--machine', observed.machineIdSha256, '--command-id', observed.commandId, '--timeout-ms',
    String(observed.timeoutMs), '--lease', observed.leaseSha256, '--execution', observed.executionSha256];
  const result = await run(adminStageCommand(inspector, args.join(' ')));
  if (result.code !== 0) {
    let reason: unknown;
    try { reason = JSON.parse(result.stderr ?? '').error; } catch { /* Transport diagnostics can contain private data. */ }
    const publicReasons = [...stageSelectionRefusals, 'The enrolled service account or its runtime selection changed',
      'Recovery requires a different Linux boot on the same host', 'A protected preparation must be made during the recorded boot',
      'The registered host machine identity changed', 'The current machine fence differs from the reviewed legacy passive stage',
      'The protected pre-reboot preparation is absent', 'A completion record is present; use its own reconciliation protocol',
      'Machine deployment or execution guard is busy', 'The supervisor and enrolled account see different runtime registries',
      'The protected archive is invalid or belongs to another observation'];
    throw Error('The recipient refused the cold stage recovery. ' + (publicReasons.includes(reason as string)
      ? String(reason) : 'Check the administrative runtime, original stage records, managed services and protected journal.'));
  }
  let value: StageRecoveryReceipt;
  try { const reply = JSON.parse(result.stdout); if (reply?.ok !== true) throw Error(); value = reply.data; }
  catch { throw Error('Invalid cold stage recovery response'); }
  const selection = value?.selection;
  if (!value || value.recordId !== request.recordId || value.scope !== request.scope ||
      JSON.stringify(readNativeFence(value.observation)) !== JSON.stringify(observed) || !Number.isFinite(Date.parse(value.preparedAt)) ||
      !validStageSelection(selection) || !['prepared','interrupted'].includes(value.state) ||
      (request.action === 'finish' && value.state !== 'interrupted') || (value.state === 'interrupted') !== !!value.decision ||
      (value.decision && (value.decision.commandOutcome !== 'unknown' || !uuid(value.decision.bootId) ||
        value.decision.bootId === observed.bootId || !Number.isFinite(Date.parse(value.decision.acceptedAt)))))
    throw Error('Unconfirmed cold stage recovery receipt');
  return { recordId: value.recordId, scope: value.scope, observation: observed, state: value.state, preparedAt: value.preparedAt,
    selection: { uid: selection.uid, gid: selection.gid, homeSha256: selection.homeSha256, current: selection.current,
      revision: selection.revision, selectionSha256: selection.selectionSha256 },
    decision: value.decision && { bootId: value.decision.bootId, acceptedAt: value.decision.acceptedAt, commandOutcome: 'unknown' } };
}
