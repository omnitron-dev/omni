/** Reuse scenario evidence only when a fresh publication differs in exact version metadata. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const CORE = '@omnitron-dev/omnitron';
const PUBLIC_PACKAGES = 35;
const CONTROL_FILES = [
  '.xec/release.mjs', '.xec/qualification.mjs', '.xec/version-qualification.js', '.xec/release-registry.js',
  'scripts/ci/version-qualification.test.mjs', 'scripts/ci/release-registry.test.mjs',
  'scripts/ci/release.test.mjs', 'scripts/ci/xec-qualification.test.mjs',
];
const STAMPS = new Set(['dist/BUILD.json', 'webapp/dist/BUILD.json']);
const DEPENDENCIES = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function git(root, args, signal, binary = false) {
  return (await execute('git', args, { cwd: root, signal, encoding: binary ? null : 'utf8',
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

async function tree(root, commit, signal) {
  const records = (await git(root, ['ls-tree', '-r', '-z', '--full-tree', commit], signal)).split('\0').filter(Boolean);
  return new Map(records.map(record => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(record);
    if (!match) throw Error('Invalid Git tree record');
    return [match[4], { mode: match[1], type: match[2], object: match[3] }];
  }));
}

async function sourceEquivalence(root, baseCommit, commit, oldVersion, version, signal) {
  await git(root, ['merge-base', '--is-ancestor', baseCommit, commit], signal);
  const [base, candidate] = await Promise.all([tree(root, baseCommit, signal), tree(root, commit, signal)]);
  const packages = new Map();
  const versionPaths = new Set();
  for (const [file, record] of base) {
    if (!/^(apps|packages)\/[^/]+\/package\.json$/.test(file)) continue;
    if (record.type !== 'blob' || record.mode !== '100644') throw Error('Workspace manifest must be a regular file');
    const original = JSON.parse(await git(root, ['show', baseCommit + ':' + file], signal));
    if (original.private === true) continue;
    if (typeof original.name !== 'string' || !original.name.startsWith('@omnitron-dev/') ||
        original.version !== oldVersion || packages.has(original.name)) throw Error('Invalid base public package inventory');
    const nextRecord = candidate.get(file);
    if (nextRecord?.type !== 'blob' || nextRecord.mode !== record.mode) throw Error('Public package path or mode changed: ' + file);
    const next = JSON.parse(await git(root, ['show', commit + ':' + file], signal));
    if (JSON.stringify(next) !== JSON.stringify({ ...original, version })) throw Error('Only the public package version may change: ' + file);
    packages.set(original.name, { file, manifest: original });
    versionPaths.add(file);
  }
  if (packages.size !== PUBLIC_PACKAGES || !packages.has(CORE)) throw Error('Expected the complete 35-package public SDK');
  const controls = [];
  for (const file of new Set([...base.keys(), ...candidate.keys()])) {
    const before = base.get(file), after = candidate.get(file);
    if (isDeepStrictEqual(before, after) || versionPaths.has(file)) continue;
    if (!CONTROL_FILES.includes(file) || after?.type !== 'blob' || after.mode !== '100644' ||
        (before && (before.type !== 'blob' || before.mode !== '100644'))) throw Error('Non-version source change: ' + file);
  }
  for (const file of CONTROL_FILES) {
    const digest = async (inventory, revision) => inventory.has(file)
      ? sha256(await git(root, ['show', revision + ':' + file], signal, true)) : null;
    controls.push({ file, baseSha256: await digest(base, baseCommit), candidateSha256: await digest(candidate, commit) });
  }
  const epoch = async revision => {
    const value = (await git(root, ['show', '-s', '--format=%ct', revision], signal)).trim();
    if (!/^\d{1,12}$/.test(value)) throw Error('Invalid source timestamp');
    return new Date(Number(value) * 1000).toISOString();
  };
  return { packages, controls, baseTime: await epoch(baseCommit), candidateTime: await epoch(commit),
    baseTree: (await git(root, ['rev-parse', baseCommit + '^{tree}'], signal)).trim(),
    candidateTree: (await git(root, ['rev-parse', commit + '^{tree}'], signal)).trim() };
}

function archiveInventory(artifacts, version, names) {
  const result = new Map();
  if (!Array.isArray(artifacts)) throw Error('Missing prepared archive inventory');
  for (const item of artifacts) {
    if (!names.has(item.name) || item.version !== version || result.has(item.name) ||
        typeof item.file !== 'string' || !path.isAbsolute(item.file) ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity ?? '')) throw Error('Invalid prepared archive inventory');
    result.set(item.name, item);
  }
  if (result.size !== names.size) throw Error('Prepared archives do not cover the public SDK');
  return result;
}

function expectedManifest(original, source, names, oldVersion, version, commit) {
  const expected = { ...original, version, gitHead: commit };
  for (const field of DEPENDENCIES) {
    if (!original[field]) continue;
    const entries = { ...original[field] };
    for (const name of Object.keys(entries)) {
      if (!names.has(name)) continue;
      if (source[field]?.[name] !== 'workspace:*' || entries[name] !== oldVersion)
        throw Error('Internal dependency is not the unchanged canonical workspace range: ' + name);
      entries[name] = version;
    }
    expected[field] = sorted(entries);
  }
  return expected;
}

function normalizedManifest(value) {
  const result = { ...value };
  for (const field of [...DEPENDENCIES, 'peerDependenciesMeta']) if (result[field]) result[field] = sorted(result[field]);
  return result;
}

async function stamp(archive, file, commit, builtAt, parseBuildStamp, signal) {
  // The complete archive has already passed the canonical bounded inspector.
  // Read only this known metadata member; no extraction or new archive parser.
  const output = await execute('tar', ['-xOf', archive, 'package/' + file], {
    signal, timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  const value = JSON.parse(output.stdout);
  const expected = { commit, dirty: false, builtAt, timeBasis: 'source' };
  if (!parseBuildStamp(value) || !isDeepStrictEqual(value, expected)) throw Error('Build stamp is not exact source metadata: ' + file);
  return value;
}

async function evidence(root, version, { baseCommit, prepared, verifyBase, signal }) {
  if (!VERSION.test(version) || !SHA.test(baseCommit ?? '') || typeof verifyBase !== 'function')
    throw Error('Version qualification requires a version, exact base commit and canonical base verifier');
  const commit = (await git(root, ['rev-parse', 'HEAD'], signal)).trim();
  if (!SHA.test(commit) || commit === baseCommit || (await git(root, ['status', '--porcelain'], signal)).trim())
    throw Error('Version qualification requires a clean different candidate commit');
  if (prepared?.commit !== commit || prepared.version !== version) throw Error('Prepared release differs from candidate HEAD');
  // This callback re-observes the existing canonical qualification, including CI
  // and native receipts. No green stage is synthesized or attributed to HEAD.
  const base = await verifyBase(baseCommit);
  if (base?.commit !== baseCommit || !VERSION.test(base.version ?? '') || base.version === version ||
      !path.isAbsolute(base.runtime ?? '') || !path.isAbsolute(base.receipt ?? '')) throw Error('Canonical base qualification differs');
  const source = await sourceEquivalence(root, baseCommit, commit, base.version, version, signal);
  const oldArchives = archiveInventory(base.artifacts, base.version, source.packages);
  const newArchives = archiveInventory(prepared.artifacts, version, source.packages);
  const load = file => import(pathToFileURL(path.join(base.runtime, 'packages/0/dist', file)).href);
  const [{ inspectFrameworkArchive }, { parseBuildStamp }] = await Promise.all([
    load('release/registry-framework.js'), load('shared/build-stamp.js'),
  ]);
  const compared = [];
  for (const name of [...source.packages.keys()].sort()) {
    signal?.throwIfAborted();
    const before = oldArchives.get(name), after = newArchives.get(name);
    const old = await inspectFrameworkArchive(before, createReadStream(before.file), signal);
    const next = await inspectFrameworkArchive(after, createReadStream(after.file), signal);
    if (old.commit !== baseCommit || next.commit !== commit || old.metadata.gitHead !== baseCommit || next.metadata.gitHead !== commit)
      throw Error('Archive source identity differs: ' + name);
    const expected = expectedManifest(old.metadata, source.packages.get(name).manifest,
      source.packages, base.version, version, commit);
    if (JSON.stringify(normalizedManifest(next.metadata)) !== JSON.stringify(normalizedManifest(expected)))
      throw Error('Archive metadata changed beyond publication version fields: ' + name);
    if (old.files.size !== next.files.size) throw Error('Archive file inventory differs: ' + name);
    const files = [];
    for (const [file, original] of [...old.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const candidate = next.files.get(file);
      if (!candidate || candidate.executable !== original.executable) throw Error('Archive path or executable mode differs: ' + name + '/' + file);
      if (file === 'package.json') {
        // Its complete semantic comparison above permits only derived fields.
      } else if (name === CORE && STAMPS.has(file)) {
        await stamp(before.file, file, baseCommit, source.baseTime, parseBuildStamp, signal);
        await stamp(after.file, file, commit, source.candidateTime, parseBuildStamp, signal);
      } else if (candidate.digest !== original.digest || candidate.size !== original.size) {
        throw Error('Archive executable/content bytes differ: ' + name + '/' + file);
      }
      files.push({ file, base: original, candidate });
    }
    compared.push({ name, baseVersion: base.version, version, baseIntegrity: before.integrity,
      integrity: after.integrity, files });
  }
  if ((await git(root, ['rev-parse', 'HEAD'], signal)).trim() !== commit || (await git(root, ['status', '--porcelain'], signal)).trim())
    throw Error('Candidate source changed during version qualification');
  const runtime = await json(path.join(base.runtime, 'RUNTIME.json'));
  if (!/^[a-f0-9]{64}$/.test(runtime.sha256 ?? '')) throw Error('Invalid verified base runtime digest');
  return { schema: 1, kind: 'version-only', commit, version, baseCommit, baseVersion: base.version,
    scenariosAttestedOn: baseCommit,
    baseQualification: { receipt: await fs.realpath(base.receipt), sha256: sha256(await fs.readFile(base.receipt)), runtime: runtime.sha256 },
    sourceEquivalence: { baseTree: source.baseTree, candidateTree: source.candidateTree,
      packages: [...source.packages].map(([name, item]) => ({ name, file: item.file })), controlFiles: source.controls },
    archiveEquivalence: compared };
}

function receiptPath(root, commit) {
  return path.join(root, '.release-artifacts/qualification', commit, 'version-only.json');
}

/** The caller already completed ordinary clean preparation and consumer verification. */
export async function prepareVersionQualification(root, version, options) {
  const proof = await evidence(root, version, options);
  const receipt = receiptPath(root, proof.commit);
  try {
    assert.deepEqual(await json(receipt), proof, 'Existing version qualification differs');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(path.dirname(receipt), { recursive: true, mode: 0o700 });
    const temporary = receipt + '.' + randomUUID();
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(proof, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    try { await fs.link(temporary, receipt); }
    finally { await fs.rm(temporary, { force: true }); }
    const directory = await fs.open(path.dirname(receipt), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  return { ...proof, receipt };
}

/** Rechecks the base, exact Git delta and every current archive byte; never writes. */
export async function verifyVersionQualification(root, version, options) {
  const proof = await evidence(root, version, options);
  const receipt = receiptPath(root, proof.commit);
  assert.deepEqual(await json(receipt), proof, 'Version qualification evidence changed');
  return { ...proof, receipt };
}
