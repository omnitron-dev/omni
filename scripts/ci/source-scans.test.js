import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';
import { runSourceScans } from '../../.xec/commands/check-scans.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const actor = "import { completeScan } from './lib/scan-receipt.js';\n";
const worklists = ['destructive-sites', 'a-build-older-than-its-source'];
const xec = path.join(repo, 'node_modules/@xec-sh/cli/bin/xec');

async function write(root, name, body) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return file;
}

async function installationSnapshot(modules = path.join(repo, 'node_modules')) {
  const metadata = (await fs.readdir(modules)).filter(name =>
    name === '.modules.yaml' || /^\.pnpm-workspace-state(?:-v\d+)?\.json$/.test(name));
  const shims = (await fs.readdir(path.join(modules, '.bin'))).map(name => '.bin/' + name);
  const state = {};
  for (const file of [...metadata, ...shims].sort()) {
    const target = path.join(modules, file);
    const stat = await fs.lstat(target);
    const link = stat.isSymbolicLink() ? await fs.readlink(target) : null;
    let sha256 = null;
    try {
      sha256 = createHash('sha256').update(await fs.readFile(target)).digest('hex');
    } catch (error) {
      // A workspace executable can point at dist before the first build.
      if (link === null || error.code !== 'ENOENT') throw error;
    }
    state[file] = { link, mode: stat.mode & 0o777, sha256 };
  }
  async function links(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) state[path.relative(modules, target)] = await fs.readlink(target);
      else if (directory === modules && entry.isDirectory() && entry.name.startsWith('@')) await links(target);
    }
  }
  await links(modules);
  return state;
}

