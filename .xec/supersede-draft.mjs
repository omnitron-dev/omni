import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireReleaseLock, assertCleanReleaseTree, assertReleaseHead, loadPreparedRelease, releaseCommand, releaseTag } from '@xec-sh/ops/release';

/** Preserve an unsubmitted local draft when the reviewed source needs another fix. */
export async function supersedeDraft(root, version, previousCheckout, run = releaseCommand) {
  const previous = await fs.realpath(previousCheckout);
  if (previous === await fs.realpath(root)) throw Error('Use the preserved checkout of the old draft');
  const sameRepository = async cwd => fs.realpath(path.resolve(cwd, await run(cwd, 'git', ['rev-parse', '--git-common-dir'])));
  if (await sameRepository(root) !== await sameRepository(previous)) throw Error('Draft must belong to the same Git repository');
  const unlock = await acquireReleaseLock(root), unlockPrevious = await acquireReleaseLock(previous).catch(async error => { await unlock(); throw error; });
  try {
    await assertCleanReleaseTree(root, run);
    await assertCleanReleaseTree(previous, run);
    const prepared = await loadPreparedRelease(previous, version, run);
    await run(root, 'git', ['merge-base', '--is-ancestor', prepared.commit, 'HEAD']);
    if (await run(root, 'git', ['rev-parse', 'HEAD']) === prepared.commit) throw Error('The draft is already on the current source');
    const archive = 'refs/release-attempts/' + version + '/' + prepared.commit;
    const ref = 'refs/tags/' + releaseTag(version);
    const tag = await assertReleaseHead(previous, version, run);
    if (!tag) {
      const saved = await run(root, 'git', ['rev-parse', archive + '^{commit}']);
      if (saved !== prepared.commit) throw Error('Archived draft differs');
      return { commit: prepared.commit, archived: archive };
    }
    const directory = path.join(previous, '.release-artifacts', version, prepared.commit);
    const journal = await fs.readFile(path.join(directory, 'publication.jsonl'), 'utf8')
      .catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
    if (journal.trim()) throw Error('The draft has publication receipts. Resume the same bytes or choose another version');
    if (await run(root, 'git', ['ls-remote', '--tags', 'origin', ref]))
      throw Error('The tag exists on origin; it must never be superseded');
    // Keep the exact annotated object and archives. No remote reference or npm version changes.
    const existing = await run(root, 'git', ['for-each-ref', '--format=%(objectname)', archive]);
    if (existing && existing !== tag) throw Error('Another object occupies the draft archive');
    if (!existing) await run(root, 'git', ['update-ref', archive, tag, '0'.repeat(tag.length)]);
    await run(root, 'git', ['update-ref', '-d', ref, tag]);
    return { commit: prepared.commit, archived: archive, artifacts: directory };
  } finally { await unlockPrevious(); await unlock(); }
}
