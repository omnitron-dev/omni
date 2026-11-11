import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { discoverReleasePackages } from '@xec-sh/ops/release';
import { supersedeDraft } from '../../.xec/supersede-draft.mjs';
import { assertPipelineSucceeded } from '../lib/pipeline-result.mjs';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const first = '@fixture/base';
const second = '@fixture/client';
const version = '0.2.0-rc.1';

test('package builds use the installed compiler on an isolated builder', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-package-build-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const bin = path.join(cwd, 'bin');
  await fs.mkdir(bin);
  // Expose the shell and filesystem tools an isolated builder provides.
  for (const [name, target] of Object.entries({
    node: process.execPath, bash: '/bin/bash', basename: '/usr/bin/basename',
    dirname: '/usr/bin/dirname', rm: '/bin/rm', mv: '/bin/mv',
  })) await fs.symlink(target, path.join(bin, name));
  const source = path.join(repo, 'packages/access');
  await fs.cp(path.join(source, 'src'), path.join(cwd, 'src'), { recursive: true });
  for (const file of ['tsconfig.json', 'package.json']) await fs.copyFile(path.join(source, file), path.join(cwd, file));
  const build = path.join(repo, 'scripts/build-package.sh');
  const options = { cwd, env: { ...process.env, PATH: bin } };
  await run(build, [], options);
  const output = path.join(cwd, 'dist/index.d.ts');
  const declarations = await fs.readFile(output, 'utf8');
  assert.ok(declarations.length > 0);
  await fs.access(path.join(cwd, 'dist/index.js'));
  await assert.rejects(run(build, ['-p', './tsconfig.json', '--declarationDir', 'dist'], options),
    error => error.code === 1 && error.stderr.includes('sets declarationDir'));
  assert.equal(await fs.readFile(output, 'utf8'), declarations);
});

