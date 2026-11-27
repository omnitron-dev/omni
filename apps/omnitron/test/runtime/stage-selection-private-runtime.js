import assert from 'node:assert/strict';
import { access, chmod, cp, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Use unprivileged POSIX permissions to test the change in access to the
// administrative release without changing the caller's UID or its installation.
assert(process.getuid?.() > 0, 'Run as the unprivileged qualification account');
const pkg = resolve(process.argv[2]);
const temp = await mkdtemp(join(tmpdir(), 'stage-selection-private-'));
const code = join(temp, 'administrative');
await mkdir(code, { mode: 0o700 });
try {
  for (const name of ['dist', 'package.json']) await cp(join(pkg, name), join(code, name), { recursive: true });
  await symlink(join(pkg, 'node_modules'), join(code, 'node_modules'));
  const file = join(code, 'dist/daemon/runtime-installation.js');
  const { RuntimeInstallation } = await import(pathToFileURL(file).href);
  await RuntimeInstallation.preloadExclusive();
  // Enrollment has already created a private registry. The actual account
  // transition sets this umask before another SQLite connection is opened.
  const home = join(temp, 'service');
  const { RuntimeInstallation: EnrolledInstallation } = await import(pathToFileURL(join(pkg, 'dist/daemon/runtime-installation.js')).href);
  const initial = await EnrolledInstallation.open(home);
  await initial.close();
  const previousMask = process.umask(0o077);
  try {
    await chmod(code, 0);
    await assert.rejects(access(file), { code: 'EACCES' });
    const instance = await RuntimeInstallation.open(home, { existing: true });
    assert(instance);
    try {
      await instance.exclusive(async () => {
        assert.equal(instance.selection(), null);
      }, { stageFenceScope: 'a'.repeat(64) });
    } finally { await instance.close(); }
  } finally { process.umask(previousMask); }
  console.log('Opened and exclusively held the service registry after the administrative package became inaccessible');
} finally {
  await chmod(code, 0o700);
  await rm(temp, { recursive: true, force: true });
}
