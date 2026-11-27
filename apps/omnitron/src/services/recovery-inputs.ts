import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, open, readFile, realpath, statfs, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { loadRelease } from '../release/load.js';
import { stableJson } from '../shared/canonical-json.js';
import type { PipelineDef } from '../shared/dto/pipelines.js';
import { readRecoveryQualificationProbe, readRecoveryQualificationRelease, readRecoveryStaticIndex,
  recoveryProbePath, installedRecoveryCommand } from './recovery-qualification.js';

const exec = promisify(execFile);
const limit = 8 * 1024 ** 3;
const reserve = 1024 ** 3;

async function sumFile(file: string) {
  const hash = createHash('sha256');
  const fd = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    if (!(await fd.stat()).isFile()) throw Error('QA input is not a physical regular file');
    for await (const chunk of fd.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally { await fd.close(); }
}

/** Prepare QA-local immutable inputs for the controller's independently reconstructed graph. */
export async function stageRecoveryInputs(definitionFile: string, store: string, source: string) {
  const def = JSON.parse(await readFile(definitionFile, 'utf8')) as PipelineDef;
  const step = def.steps?.[0];
  if (def.steps?.length !== 1 || step?.name !== 'qualify-recovery' || step?.kind !== 'shell' || typeof step.run !== 'string')
    throw Error('Expected the exact Pipeline definition emitted by the controller');
  const { spec } = await installedRecoveryCommand(step);
  const roles = ['incumbent', 'candidate', 'recovery'] as const;
  const releases = await Promise.all(roles.map(async role => {
    const loaded = await loadRelease(spec[role].id, store);
    if (!isDeepStrictEqual(await readRecoveryQualificationRelease(loaded, source), spec[role]))
      throw Error('Local issuer release differs from qualification plan: ' + role);
    return loaded;
  }));
  const probe = await readRecoveryQualificationProbe(source, spec.candidate.commit, spec.probe.commit);
  if (!isDeepStrictEqual(probe, spec.probe)) throw Error('Committed probe or policy differs from the qualification plan');
  const root = path.join(os.homedir(), '.omnitron', 'recovery-inputs');
  for (const dir of [path.dirname(root), root]) {
    await mkdir(dir, { mode: 0o700, recursive: true });
    const st = await lstat(dir);
    if (!st.isDirectory() || await realpath(dir) !== dir || st.uid !== process.getuid?.() || (st.mode & 0o022))
      throw Error('QA input storage is not a physical, privately controlled directory');
  }
  const seen = new Set<string>();
  let bytes = 0;
  const retain = async (sha: string, input: Buffer | string) => {
    if (seen.has(sha)) return;
    if (!/^[0-9a-f]{64}$/.test(sha)) throw Error('Invalid QA archive digest');
    const size = Buffer.isBuffer(input) ? input.length : (await lstat(input)).size;
    bytes += size;
    if (size > reserve || bytes > limit) throw Error('QA input set exceeds its size budget');
    const dest = path.join(root, sha);
    const st = await lstat(dest).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (st) {
      if (!st.isFile() || st.size !== size || await sumFile(dest) !== sha) throw Error('Existing QA input is damaged: ' + sha);
    } else {
      const fs = await statfs(root);
      if (fs.bavail * fs.bsize < size + reserve) throw Error('Insufficient free space on QA node');
      const part = path.join(root, '.stage-' + randomUUID());
      try {
        if (Buffer.isBuffer(input)) await writeFile(part, input, { mode: 0o600, flag: 'wx' });
        else await copyFile(input, part, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        if (await sumFile(part) !== sha) throw Error('Input changed during staging');
        await chmod(part, 0o400);
        try { await link(part, dest); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await sumFile(dest) !== sha) throw error;
        }
      } finally { await unlink(part).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    seen.add(sha);
  };
  const { stdout } = await exec('git', ['--no-replace-objects', 'show', spec.probe.commit + ':' + recoveryProbePath],
    { cwd: source, encoding: 'buffer', maxBuffer: 256 * 1024 });
  await retain(probe.sha256, stdout);
  for (const [i, release] of releases.entries()) {
    await retain(release.manifestSha256, path.join(release.root, 'manifest.json'));
    for (const file of release.files) await retain(file.sha256, file.path);
    if (!release.staticsDir) continue;
    const { index } = await readRecoveryStaticIndex(release.staticsDir);
    await retain(spec[roles[i]!].staticsIndexSha256!, Buffer.from(stableJson(index)));
    for (const [name, entry] of Object.entries(index)) await retain(entry.sha256, path.join(release.staticsDir, name));
  }
  return { root, files: seen.size, bytes };
}
