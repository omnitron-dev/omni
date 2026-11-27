import type { StageSelection } from './dto/nodes.js';

const digest = /^[a-f0-9]{64}$/;

export function validStageSelection(v: Partial<StageSelection> | undefined): v is StageSelection {
  return !!v && Number.isSafeInteger(v.uid) && v.uid! >= 0 && Number.isSafeInteger(v.gid) && v.gid! >= 0 &&
    digest.test(v.homeSha256 ?? '') && digest.test(v.current ?? '') && digest.test(v.selectionSha256 ?? '') &&
    Number.isSafeInteger(v.revision) && v.revision! > 0;
}
