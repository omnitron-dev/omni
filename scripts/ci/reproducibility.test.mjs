import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { preserveReproducibilityFailure, sdkDifferences } from '../lib/reproducibility-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = (filename, contents, files) => ({ name: '@omnitron-dev/example', version: '1.0.0', filename,
  sha256: hash(contents), files });
const file = (contents, executable = false) => ({ digest: hash(contents), size: Buffer.byteLength(contents), executable });

test('distinguishes changed archive bytes from changed files without weakening either digest', () => {
  const a = entry('one.tgz', 'compressed-one', { 'index.js': file('same source') });
  const b = entry('two.tgz', 'compressed-two', { 'index.js': file('same source') });
  assert.deepEqual(sdkDifferences([a], [a]), { packages: 0, files: 0, differences: [], omittedPackages: 0 });
  const result = sdkDifferences([a], [b]);
  assert.equal(result.packages, 1);
  assert.equal(result.files, 0);
  assert.equal(result.differences[0].first.sha256, a.sha256);
  assert.equal(result.differences[0].second.sha256, b.sha256);
  assert.notEqual(result.differences[0].first.sha256, result.differences[0].second.sha256);
});

test('reports byte, executable and path changes even when file and package counts match', () => {
  const first = entry('one.tgz', 'one', { 'index.js': file('old'), 'cli.js': file('cli', true), 'old.js': file('rename') });
  const second = entry('two.tgz', 'two', { 'index.js': file('new'), 'cli.js': file('cli'), 'new.js': file('rename') });
  const result = sdkDifferences([first], [second]);
  assert.equal(result.files, 4);
  assert.deepEqual(result.differences[0].differences.map(item => item.file), ['cli.js', 'index.js', 'new.js', 'old.js']);
  assert.equal(result.differences[0].differences[0].first.executable, true);
  assert.equal(result.differences[0].differences[0].second.executable, false);
  assert.equal(result.differences[0].differences[2].first, null);
  assert.equal(result.differences[0].differences[3].second, null);
});

test('bounds diagnostics while retaining exact total differences', () => {
  const files = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['file-' + i, file('content')]));
  const entries = Array.from({ length: 70 }, (_, i) => ({ ...entry('package.tgz', 'archive', files), name: '@omnitron-dev/p' + i }));
  const result = sdkDifferences(entries, []);
  assert.equal(result.packages, 70);
  assert.equal(result.files, 21_000);
  assert.equal(result.differences.length, 64);
  assert.equal(result.omittedPackages, 6);
  assert.equal(result.differences.flatMap(item => item.differences).length, 256);
});

test('treats package file names as data rather than inherited object properties', () => {
  const a = entry('one.tgz', 'one', Object.fromEntries([['__proto__', file('content')]]));
  const b = entry('two.tgz', 'two', {});
  const result = sdkDifferences([a], [b]);
  assert.equal(result.files, 1);
  assert.equal(result.differences[0].differences[0].file, '__proto__');
  assert.equal(result.differences[0].differences[0].second, null);
});

test('retains both affected archives and a bounded receipt after original build trees are removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repro-evidence-'));
  try {
    const first = path.join(root, 'first'), second = path.join(root, 'second'), diagnostics = path.join(root, 'evidence');
    for (const dir of [first, second, diagnostics]) await fs.mkdir(dir);
    const a = entry('first.tgz', 'archive one', { 'index.js': file('one') });
    const b = entry('second.tgz', 'archive two', { 'index.js': file('two') });
    await fs.writeFile(path.join(first, a.filename), 'archive one');
    await fs.writeFile(path.join(second, b.filename), 'archive two');
    await fs.writeFile(path.join(first, 'framework-manifest.json'), '["original first manifest"]\n');
    await fs.writeFile(path.join(second, 'framework-manifest.json'), '["original second manifest"]\n');
    const evidence = { revision: 'a'.repeat(40), node: process.version,
      first: { result: { sdk: { manifestSha256: 'first' } }, sdkInventory: [a] },
      second: { result: { sdk: { manifestSha256: 'second' } }, sdkInventory: [b] } };
    const report = await preserveReproducibilityFailure(diagnostics, evidence, { first, second });
    assert.equal(evidence.first.sdkInventory.length, 1, 'diagnosis must not mutate the measured inventories');
    await fs.rm(first, { recursive: true }); await fs.rm(second, { recursive: true });
    assert.equal(await fs.readFile(path.join(diagnostics, 'first', a.filename), 'utf8'), 'archive one');
    assert.equal(await fs.readFile(path.join(diagnostics, 'second', b.filename), 'utf8'), 'archive two');
    assert.equal(await fs.readFile(path.join(diagnostics, 'first-framework-manifest.json'), 'utf8'), '["original first manifest"]\n');
    assert.equal(await fs.readFile(path.join(diagnostics, 'second-framework-manifest.json'), 'utf8'), '["original second manifest"]\n');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(diagnostics, 'failure.json'), 'utf8')), report);
    assert.equal(report.archives.filter(item => item.retained).length, 2);
    assert.equal(report.first.sdkInventory, undefined);
    await assert.rejects(preserveReproducibilityFailure(diagnostics, evidence, { first: path.join(diagnostics, 'first'), second: path.join(diagnostics, 'second') }), /EEXIST/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('does not upload an oversized archive or follow a substituted archive link', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repro-evidence-'));
  try {
    const diagnostics = path.join(root, 'evidence'); await fs.mkdir(diagnostics);
    const pkg = entry('large.tgz', 'large', { 'index.js': file('source') });
    const handle = await fs.open(path.join(root, pkg.filename), 'wx');
    try { await handle.truncate(256 * 1024 * 1024 + 1); } finally { await handle.close(); }
    const evidence = { first: { sdkInventory: [pkg] } };
    const report = await preserveReproducibilityFailure(diagnostics, evidence, { first: root });
    assert.equal(report.archiveBytes, 0);
    assert.equal(report.archives[0].retained, false);
    assert.equal(report.archives[0].reason, 'archive byte limit');
    await fs.rm(path.join(root, pkg.filename));
    await fs.symlink('evidence/failure.json', path.join(root, pkg.filename));
    await assert.rejects(preserveReproducibilityFailure(diagnostics, evidence, { first: root }), /not a regular file/);
    await assert.rejects(preserveReproducibilityFailure(diagnostics,
      { first: { sdkInventory: [{ ...pkg, filename: '../escape.tgz' }] } }, { first: root }), /Invalid SDK diagnostic archive path/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
