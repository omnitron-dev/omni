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

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const first = '@fixture/base';
const second = '@fixture/client';
const version = '0.2.0-rc.1';

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
  const writes = new Map();
  let interrupt = true;
  let staged;
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    const name = decodeURIComponent(req.url.slice(1));
    if (req.method === 'PUT') {
      writes.set(name, (writes.get(name) ?? 0) + 1);
      if (interrupt && name === second) {
        res.writeHead(403).end(JSON.stringify({ error: 'simulated permission failure' }));
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const doc = JSON.parse(body);
      const attachment = Buffer.from(Object.values(doc._attachments)[0].data, 'base64');
      assert.equal(doc.versions[version].dist.integrity, 'sha512-' + createHash('sha512').update(attachment).digest('base64'));
      if (name === second) {
        staged = doc;
        res.writeHead(409).end(JSON.stringify({ error: `Cannot publish over previously staged version "${version}".` }));
        return;
      }
      store.set(name, doc);
      res.writeHead(201).end('{"ok":true}');
    } else if (req.method === 'GET' && store.has(name)) {
      res.end(JSON.stringify(store.get(name)));
    } else {
      res.writeHead(404).end('{"error":"not found"}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const address = `127.0.0.1:${server.address().port}`;
  const registry = `http://${address}/`;
  const npmrc = path.join(temp, 'npmrc');
  await fs.writeFile(npmrc, `registry=${registry}\n//${address}/:_authToken=loopback-fixture\nfetch-retries=0\n`, { mode: 0o600 });
  const env = { ...process.env, CI: 'true', NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_CACHE: path.join(temp, 'npm-cache'),
    GIT_CONFIG_GLOBAL: path.join(temp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture',
    GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@localhost', GIT_COMMITTER_EMAIL: 'fixture@localhost' };
  const exec = (bin, args, cwd = workspace) => run(bin, args, { cwd, env });
  const git = async (...args) => (await exec('git', args)).stdout.trim();
  const release = (...args) => exec(process.execPath, ['scripts/release.mjs', version, ...args]);
  const json = (name, value) => fs.writeFile(path.join(workspace, name), JSON.stringify(value, null, 2));
  await fs.mkdir(path.join(workspace, 'scripts'), { recursive: true });
  for (const file of ['release.mjs', 'build-release.mjs']) await fs.copyFile(path.join(repo, 'scripts', file), path.join(workspace, 'scripts', file));
  await json('package.json', { name: 'fixture', private: true, type: 'module', scripts: { build: 'node scripts/build.mjs' } });
  await fs.writeFile(path.join(workspace, 'scripts/build.mjs'), "import {writeFileSync} from 'node:fs'; for(const n of ['base','client']) writeFileSync('packages/'+n+'/index.js', 'export default 1;');");
  await fs.writeFile(path.join(workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  for (const [folder, name] of [['base', first], ['client', second]]) {
    await fs.mkdir(path.join(workspace, 'packages', folder), { recursive: true });
    await json(`packages/${folder}/package.json`, { name, version: '0.1.0', main: './index.js', files: ['index.js'],
      ...(name === second ? { dependencies: { [first]: 'workspace:*' } } : {}) });
  }
  await fs.writeFile(path.join(workspace, '.gitignore'), 'node_modules\n.release-artifacts\n');
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
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, '.release-artifacts', version, commit, 'release.json')));
  assert.deepEqual(manifest.artifacts.map(p => p.name), [first, second]);
  await release('--push');
  assert.equal(await git('ls-remote', '--tags', 'origin', 'refs/tags/unrelated'), '');
  assert.equal((await git('ls-remote', 'origin', 'refs/heads/main')).split(/\s/)[0], commit);
  await assert.rejects(release('--publish', '--registry', registry), /Publication interrupted for @fixture\/client[^\n]*\nnpm E403/);
  assert.equal(store.size, 1);
  interrupt = false;
  await assert.rejects(release('--resume', '--registry', registry), error => {
    assert.match(error.stderr, /Publication interrupted for @fixture\/client/);
    assert.match(error.stderr, /npm E409/);
    assert.match(error.stderr, /already staged/);
    assert.ok(error.stderr.includes(`node scripts/release.mjs ${version} --resume with the original --registry option`));
    return true;
  });
  assert.equal(store.size, 1);
  const receipts = (await fs.readFile(path.join(workspace, '.release-artifacts', version, commit, 'publication.jsonl'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  assert.ok(receipts.some(entry => entry.name === second && entry.state === 'unconfirmed'));
  assert.ok(!receipts.some(entry => entry.name === second && entry.state === 'registry-confirmed'));
  store.set(second, staged);
  await release('--resume', '--registry', registry);
  assert.deepEqual([...writes], [[first, 1], [second, 2]]);
  for (const doc of store.values()) assert.deepEqual(doc['dist-tags'], { rc: version });
  store.get(first).versions[version].dist.integrity = 'sha512-foreign';
  await assert.rejects(release('--resume', '--registry', registry), /Registry archive differs/);
  assert.equal(writes.get(first), 1);
});
