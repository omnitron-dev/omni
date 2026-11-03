import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readReleaseSource, sourcePublication } from '../../src/release/source.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const remove of cleanup.splice(0).reverse()) await remove(); });
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
}
async function fixture(authenticated = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-publication-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repo.git'), checkout = path.join(root, 'checkout');
  await fs.mkdir(checkout); git(checkout, 'init', '--quiet', '-b', 'main');
  git(checkout, 'commit', '--quiet', '--allow-empty', '-m', 'First');
  const first = git(checkout, 'rev-parse', 'HEAD');
  git(checkout, 'commit', '--quiet', '--allow-empty', '-m', 'Second');
  const second = git(checkout, 'rev-parse', 'HEAD');
  git(root, 'clone', '--quiet', '--bare', checkout, repository);
  git(repository, 'update-server-info');
  const server = createServer(async (req, res) => {
    try {
      if (authenticated && req.headers.authorization !== 'Basic ' + Buffer.from('fixture:fixture-token').toString('base64')) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="private fixture"' }).end(); return;
      }
      const request = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + request);
      if (!file.startsWith(repository + path.sep)) { res.writeHead(404).end(); return; }
      const contents = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(contents);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/repo.git`;
  git(checkout, 'remote', 'add', 'origin', url);
  const advertise = (ref: string, commit: string) => { git(repository, 'update-ref', ref, commit); git(repository, 'update-server-info'); };
  return { root, checkout, repository, server, url, first, second, advertise };
}
async function close(server: Server) { await new Promise<void>(resolve => server.close(() => resolve())); }

describe('source publication from current upstream advertisement', () => {
  it('proves an exact advertised commit and an ancestor without changing local refs', async () => {
    const f = await fixture(), before = git(f.checkout, 'show-ref');
    expect(await readReleaseSource(f.checkout, f.second)).toEqual({ repo: f.url, commit: f.second, onRemote: true });
    expect(await sourcePublication(f.checkout, f.url, f.first)).toBe(true);
    expect(git(f.checkout, 'show-ref')).toBe(before);
    expect(await fs.access(path.join(f.checkout, '.git', 'FETCH_HEAD')).then(() => true, () => false)).toBe(false);
  });
  it('does not trust stale origin refs, another remote or an arbitrary ref for a branch policy', async () => {
    const f = await fixture();
    git(f.checkout, 'commit', '--quiet', '--allow-empty', '-m', 'Local only');
    const local = git(f.checkout, 'rev-parse', 'HEAD');
    git(f.checkout, 'update-ref', 'refs/remotes/origin/main', local);
    git(f.checkout, 'update-ref', 'refs/remotes/another/main', local);
    // The remote knows the object as a tag and candidate branch, not its main.
    git(f.repository, 'fetch', '--quiet', f.checkout, local);
    expect(await sourcePublication(f.checkout, f.url, local)).toBe(false);
    f.advertise('refs/tags/local', local);
    expect(await sourcePublication(f.checkout, f.url, local)).toBe(true);
    f.advertise('refs/heads/candidate', local);
    expect(await sourcePublication(f.checkout, f.url, local)).toBe(true);
    expect(await sourcePublication(f.checkout, f.url, local, { ref: 'refs/heads/main' })).toBe(false);
  });
  it('uses the peeled annotated tag target and requires an exact commit for a selected tag', async () => {
    const f = await fixture(); git(f.repository, 'tag', '-a', 'stable', f.second, '-m', 'Stable');
    git(f.repository, 'update-server-info');
    expect(await sourcePublication(f.checkout, f.url, f.second, { ref: 'refs/tags/stable' })).toBe(true);
    expect(await sourcePublication(f.checkout, f.url, f.first, { ref: 'refs/tags/stable' })).toBe(false);
  });
  it('recognizes exact publication in a repository with hundreds of unrelated release refs', async () => {
    const f = await fixture();
    const commits = Array.from({ length: 600 }, (_, index) => `commit refs/heads/extra-${index}\ncommitter Fixture <fixture@example.invalid> ${index + 1} +0000\ndata 0\n\n`).join('');
    execFileSync('git', ['fast-import', '--quiet'], { cwd: f.repository, input: commits });
    git(f.repository, 'update-server-info');
    expect(await sourcePublication(f.checkout, f.url, f.second)).toBe(true);
  });
  it('preserves the configured SSH transport instead of replacing the operator wrapper', async () => {
    const f = await fixture(), marker = path.join(f.root, 'transport-used'), helper = path.join(f.root, 'transport.mjs');
    await fs.writeFile(helper, `import{writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';\nwriteFileSync(${JSON.stringify(marker)},'operator transport');\nconst r=spawnSync('git',['upload-pack',${JSON.stringify(f.repository)}],{stdio:'inherit'});process.exit(r.status??1);\n`);
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    vi.stubEnv('GIT_SSH_COMMAND', quote(process.execPath) + ' ' + quote(helper));
    vi.stubEnv('GIT_SSH_VARIANT', 'ssh');
    expect(await sourcePublication(f.checkout, 'ssh://git@provider.invalid/team/framework.git', f.second)).toBe(true);
    expect(await fs.readFile(marker, 'utf8')).toBe('operator transport');
  });
  it.each(['GIT_ASKPASS', 'core.askPass'])('preserves a configured %s token program for actual private HTTP Git authentication', async setting => {
    const f = await fixture(true), marker = path.join(f.root, 'askpass-used'), helper = path.join(f.root, 'askpass.mjs');
    await fs.writeFile(helper, `#!/usr/bin/env node\nimport{appendFileSync}from'node:fs';appendFileSync(${JSON.stringify(marker)},'called\\n');console.log(process.argv.at(-1).includes('Username')?'fixture':'fixture-token');\n`, { mode: 0o700 });
    git(f.checkout, 'config', 'credential.helper', '');
    if (setting === 'GIT_ASKPASS') vi.stubEnv(setting, helper);
    else { vi.stubEnv('GIT_ASKPASS', undefined); git(f.checkout, 'config', setting, helper); }
    expect(await sourcePublication(f.checkout, f.url, f.second)).toBe(true);
    expect(await fs.readFile(marker, 'utf8')).toContain('called');
  });
  it('preserves explicit SSH askpass selection and requirement for the configured transport', async () => {
    const f = await fixture(), marker = path.join(f.root, 'ssh-environment.json'), helper = path.join(f.root, 'transport-env.mjs');
    await fs.writeFile(helper, `import{writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.env.SSH_ASKPASS,process.env.SSH_ASKPASS_REQUIRE]));const r=spawnSync('git',['upload-pack',${JSON.stringify(f.repository)}],{stdio:'inherit'});process.exit(r.status??1);\n`);
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    vi.stubEnv('GIT_SSH_COMMAND', quote(process.execPath) + ' ' + quote(helper)); vi.stubEnv('GIT_SSH_VARIANT', 'ssh');
    vi.stubEnv('SSH_ASKPASS', '/operator/token-helper'); vi.stubEnv('SSH_ASKPASS_REQUIRE', 'force');
    expect(await sourcePublication(f.checkout, 'ssh://git@provider.invalid/team/framework.git', f.second)).toBe(true);
    expect(JSON.parse(await fs.readFile(marker, 'utf8'))).toEqual(['/operator/token-helper', 'force']);
  });
  it('keeps absent ancestry unknown and never fetches the advertised object', async () => {
    const f = await fixture();
    const tree = git(f.repository, 'rev-parse', f.second + '^{tree}');
    const unseen = git(f.repository, 'commit-tree', tree, '-p', f.second, '-m', 'Remote only');
    f.advertise('refs/heads/main', unseen);
    expect(await sourcePublication(f.checkout, f.url, f.first)).toBeNull();
    expect(() => git(f.checkout, 'cat-file', '-e', unseen)).toThrow();
    expect(await sourcePublication(f.checkout, f.url, unseen)).toBe(true);
  });
  it('does not turn missing transport or missing origin into publication', async () => {
    const f = await fixture(); await close(f.server);
    expect(await readReleaseSource(f.checkout, f.second)).toMatchObject({ onRemote: null });
    git(f.checkout, 'remote', 'remove', 'origin');
    expect(await readReleaseSource(f.checkout, f.second)).toEqual({ repo: '(no origin)', commit: f.second, onRemote: null });
  });
  it('records local and file repositories without treating them as upstream publication', async () => {
    const f = await fixture();
    for (const repository of [f.repository, 'file://' + f.repository, '../repo.git']) {
      git(f.checkout, 'remote', 'set-url', 'origin', repository);
      expect(await readReleaseSource(f.checkout, f.second)).toEqual({ repo: repository, commit: f.second, onRemote: false });
    }
  });
  it('keeps an offline insteadOf mirror separate from network publication', async () => {
    const f = await fixture(), logical = 'https://mirror.example.invalid/framework.git';
    git(f.checkout, 'remote', 'set-url', 'origin', logical);
    git(f.checkout, 'config', 'url.' + f.repository + '.insteadOf', logical);
    expect(await readReleaseSource(f.checkout, f.second)).toEqual({ repo: logical, commit: f.second, onRemote: false });
  });
  it.each(['GIT_DIR', 'GIT_OBJECT_DIRECTORY'])('refuses ambient %s without observing another repository or mutating the environment', async variable => {
    const f = await fixture(), injected = path.join(f.repository, variable === 'GIT_DIR' ? '' : 'objects');
    vi.stubEnv(variable, injected);
    await expect(readReleaseSource(f.checkout, f.second)).rejects.toThrow('unset repository redirection variables: ' + variable);
    await expect(sourcePublication(f.checkout, f.url, f.second)).rejects.toThrow('unset repository redirection variables: ' + variable);
    expect(process.env[variable]).toBe(injected);
  });
  it('waits for an aborted configured transport and its child to close before settling', async () => {
    const f = await fixture(), marker = path.join(f.root, 'pids.json'), helper = path.join(f.root, 'hanging.mjs');
    await fs.writeFile(helper, `import{writeFileSync}from'node:fs';import{spawn}from'node:child_process';\nconst c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});\nwriteFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);\n`);
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    vi.stubEnv('GIT_SSH_COMMAND', quote(process.execPath) + ' ' + quote(helper)); vi.stubEnv('GIT_SSH_VARIANT', 'ssh');
    const abort = new AbortController();
    const pending = sourcePublication(f.checkout, 'ssh://git@provider.invalid/team/framework.git', f.second, { signal: abort.signal });
    const settled = pending.then(() => null, error => error);
    let pids: number[] | undefined;
    for (let n = 0; n < 200; n++) {
      try { pids = JSON.parse(await fs.readFile(marker, 'utf8')) as number[]; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    abort.abort(new Error('test cancelled'));
    try {
      expect(await settled).toBeInstanceOf(Error); expect(pids).toHaveLength(2);
      for (const pid of pids!) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      // A failing cancellation regression must not leave its own private fixture alive.
      for (const pid of pids ?? []) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  });
  it('ignores replacement refs and refuses grafted or incomplete ancestry', async () => {
    const f = await fixture();
    git(f.checkout, 'commit', '--quiet', '--allow-empty', '-m', 'Unpublished');
    const local = git(f.checkout, 'rev-parse', 'HEAD');
    git(f.checkout, 'replace', f.second, local);
    expect(await sourcePublication(f.checkout, f.url, local)).toBe(false);
    await fs.writeFile(path.join(f.checkout, '.git', 'info', 'grafts'), `${f.second} ${local}\n`);
    expect(await sourcePublication(f.checkout, f.url, local)).toBeNull();
    expect(await sourcePublication(f.checkout, f.url, f.second)).toBe(true);
    await fs.unlink(path.join(f.checkout, '.git', 'info', 'grafts'));
    await fs.writeFile(path.join(f.checkout, '.git', 'shallow'), f.second + '\n');
    expect(await sourcePublication(f.checkout, f.url, local)).toBeNull();
  });
});