test('public npm packages link to their own workspace in the canonical repository', async () => {
  for (const pkg of await discoverReleasePackages(repo)) {
    const manifest = JSON.parse(await fs.readFile(path.join(repo, pkg.path, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.repository, {
      type: 'git', url: 'git+https://github.com/omnitron-dev/omni.git', directory: pkg.path,
    }, pkg.name);
    if (manifest.homepage?.startsWith('https://github.com/omnitron-dev/omni/tree/')) {
      assert.equal(manifest.homepage, `https://github.com/omnitron-dev/omni/tree/main/${pkg.path}#readme`, pkg.name);
    }
  }
});

test('release plans, seals, pushes one tag and resumes a partial registry publication', { timeout: 240_000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-release-test-'));
  const workspace = path.join(temp, 'workspace');
  const origin = path.join(temp, 'origin.git');
  const store = new Map();
  const archives = new Map();
  const downloads = new Map();
  const writes = new Map();
  let interrupt = true;
  let staged;
  let stagedReads = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    const name = decodeURIComponent(req.url.slice(1));
    if (req.method === 'GET' && archives.has(name)) {
      const { packageName, bytes } = archives.get(name);
      downloads.set(packageName, (downloads.get(packageName) ?? 0) + 1);
      res.setHeader('content-type', 'application/octet-stream');
      res.end(bytes);
      return;
    }
    if (req.method === 'PUT') {
      writes.set(name, (writes.get(name) ?? 0) + 1);
      if (interrupt && name === second) {
        res.writeHead(403).end(JSON.stringify({ error: 'simulated permission failure' }));
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const doc = JSON.parse(body);
      const [filename, packed] = Object.entries(doc._attachments)[0];
      const attachment = Buffer.from(packed.data, 'base64');
      assert.equal(doc.versions[version].dist.integrity, 'sha512-' + createHash('sha512').update(attachment).digest('base64'));
      const archivePath = `${name}/-/${filename}`;
      archives.set(archivePath, { packageName: name, bytes: attachment });
      doc.versions[version].dist.tarball = `http://${req.headers.host}/${encodeURIComponent(name)}/-/${encodeURIComponent(filename)}`;
      if (name === second) {
        staged = doc;
        res.writeHead(409).end(JSON.stringify({ error: `Cannot publish over previously staged version "${version}".` }));
        return;
      }
      store.set(name, doc);
      res.writeHead(201).end('{"ok":true}');
    } else if (req.method === 'GET' && name === second && staged && ++stagedReads >= 2) {
      // A staged upload becomes visible only after the first confirmation poll.
      store.set(second, staged);
      res.end(JSON.stringify(staged));
    } else if (req.method === 'GET' && store.has(name)) {
      res.end(JSON.stringify(store.get(name)));
    } else {
      res.writeHead(404).end('{"error":"not found"}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const address = `127.0.0.1:${server.address().port}`;
  const registry = `http://${address}/`;
  const npmrc = path.join(temp, 'npmrc');
  await fs.writeFile(npmrc, `registry=${registry}\n//${address}/:_authToken=loopback-fixture\nfetch-retries=0\n`, { mode: 0o600 });
  const bin = path.join(temp, 'bin');
  await fs.mkdir(bin);
  const githubState = path.join(temp, 'github-release');
  await fs.writeFile(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const [cmd, op, tag] = process.argv.slice(2);
const state = process.env.FIXTURE_GITHUB_STATE;
if (cmd === 'api') { if (fs.existsSync(state)) console.log(fs.readFileSync(state, 'utf8')); }
else if (cmd === 'release' && op === 'create' && process.argv.includes('--verify-tag')) fs.writeFileSync(state, tag, { flag: 'wx' });
else if (cmd === 'release' && op === 'view' && fs.readFileSync(state, 'utf8') === tag) {
  console.log(JSON.stringify({ tagName: tag, isPrerelease: true, isDraft: false, url: 'https://github.com/omnitron-dev/omni/releases/tag/' + tag }));
} else process.exit(1);
`, { mode: 0o700 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, FIXTURE_GITHUB_STATE: githubState, CI: 'true', NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_CACHE: path.join(temp, 'npm-cache'),
    GIT_CONFIG_GLOBAL: path.join(temp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture',
    GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@localhost', GIT_COMMITTER_EMAIL: 'fixture@localhost' };
  const exec = (bin, args, cwd = workspace) => run(bin, args, { cwd, env, signal: t.signal });
  const git = async (...args) => (await exec('git', args)).stdout.trim();
  const release = (...args) => exec(process.execPath, [path.join(repo, 'node_modules/@xec-sh/cli/bin/xec'), 'release', version, ...args]);
  const json = (name, value) => fs.writeFile(path.join(workspace, name), JSON.stringify(value, null, 2));
  // Exercise the checked-in recipe with its complete relative module tree.
  // A hand-picked entrypoint list silently drops new shared dependencies.
  await fs.cp(path.join(repo, 'scripts'), path.join(workspace, 'scripts'), { recursive: true });
  await fs.cp(path.join(repo, '.xec'), path.join(workspace, '.xec'), { recursive: true, filter: file => !file.includes('/.tmp') });
  // CI qualification has its own failure/resume suite; this loopback suite exercises registry publication.
  await fs.writeFile(path.join(workspace, '.xec/qualification.mjs'), 'export async function qualifyRelease() {}\nexport async function verifyReleaseQualification() { return {fixture:true}; }\n');
  // The fixture publishes two tiny packages, not the complete Omnitron SDK.
  // Keep both package-consumer validation stages observable in its archive.
  await fs.mkdir(path.join(workspace, 'scripts/ci'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'scripts/check-package-exports.mjs'),
    "import assert from 'node:assert/strict'; import fs from 'node:fs'; assert.equal(process.argv[2], '--install-consumer'); fs.mkdirSync(process.argv[3]); fs.writeFileSync(process.argv[3]+'/audit-checked', 'checked');");
  await fs.writeFile(path.join(workspace, 'scripts/ci/check-runtime-consumer.mjs'),
    "import assert from 'node:assert/strict'; import fs from 'node:fs'; assert.equal(fs.readFileSync(process.argv[2]+'/audit-checked', 'utf8'), 'checked'); fs.writeFileSync('packages/base/consumer-checked', 'archives, audit, runtime');");
  await json('package.json', { name: 'fixture', private: true, type: 'module', scripts: { build: 'node scripts/build.mjs' } });
  await fs.writeFile(path.join(workspace, 'scripts/build.mjs'), "import {writeFileSync} from 'node:fs'; for(const n of ['base','client']) writeFileSync('packages/'+n+'/index.js', 'export default 1;');");
  await fs.writeFile(path.join(workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  for (const [folder, name] of [['base', first], ['client', second]]) {
    await fs.mkdir(path.join(workspace, 'packages', folder), { recursive: true });
    await json(`packages/${folder}/package.json`, { name, version: '0.1.0', main: './index.js', files: ['index.js', 'consumer-checked'],
      ...(name === second ? { dependencies: { [first]: 'workspace:*' } } : {}) });
  }
  await fs.writeFile(path.join(workspace, '.gitignore'), 'node_modules\n.release-artifacts\n.xec/.tmp/\n');
  await exec('pnpm', ['install', '--lockfile-only', '--offline']);
  await fs.symlink(path.join(repo, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
  await git('init', '-q', '-b', 'main');
  await git('add', '--', '.');
  await git('commit', '-qm', 'Fixture');
  await git('init', '--bare', origin);
  await git('remote', 'add', 'origin', origin);
  await git('push', 'origin', 'HEAD:main');
  await git('tag', '-a', 'unrelated', '-m', 'Unrelated');
  await git('config', 'push.followTags', 'true');
  const before = await git('rev-parse', 'HEAD');
  await release('--dry-run');
  assert.equal(await git('rev-parse', 'HEAD'), before);
  assert.equal(await git('status', '--porcelain'), '');
  assert.equal(await fs.stat(path.join(workspace, '.release-artifacts')).catch(() => null), null);
  await release('--prepare');
  const commit = await git('rev-parse', 'HEAD');
  assert.notEqual(commit, before);
  const next = path.join(temp, 'next');
  await git('worktree', 'add', '-b', 'next', next, 'HEAD');
  await run('git', ['commit', '--allow-empty', '-qm', 'Reviewed correction'], { cwd: next, env });
  const revised = await supersedeDraft(next, version, workspace, async (cwd, executable, args) => (await exec(executable, args, cwd)).stdout.trim());
  assert.equal(revised.commit, commit);
  await assert.rejects(git('rev-parse', 'refs/tags/v' + version));
  // Restore the preserved object only inside this fixture to continue the publication acceptance below.
  await git('update-ref', 'refs/tags/v' + version, await git('rev-parse', revised.archived));
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, '.release-artifacts', version, commit, 'release.json')));
  assert.deepEqual(manifest.artifacts.map(p => p.name), [first, second]);
  for (const artifact of manifest.artifacts) {
    const tarball = path.join(workspace, '.release-artifacts', version, commit, artifact.file);
    const packed = JSON.parse((await exec('tar', ['-xOf', tarball, 'package/package.json'])).stdout);
    assert.equal(packed.gitHead, commit);
    if (artifact.name === first) assert.equal((await exec('tar', ['-xOf', tarball, 'package/consumer-checked'])).stdout, 'archives, audit, runtime');
  }
  await assert.rejects(release('--finish', '--registry', registry), /Publication interrupted for @fixture\/client[^\n]*\nnpm E403/);
  assert.equal(await fs.stat(githubState).catch(() => null), null);
  assert.equal(await git('ls-remote', '--tags', 'origin', 'refs/tags/unrelated'), '');
  assert.equal((await git('ls-remote', 'origin', 'refs/heads/main')).split(/\s/)[0], commit);
  assert.equal(store.size, 1);
  await assert.rejects(supersedeDraft(next, version, workspace, async (cwd, executable, args) => (await exec(executable, args, cwd)).stdout.trim()), /publication receipts/);
  interrupt = false;
  await release('--finish', '--registry', registry);
  assert.equal(await fs.readFile(githubState, 'utf8'), 'v' + version);
  assert.equal(store.size, 2);
  const receipts = (await fs.readFile(path.join(workspace, '.release-artifacts', version, commit, 'publication.jsonl'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  assert.ok(receipts.some(entry => entry.name === second && entry.state === 'unconfirmed'));
  assert.ok(receipts.some(entry => entry.name === second && entry.state === 'awaiting-registry'));
  assert.ok(receipts.some(entry => entry.name === second && entry.state === 'registry-confirmed'));
  assert.ok(stagedReads >= 2);
  for (const name of [first, second]) assert.ok(downloads.get(name) > 0, `${name} must be downloaded and verified`);
  await release('--resume', '--registry', registry);
  assert.deepEqual([...writes], [[first, 1], [second, 2]]);
  for (const doc of store.values()) assert.deepEqual(doc['dist-tags'], { rc: version });
  store.get(first).versions[version].dist.integrity = 'sha512-foreign';
  await assert.rejects(release('--resume', '--registry', registry), /Registry archive differs/);
  assert.equal(writes.get(first), 1);
});

test('success does not report a failure', () => {
  assert.doesNotThrow(() => assertPipelineSucceeded({ success: true, steps: [] }));
});
test('preserves stdout-only failures and stderr while excluding skipped dependents', () => {
  assert.throws(() => assertPipelineSucceeded({ success: false, steps: [
    { name: 'consumer-install', success: false, exitCode: 1, error: 'Command exited with code 1', stdout: 'specific npm or cleanup failure', stderr: 'additional context' },
    { name: 'consumer-runtime', success: false, skipped: true, error: 'Skipped due to dependency failure' },
  ] }), error => error.message.includes('specific npm or cleanup failure') && error.message.includes('additional context') && !error.message.includes('consumer-runtime'));
});
test('bounds diagnostic tails without losing the final reason', () => {
  assert.throws(() => assertPipelineSucceeded({ success: false, steps: [
    { name: 'consumer', success: false, exitCode: 1, stdout: 'x'.repeat(100_000) + 'final-reason', stderr: '', outputTruncated: true },
  ] }), error => error.message.length < 17_000 && error.message.includes('final-reason') && error.message.includes('output truncated'));
});
test('skipped-only outcomes still reject publication', () => {
  assert.throws(() => assertPipelineSucceeded({ success: false, steps: [{ success: false, skipped: true }] }), /did not complete/);
});
