import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] !== '--fixture') {
  const input = fileURLToPath(new URL('../../data/operations/managed-account.mjs', import.meta.url));
  const { DEFAULT_LEASE_TIMING: timing, acquireScript, guardScript, releaseScript } = await import('../../src/services/node-deploy-lease.ts');
  const record = { token: 'test', holder: 'controller', stack: 'sample/test', startedAt: '2026-01-01T00:00:00Z' };
  const lease = { directory: timing.dir, acquire: acquireScript(timing, record),
    execute: guardScript(timing, record.token, 'echo running'), release: releaseScript(timing, record.token) };
  execFileSync('docker', [
    'run', '--rm', '-i', '--network=none', '--read-only', '--label', 'org.omnitron.test=managed-service-account',
    '--tmpfs', '/root:mode=0700', '--tmpfs', '/home/node:uid=1000,gid=1000,mode=0700', '--tmpfs', '/opt:mode=0755',
    '--mount', 'type=bind,source=' + input + ',target=/account.mjs,readonly',
    '--mount', 'type=bind,source=' + fileURLToPath(import.meta.url) + ',target=/test.mjs,readonly',
    'node:22.14.0-bookworm-slim', 'node', '/test.mjs', '--fixture',
  ], { input: JSON.stringify(lease), stdio: ['pipe', 'inherit', 'inherit'], timeout: 240_000 });
} else {
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n');
  assert.ok(mounts.some(line => line.split(' ')[4] === '/opt' && line.includes(' - tmpfs ')));
  const lease = JSON.parse(fs.readFileSync(0, 'utf8'));
  const run = script => spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(run(lease.acquire).stdout.trim(), 'ACQUIRED');
  assert.equal(run(lease.execute).stdout.trim(), 'running');
  assert.equal(run(lease.release).stdout.trim(), 'RELEASED');
  fs.chmodSync(lease.directory, 0o775);
  assert.equal(run(lease.acquire).stdout.trim(), 'UNSAFE-LOCKS');
  const refused = run(lease.execute);
  assert.equal(refused.status, 73, refused.stderr);
  assert.equal(refused.stdout.trim(), 'UNSAFE-LOCKS');
  for (const home of ['/root', '/home/node']) {
    assert.ok(mounts.some(line => line.split(' ')[4] === home && line.includes(' - tmpfs ')));
    assert.equal(fs.existsSync(path.join(home, '.omnitron')), false);
  }
  const admin = '/root/.omnitron', service = '/home/node/.omnitron';
  fs.mkdirSync(admin, { mode: 0o700 });
  fs.mkdirSync(service, { mode: 0o700 });
  fs.chownSync(service, 1000, 1000);
  const file = path.join(service, 'config.json');
  fs.writeFileSync(file, 'This fixture must never be parsed.', { mode: 0o600 });
  fs.chownSync(file, 1000, 1000);

  const probe = `
    import { enterManagedInstance } from '/account.mjs';
    import fs from 'node:fs';
    const instance = enterManagedInstance('/root/.omnitron');
    console.log(JSON.stringify({
      ...instance, uid: process.getuid(), gid: process.getgid(), groups: process.getgroups(),
      homeEnv: process.env.HOME, bus: process.env.DBUS_SESSION_BUS_ADDRESS,
      adminEnv: Boolean(process.env.ADMIN_FIXTURE), canReadAdmin: fs.existsSync('/root/.omnitron/config.json')
    }));`;
  const read = () => spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8', env: { ...process.env, ADMIN_FIXTURE: 'present' }, timeout: 5000,
  });
  assert.equal(JSON.parse(read().stdout).uid, 0);
  const link = path.join(admin, 'config.json');
  fs.symlinkSync(file, link);
  const observed = read();
  assert.equal(observed.status, 0, observed.stderr);
  const status = JSON.parse(observed.stdout);
  assert.deepEqual(status.account, { uid: 1000, gid: 1000, instanceHome: service });
  assert.equal(status.uid, 1000);
  assert.equal(status.gid, 1000);
  assert.equal(status.groups.includes(0), false);
  assert.equal(status.homeEnv, '/home/node');
  assert.equal(status.bus, 'unix:path=/run/user/1000/bus');
  assert.equal(status.adminEnv, false);
  assert.equal(status.canReadAdmin, false);

  fs.chmodSync(file, 0o644);
  assert.match(read().stderr, /Cannot bind/);
  fs.chmodSync(file, 0o600);
  fs.chmodSync(admin, 0o777);
  assert.match(read().stderr, /Cannot bind/);
  fs.chmodSync(admin, 0o700);
  fs.mkdirSync(path.join(admin, 'runtime'));
  fs.writeFileSync(path.join(admin, 'runtime', 'supervision.json'), '{}');
  assert.match(read().stderr, /Cannot bind/);
  console.log('Managed Linux service account and administrative deployment lease verified');
}
