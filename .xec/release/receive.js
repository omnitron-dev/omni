import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { releaseCommand } from '@xec-sh/ops/release';
import { githubQualification } from '../github-qualification.mjs';
import policy from '../release-policy.mjs';
import { verifyPublicationPreparation } from './build.js';

/** Called under Xec's release lock. A retry can adopt only the same sealed batch. */
export async function receivePreparation(root, plan, runId, run = releaseCommand) {
  const { version, commit, packages } = plan;
  assert.ok(packages.every(pkg => pkg.version === version), 'First commit all release versions');
  const parent = path.join(root, '.release-artifacts', version);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const target = path.join(parent, commit);
  const staging = await fs.mkdtemp(path.join(parent, '.receive-'));
  const files = ['release.json', 'producer.json', 'PREPARATION.json', 'NOTES.md',
    ...packages.map(pkg => encodeURIComponent(pkg.name) + '.tgz')].sort();
  let installed = false;
  try {
    await githubQualification({ root, policy, run }).downloadPreparation(plan, runId, staging);
    const entries = await fs.readdir(staging, { withFileTypes: true });
    assert.ok(entries.every(entry => entry.isFile()), 'Preparation contains a nonregular file');
    assert.deepEqual(entries.map(entry => entry.name).sort(), files, 'Preparation file inventory differs');
    const prior = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (prior) {
      assert.ok(prior.isDirectory(), 'Existing release batch must be a directory');
      for (const name of files) {
        const existing = path.join(target, name);
        assert.ok((await fs.lstat(existing)).isFile(), 'Existing preparation contains a nonregular file');
        assert.ok((await fs.readFile(existing)).equals(await fs.readFile(path.join(staging, name))), 'Existing preparation differs: ' + name);
      }
    } else {
      for (const name of files) await fs.chmod(path.join(staging, name), name.endsWith('.tgz') ? 0o444 : 0o600);
      await fs.rename(staging, target);
      installed = true;
    }
    return await verifyPublicationPreparation(root, version, run);
  } catch (error) {
    if (installed) await fs.rename(target, staging);
    throw error;
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
