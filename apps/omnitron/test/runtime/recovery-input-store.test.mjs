import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, stat, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { stageInputs, verifyPrograms } from '../../data/operations/recovery-input-store.js';
import { digest, encoded } from '../../data/operations/recovery-observations.js';

function archive(entries) {
  const blocks = [];
  for (const { name, bytes = Buffer.alloc(0), type = 'File', linkpath } of entries) {
    const header = Buffer.alloc(512);
    new Header({ path: name, size: bytes.length, mode: 0o644, type, linkpath }).encode(header);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const runtime = { arch: 'x64', platform: 'linux' };
const code = Buffer.from('measured synthetic migration');
const closure = encoded({ protocol: 1, runtime });
const programs = [{ release: 'app/migrate.js', releaseSha256: digest(code) }];
const artifact = { packageSource: { migrations: { '001.sql': digest(code) }, migrationPrograms: programs }, closureSha256: digest(closure) };
const entries = [{ name: 'app/', type: 'Directory' }, { name: 'app/migrate.js', bytes: code }, { name: '.omnitron-closure.json', bytes: closure }];

test('streams the admitted program and runtime and refuses aliases, duplicate members, wrong digests and cancellation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-archive-'));
  try {
    const file = path.join(root, 'app.tgz');
    await writeFile(file, archive(entries));
    await verifyPrograms(file, artifact, runtime, new AbortController().signal);
    await assert.rejects(verifyPrograms(file, artifact, { ...runtime, arch: 'arm64' }, new AbortController().signal), /different runtime/);
    await assert.rejects(verifyPrograms(file, artifact, runtime, AbortSignal.abort()));
    await writeFile(file, gzipSync(archive(entries)));
    await assert.rejects(verifyPrograms(file, artifact, runtime, new AbortController().signal), /decompression ratio/);
    for (const [rows, error] of [
      [[entries[0], entries[1]], /Missing compiled/],
      [[...entries, entries[1]], /duplicate compiled/],
      [[{ name: 'app', type: 'SymbolicLink', linkpath: 'other' }, ...entries.slice(1)], /Non-directory/],
      [[entries[0], { name: entries[1].name, type: 'Link', linkpath: 'other' }, entries[2]], /Unsafe or duplicate/],
      [[...entries, { name: '../escape', bytes: code }], /Invalid relative/],
      [[entries[0], { ...entries[1], bytes: Buffer.from('changed') }, entries[2]], /Compiled entry differs/],
    ]) {
      await writeFile(file, archive(rows));
      await assert.rejects(verifyPrograms(file, artifact, runtime, new AbortController().signal), error);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux descriptor-bound staging checks real content, refuses directory and file aliases and releases its descriptors', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-stage-'));
  try {
    const home = path.join(root, 'home'), cas = path.join(home, '.omnitron/recovery-inputs');
    await mkdir(cas, { recursive: true, mode: 0o700 });
    async function retain(raw) { const hash = digest(raw); await writeFile(path.join(cas, hash), raw); return hash; }
    const blob = archive(entries), archiveHash = await retain(blob);
    const spec = { addedMigrations: ['002', '003'], probe: { sha256: await retain(Buffer.from('reviewed probe fixture')) } };
    for (const role of ['incumbent','candidate','recovery']) {
      const migrations = Object.fromEntries((role === 'incumbent' ? ['001'] : ['001',...spec.addedMigrations]).map(k => [k, digest(k)]));
      const id = role, commit = digest(id).slice(0, 40);
      const m = { id, project: { commit }, builtWith: { target: runtime }, migrations,
        artifacts: [{ ...artifact, app: 'ledger', bytes: blob.length, sha256: archiveHash }] };
      spec[role] = { id, commit, artifacts: { ledger: archiveHash }, manifestSha256: await retain(encoded(m)), staticsIndexSha256: null };
    }
    const run = async () => stageInputs(home, await mkdtemp(path.join(root, 'stage-')), spec, new AbortController().signal);
    const good = await run();
    assert.equal((await stat(good.probe)).mode & 0o777, 0o444);
    assert.deepEqual(await readFile(path.join(good.roles.recovery.root, 'artifacts/ledger.tgz')), blob);
    await rename(cas, cas + '-actual');
    await symlink(cas + '-actual', cas);
    await assert.rejects(run, { code: 'ENOTDIR' });
    await rm(cas);
    await rename(cas + '-actual', cas);
    const file = path.join(cas, spec.probe.sha256);
    await rename(file, file + '-actual');
    await symlink(file + '-actual', file);
    await assert.rejects(run, { code: 'ELOOP' });
    await rm(file);
    await writeFile(file, Buffer.from('different'));
    await assert.rejects(run, /admitted bytes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
