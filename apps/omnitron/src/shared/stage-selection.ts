import type { StageSelection } from './dto/nodes.js';

const digest = /^[a-f0-9]{64}$/;

// Only these fixed descriptions may cross the child IPC and Fleet transport.
export const stageSelectionChecks = {
  runtime: 'Could not load the administrative runtime for service selection',
  account: 'Could not enter the enrolled service account',
  supervisor: 'Could not read the enrolled supervision record',
  processes: 'Could not verify the supervised process identities and executables',
  registry: 'Could not open the enrolled service runtime registry',
  lease: 'Could not confirm the runtime selection under its installation lease',
} as const;
export const stageSelectionRefusals: readonly string[] = [
  ...Object.values(stageSelectionChecks),
  'The runtime registry has an unsettled activation', 'The runtime registry has an unrelated installation lease',
  'An earlier stage selection holder is still live or unverifiable', 'The enrolled service account has no selected runtime',
];

export function validStageSelection(v: Partial<StageSelection> | undefined): v is StageSelection {
  return !!v && Number.isSafeInteger(v.uid) && v.uid! >= 0 && Number.isSafeInteger(v.gid) && v.gid! >= 0 &&
    digest.test(v.homeSha256 ?? '') && digest.test(v.current ?? '') && digest.test(v.selectionSha256 ?? '') &&
    Number.isSafeInteger(v.revision) && v.revision! > 0;
}
