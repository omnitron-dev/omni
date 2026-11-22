import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { userInfo } from 'node:os';
import { execFileSync as readOsAccount } from 'node:child_process';

// An administrator can enroll a dedicated instance by linking the private login
// config to the service account's config. Inspect the link and file metadata
// only. Enter the account before reading any instance records or running its SDK.
export function enterManagedInstance(home) {
  if (process.platform !== 'linux') return { home };
  if (process.getuid() !== process.geteuid()) throw Error('Managed execution requires matching real and effective UIDs');
  if (process.getuid() !== 0) return { home };
  const admin = userInfo();
  if (home !== join(admin.homedir, '.omnitron')) return { home };
  const link = join(home, 'config.json');
  const alias = lstatSync(link, { throwIfNoEntry: false });
  if (!alias?.isSymbolicLink()) return { home };

  const refuse = () => { throw Error('Cannot bind the registered SSH account to a unique private service instance'); };
  for (let dir = home; ; dir = dirname(dir)) {
    const entry = lstatSync(dir);
    if (!entry.isDirectory() || entry.uid !== 0 || (entry.mode & 0o022)) refuse();
    if (dir === dirname(dir)) break;
  }
  const target = readlinkSync(link);
  if (alias.uid !== 0 || !isAbsolute(target) || normalize(target) !== target || realpathSync(target) !== target) refuse();
  const file = lstatSync(target);
  // A link to a file owned by the login does not delegate another account.
  if (file.uid === 0) return { home };
  const instance = dirname(target);
  const directory = lstatSync(instance);
  if (target !== join(instance, 'config.json') || !file.isFile() || (file.mode & 0o077) ||
      !directory.isDirectory() || directory.uid !== file.uid || (directory.mode & 0o022) ||
      lstatSync(join(home, 'runtime', 'supervision.json'), { throwIfNoEntry: false })) refuse();
  for (let dir = dirname(instance); ; dir = dirname(dir)) {
    const entry = lstatSync(dir);
    if (!entry.isDirectory() || ![0, file.uid].includes(entry.uid) || (entry.mode & 0o022)) refuse();
    if (dir === dirname(dir)) break;
  }
  const group = readOsAccount('/usr/bin/id', ['-g', '--', String(file.uid)], {
    encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', LANG: 'C' },
  }).trim();
  if (!/^[1-9][0-9]*$/.test(group) || !Number.isSafeInteger(Number(group))) refuse();
  process.initgroups(file.uid, Number(group));
  process.setgid(Number(group));
  process.setuid(file.uid);
  const service = userInfo();
  if (process.geteuid() !== file.uid || service.uid !== file.uid || service.gid !== Number(group) ||
      process.getgroups().includes(0) || instance !== join(service.homedir, '.omnitron')) refuse();

  // The login may have its own systemd bus, loader flags, or application
  // credentials. Only the recipient's native paths enter the child process.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, {
    HOME: service.homedir, USER: service.username, LOGNAME: service.username,
    OMNITRON_HOME: instance, PATH: join(instance, 'runtime/bin') + ':/usr/local/bin:/usr/bin:/bin', LANG: 'C',
    XDG_RUNTIME_DIR: '/run/user/' + file.uid,
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/' + file.uid + '/bus',
  });
  process.umask(0o077);
  process.chdir(service.homedir);
  return { home: instance, account: { uid: service.uid, gid: service.gid, instanceHome: instance } };
}
