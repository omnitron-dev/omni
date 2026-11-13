import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';
import { withKernelFileLock } from '../apps/omnitron/src/shared/kernel-file-lock.ts';

const { readPrivateRecord, writePrivateRecord } = await tsImport('../apps/omnitron/src/daemon/execution-journal.ts', import.meta.url);

const hash = /^[a-f0-9]{64}$/;
const finished = new Set(['accepted', 'rolled-back']);

function planDigest(plan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export async function localSyncStatus(directory) {
  const receipt = await readPrivateRecord(path.join(directory, 'current.json'));
  if (receipt && (!hash.test(receipt.digest) || receipt.digest !== planDigest(receipt.plan)))
    throw Error('The local update receipt does not match its reviewed plan');
  return receipt;
}

/** Persist intent before each native operation. After interruption, only explicit recovery may retire an owner. */
export async function runLocalSync({ actions, directory, review, rollback = false, status = false, progress = () => {} }) {
  if (status) return localSyncStatus(directory);
  if ((review !== undefined && !hash.test(review)) || (rollback && !review)) throw Error('Use the full SHA-256 of the local update plan');
  await fs.mkdir(directory, { mode: 0o700, recursive: true });
  return withKernelFileLock(path.join(directory, 'update.lock'), async () => {
    let record = await localSyncStatus(directory);
    const save = async (phase, details = {}) => {
      const next = { ...record, ...details, phase, updatedAt: new Date().toISOString() };
      await writePrivateRecord(path.join(directory, 'current.json'), next);
      record = next;
      progress(phase);
      return next;
    };
    const recover = async () => {
      const plan = record.plan;
      try {
        // A failure before the old operator relinquished the host is not permission to stop it again.
        if (!(await actions.canRestore(record.rollbackOwner ?? plan.before))) {
          const live = await actions.captureForRollback(plan);
          await actions.validateStop(live);
          await save('stopping-candidate', { rollbackOwner: live });
          await actions.stop(live);
          await actions.assertStopped(live);
        }
        await save('restoring');
        await actions.start(plan.before, plan);
        const acceptance = await actions.accept(plan, 'previous');
        return await save('rolled-back', { acceptance });
      } catch (error) {
        await save('recovery-required', { recoveryError: error.message });
        throw Error('Local recovery requires inspection: ' + error.message, { cause: error });
      }
    };
    if (rollback) {
      if (record?.digest !== review) throw Error('The requested local update is not the current receipt');
      if (record.phase === 'rolled-back') { await actions.accept(record.plan, 'previous', true); return record; }
      return recover();
    }
    if (record && !finished.has(record.phase)) throw Error('A local update is unfinished (' + record.phase + '). Inspect its status and recover its exact plan ' + record.digest);
    if (record?.phase === 'accepted' && review === record.digest) {
      await actions.accept(record.plan, 'target', true);
      return record;
    }
    if (review && record?.phase === 'rolled-back' && review === record.digest) throw Error('This attempt was rolled back. Prepare a fresh plan');
    const plan = await actions.prepare();
    if (!review && record?.phase === 'accepted' && record.plan.target.artifact === plan.target.artifact &&
      plan.before.backend === plan.target.artifact && plan.before.owner === plan.target.artifact && plan.before.guardian === plan.target.artifact) {
      // An operator can request a fresh review by preparing a changed inventory. An availability error cannot authorize another restart.
      const declarations = snapshot => snapshot.stacks.map(({ project, stack, enabled, startReview, selection, savedSelection }) => [project, stack, enabled, startReview, selection, savedSelection]);
      if (JSON.stringify(declarations(plan)) === JSON.stringify(declarations(record.plan)) &&
          JSON.stringify(plan.excluded) === JSON.stringify(record.plan.excluded)) {
        await actions.accept(record.plan, 'target', true); return record;
      }
    }
    const digest = planDigest(plan);
    if (!review) return { digest, plan };
    if (review !== digest) throw Error('Local placement, roles, launch selection, infrastructure or process identities changed. Inspect the current plan ' + digest);
    // Admission can refuse while the original installation is still serving.
    // Record shutdown intent only after these read-only checks have succeeded.
    await actions.validateStop(plan.before, plan);
    if (record) await writePrivateRecord(path.join(directory, record.digest + '.json'), record);
    record = { protocol: 1, digest, plan };
    await save('stopping');
    try {
      await actions.stop(plan.before);
      await actions.assertStopped(plan.before);
      await save('starting');
      await actions.start(plan.target, plan);
      await save('verifying');
      const acceptance = await actions.accept(plan, 'target');
      return await save('accepted', { acceptance });
    } catch (error) {
      await save('failed', { error: error.message });
      const result = await recover();
      throw Error('Local update failed and was ' + result.phase + ': ' + error.message, { cause: error });
    }
  }, 0);
}