test('installation snapshots distinguish an unbuilt workspace executable from a retargeted link or a new build', async t => {
  const modules = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-installation-'));
  t.after(() => fs.rm(modules, { recursive: true, force: true }));
  const bin = path.join(modules, '.bin');
  await fs.mkdir(bin);
  const shim = path.join(bin, 'example');
  await fs.symlink('../dist/one.js', shim);
  const unbuilt = await installationSnapshot(modules);
  assert.equal(unbuilt['.bin/example'].link, '../dist/one.js');
  assert.equal(unbuilt['.bin/example'].sha256, null);
  await fs.unlink(shim);
  await fs.symlink('../dist/two.js', shim);
  const retargeted = await installationSnapshot(modules);
  assert.notDeepEqual(retargeted, unbuilt);
  await write(modules, 'dist/two.js', 'export {};');
  const built = await installationSnapshot(modules);
  assert.notDeepEqual(built, retargeted);
  await write(modules, '.pnpm-workspace-state-v1.json', '{}');
  assert.notDeepEqual(await installationSnapshot(modules), built);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-report-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of ['.xec/commands/check-scans.js', '.xec/config.yaml', 'scripts/lib/scan-receipt.js', 'scripts/lib/strip-comments.mjs']) {
    await write(root, file, await fs.readFile(path.join(repo, file)));
  }
  await write(root, 'package.json', JSON.stringify({ type: 'module' }));
  // Load the installed Pipeline API. The fixture owns every directory, including node_modules.
  await write(root, 'node_modules/@xec-sh/ops/package.json', JSON.stringify({ type: 'module', exports: { './pipeline': './pipeline.js' } }));
  await write(root, 'node_modules/@xec-sh/ops/pipeline.js', 'export { Pipeline } from ' + JSON.stringify(import.meta.resolve('@xec-sh/ops/pipeline')) + ';\n');
  for (const name of (await fs.readdir(path.join(repo, 'scripts'))).filter(name => name.endsWith('.mjs'))) {
    const file = 'scripts/' + name;
    await write(root, file, worklists.includes(path.basename(name, '.mjs')) ? await fs.readFile(path.join(repo, file))
      : actor + "completeScan(import.meta.url, 'complete', { checked: 1 });\n");
  }
  await write(root, 'apps/omnitron/src/commands/daemon-cmd.ts', "export function daemonKill() {\n  fs.unlinkSync(socket);\n}\n");
  await write(root, 'apps/omnitron/src/example.ts', "export function removeExample() {\n  db.deleteFrom('demo');\n}\n");
  for (const [name, source, built] of [['current', 100, 200], ['older', 300, 100], ['unbuilt', 100], ['no-src']]) {
    await write(root, 'packages/' + name + '/package.json', '{}');
    for (const [dir, time] of [['src', source], ['dist', built]]) {
      if (time) await fs.utimes(await write(root, 'packages/' + name + '/' + dir + '/index.js', ''), time, time);
    }
  }
  for (const args of [['init', '-q'], ['add', 'apps']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  }
  return root;
}

const scan = (report, name) => report.scans.find(item => item.name === name);

async function cli(root, file) {
  try {
    const stdout = await releaseCommand(root, process.execPath, [xec, 'check-scans', '--report', path.join(root, file)],
      { env: { CI: 'true', FORCE_COLOR: '0' }, timeoutMs: 60_000 });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    if (!(error instanceof ReleaseCommandError)) throw error;
    return { status: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

test('the project command runs both real worklists and retains their evidence even when they find work', async t => {
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['check:scans'], 'xec check-scans');
  const before = await installationSnapshot();
  t.after(async () => assert.deepEqual(await installationSnapshot(), before));
  const root = await fixture(t);
  const result = await cli(root, 'report.json');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await fs.readFile(path.join(root, 'report.json')));
  assert.equal(report.exitCode, 0); assert.equal(report.worklistFindings, 2); assert.equal(report.unavailable, 0);
  const sites = scan(report, worklists[0]), builds = scan(report, worklists[1]);
  assert.equal(sites.counts.files, 2); assert.equal(sites.counts.detected, 2);
  assert.equal(sites.counts.matched, 1); assert.equal(sites.counts.unreviewed, 1);
  assert.ok(sites.counts.recorded > 1); assert.equal(sites.counts.stale, sites.counts.recorded - 1);
  assert.match(sites.stdout, /example\.ts::removeExample/); assert.match(result.stdout, /example\.ts::removeExample/);
  assert.deepEqual(builds.counts, { packages: 4, compared: 2, older: 1, withoutSource: 1, withoutBuild: 1 });
  assert.match(result.stdout, /No build output to compare: unbuilt/);
  await fs.rm(path.join(root, 'packages/current/dist'), { recursive: true });
  await fs.rm(path.join(root, 'packages/older/dist'), { recursive: true });
  await write(root, 'scripts/doc-imports-resolve.mjs', await fs.readFile(path.join(repo, 'scripts/doc-imports-resolve.mjs')));
  const missingBuilds = await runSourceScans(root);
  assert.equal(missingBuilds.exitCode, 0);
  assert.equal(scan(missingBuilds, worklists[1]).status, 'not-applicable');
  assert.equal(scan(missingBuilds, worklists[1]).counts.compared, 0);
  assert.equal(scan(missingBuilds, 'doc-imports-resolve').status, 'not-applicable');
});

test('a gate finding has exit 1, while an analyzer crash, signal or absent receipt has exit 2', async t => {
  const before = await installationSnapshot();
  t.after(async () => assert.deepEqual(await installationSnapshot(), before));
  const root = await fixture(t);
  const gate = 'a-package-that-needs-itself-built';
  await write(root, 'scripts/' + gate + '.mjs', actor + "console.error('fixture gate finding'); completeScan(import.meta.url, 'findings', { findings: 1 });");
  const gateRun = await cli(root, 'gate.json');
  assert.equal(gateRun.status, 1, gateRun.stderr || gateRun.stdout);
  const gateReport = JSON.parse(await fs.readFile(path.join(root, 'gate.json')));
  assert.equal(gateReport.gateFindings, 1); assert.equal(gateReport.unavailable, 0);
  assert.match(scan(gateReport, gate).stderr, /fixture gate finding/);
  await write(root, 'scripts/destructive-sites.mjs', "throw Error('fixture analyzer refused');");
  await write(root, 'scripts/a-port-the-network-could-reach.mjs', "process.kill(process.pid, 'SIGTERM');");
  await write(root, 'scripts/fail-open.mjs', "console.log('ordinary output');");
  await write(root, 'scripts/duplicate-implementations.mjs', "console.error('fixture input unreadable'); process.exitCode = 2;");
  await write(root, 'scripts/metadata-nobody-reads.mjs', actor + "completeScan(import.meta.url, 'findings'); process.exitCode = 0;");
  await write(root, 'scripts/module-root-drift.mjs', actor + "completeScan(import.meta.url, 'complete'); completeScan(import.meta.url, 'complete');");
  const lost = await cli(root, 'lost.json');
  assert.equal(lost.status, 2, lost.stderr || lost.stdout);
  const report = JSON.parse(await fs.readFile(path.join(root, 'lost.json')));
  assert.equal(report.gateFindings, 1); assert.equal(report.worklistFindings, 1); assert.equal(report.unavailable, 6);
  assert.equal(scan(report, worklists[0]).exitCode, 1);
  assert.match(scan(report, worklists[0]).stderr, /fixture analyzer refused/);
  assert.equal(scan(report, 'fail-open').exitCode, 0);
  assert.match(scan(report, 'duplicate-implementations').reason, /reported it could not complete/);
  for (const name of [worklists[0], 'a-port-the-network-could-reach', 'fail-open', 'duplicate-implementations', 'metadata-nobody-reads', 'module-root-drift']) {
    assert.equal(scan(report, name).status, 'unavailable', name);
  }
  assert.match(lost.stderr, /fixture analyzer refused/);
});

test('unclassified files stay unexecuted, a missing analyzer preserves other findings, and cancellation has no completed verdict', async t => {
  const root = await fixture(t);
  await write(root, 'scripts/unclassified.js', "import fs from 'node:fs'; fs.writeFileSync('unexpected-run', 'executed');");
  await fs.unlink(path.join(root, 'scripts/destructive-sites.mjs'));
  const refused = await runSourceScans(root);
  assert.equal(refused.exitCode, 2);
  assert.match(refused.errors.join('\n'), /Missing regular script: destructive-sites\.mjs/);
  assert.match(refused.errors.join('\n'), /Unclassified script: unclassified\.js/);
  assert.equal(refused.unavailable, 1); assert.equal(refused.worklistFindings, 1);
  assert.match(scan(refused, 'destructive-sites').reason, /Missing regular script/);
  assert.equal(scan(refused, 'a-build-older-than-its-source').status, 'findings');
  await assert.rejects(fs.stat(path.join(root, 'unexpected-run')), { code: 'ENOENT' });
  await fs.unlink(path.join(root, 'scripts/unclassified.js'));
  await write(root, 'scripts/destructive-sites.mjs', 'setInterval(() => {}, 1000);');
  const cancelled = await runSourceScans(root, { signal: AbortSignal.timeout(300) });
  assert.equal(cancelled.exitCode, 2); assert.equal(cancelled.unavailable, cancelled.scans.length);
});

test('unreadable build inventory and existing documentation never produce a completed verdict', async t => {
  const root = await fixture(t);
  await fs.rm(path.join(root, 'packages/older/dist'), { recursive: true });
  await write(root, 'packages/older/dist', 'not a directory');
  await write(root, 'scripts/doc-imports-resolve.mjs', await fs.readFile(path.join(repo, 'scripts/doc-imports-resolve.mjs')));
  await write(root, 'internal/website/docs', 'not a directory');
  const result = await runSourceScans(root);
  assert.equal(result.exitCode, 2); assert.equal(result.worklistFindings, 1); assert.equal(result.unavailable, 2);
  assert.match(scan(result, worklists[1]).stderr, /ENOTDIR/);
  assert.match(scan(result, 'doc-imports-resolve').stderr, /ENOTDIR/);
});
