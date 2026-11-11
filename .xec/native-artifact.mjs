/** Run by Xec on the native CI runner only after the transition/rollback tests. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [runtime, destination] = globalThis.args ?? process.argv.slice(2);
if (!runtime || !destination) throw Error('Expected a sealed runtime and new artifact directory');
const load = file => import(pathToFileURL(path.join(runtime, 'packages/0/dist', file)).href);
const { verifyRuntimeArtifact } = await load('shared/runtime-artifact.js');
const { writePortableArchive } = await load('release/portable-archive.js');
const manifest = await verifyRuntimeArtifact(runtime);
const stamp = JSON.parse(await fs.readFile(path.join(runtime, 'packages/0/dist/BUILD.json')));
const commit = process.env.CANDIDATE, previous = process.env.PREVIOUS;
const runId = Number(process.env.GITHUB_RUN_ID), attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[a-f0-9]{40}$/.test(previous ?? '') ||
    stamp.commit !== commit || stamp.dirty || manifest.platform !== 'linux' ||
    manifest.nodeVersion !== 'v' + process.env.TARGET_NODE || !Number.isSafeInteger(runId) || runId < 1 ||
    !Number.isSafeInteger(attempt) || attempt < 1) throw Error('Native artifact identity differs from the qualified run');
await fs.mkdir(destination, { mode: 0o700 });
const archive = path.join(destination, 'runtime.tgz');
await writePortableArchive(runtime, archive, { preserveExecutableBits: true });
const digest = createHash('sha256');
for await (const chunk of createReadStream(archive)) digest.update(chunk);
await fs.writeFile(path.join(destination, 'NATIVE.json'), JSON.stringify({
  schema: 1, commit, previous, runId, attempt, node: manifest.nodeVersion,
  runtime: manifest.sha256, platform: manifest.platform, arch: manifest.arch,
  archive: digest.digest('hex'), bytes: (await fs.stat(archive)).size,
}, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
