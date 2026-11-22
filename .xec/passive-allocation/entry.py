"""One administrative lease. The installed application SDK runs only as its daemon user."""
import base64
import datetime
import gzip
import json
import os
import pathlib
import pwd
import stat
import subprocess
import sys
import tempfile
import uuid

SYSTEM_PATH = '/usr/sbin:/usr/bin:/sbin:/bin'
TOKEN = 'f17a0000-0000-4000-a000-000000000000'


def refuse(message):
    raise SystemExit(message)


def require_directory(path, uid, private=False, gid=None):
    s = os.lstat(path)
    if (not stat.S_ISDIR(s.st_mode) or s.st_uid != uid or (gid is not None and s.st_gid != gid)
            or (stat.S_IMODE(s.st_mode) != 0o700 if private else s.st_mode & 0o022)
            or os.path.realpath(path) != str(path)):
        refuse('Unexpected directory ownership, permissions or physical path: ' + str(path))


def ensure_directory(path, uid, gid, mode):
    try:
        os.mkdir(path, mode)
    except FileExistsError:
        return False
    # Every parent here is already verified root-owned and inaccessible for writes to other users.
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchown(fd, uid, gid)
        os.fchmod(fd, mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    return True


def inspect_locks(locks):
    require_directory(locks, 0, private=True)
    # A root lease must never open a symlink or hard link, including a leftover lease temporary.
    for name in os.listdir(locks):
        s = os.lstat(locks / name)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or s.st_mode & 0o022:
            refuse('Unsafe object in the existing administrative lease directory')


def prepare_prefix(prefix):
    require_directory(prefix.parent, 0)
    ensure_directory(prefix, 0, 0, 0o755)
    require_directory(prefix, 0)
    locks = prefix / 'locks'
    ensure_directory(locks, 0, 0, 0o700)
    inspect_locks(locks)


def prepare_parents(prefix, account):
    for name in ['artifacts', 'projects']:
        p = prefix / name
        if os.path.lexists(p):
            require_directory(p, account.pw_uid, gid=account.pw_gid)
    for name in ['artifacts', 'projects']:
        p = prefix / name
        ensure_directory(p, account.pw_uid, account.pw_gid, 0o700)
        require_directory(p, account.pw_uid, gid=account.pw_gid)


def lower():
    # The temporary code and arguments are created by the reviewed root launcher.
    # Drop IDs before opening the user's Node executable or any part of its SDK.
    wire = os.environ['PASSIVE_INPUT']
    spec = json.loads(base64.urlsafe_b64decode(wire + '==='))
    u = pwd.getpwnam(spec['user'])
    if u.pw_uid != spec['uid'] or u.pw_uid == 0 or not os.path.isabs(u.pw_dir):
        refuse('Serving account identity changed')
    phase, worker = os.environ['PASSIVE_PHASE'], os.environ['PASSIVE_WORKER']
    if phase not in ('inspect', 'stage'):
        refuse('Invalid passive allocation phase')
    os.initgroups(u.pw_name, u.pw_gid)
    os.setgid(u.pw_gid)
    os.setuid(u.pw_uid)
    os.chdir(u.pw_dir)
    home = pathlib.Path(u.pw_dir) / '.omnitron'
    node = home / 'runtime' / 'releases' / spec['backend'] / 'node'
    env = dict(HOME=u.pw_dir, USER=u.pw_name, LOGNAME=u.pw_name, OMNITRON_HOME=str(home), LANG='C',
               PATH=str(node.parent) + ':/usr/local/bin:/usr/bin:/bin', XDG_RUNTIME_DIR='/run/user/' + str(u.pw_uid))
    os.execve(node, [str(node), worker, phase, wire], env)


def main(wire, payload):
    if os.geteuid() != 0 or sys.platform != 'linux':
        refuse('A registered Linux administrative route is required')
    os.umask(0o077)
    spec = json.loads(base64.urlsafe_b64decode(wire + '==='))
    bundle = json.loads(gzip.decompress(base64.b64decode(payload)))
    account = pwd.getpwnam(spec['user'])
    if account.pw_uid != spec['uid'] or account.pw_uid == 0:
        refuse('Reviewed service UID differs')
    token = str(uuid.uuid4())
    execution = str(uuid.uuid4())
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    scripts = {k: v.replace(TOKEN, token).replace('f17a0000-0000-4000-a000-000000000001', execution)
               .replace('PASSIVE-LEASE-DATE', started) for k, v in bundle['lease'].items()}
    prefix = pathlib.Path('/opt/omnitron')
    with tempfile.TemporaryDirectory(prefix='omnitron-allocation-') as raw:
        d = pathlib.Path(raw)
        worker = d / 'receiver.mjs'
        worker.write_text(bundle['worker'])
        worker.chmod(0o444)
        entry = d / 'entry.py'
        entry.write_text(bundle['entry'])
        entry.chmod(0o400)
        d.chmod(0o711)
        env = dict(PATH=SYSTEM_PATH, LANG='C', PASSIVE_ENTRY=str(entry), PASSIVE_INPUT=wire, PASSIVE_WORKER=str(worker), PASSIVE_PHASE='inspect')
        def native(key):
            result = subprocess.run(['/bin/sh', '-c', scripts[key]], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=40)
            if result.returncode:
                refuse('Administrative deployment lease unavailable')
            return result.stdout.decode().strip()
        subprocess.run(['/usr/bin/python3', '-I', str(entry), 'lower'], env=env, check=True)
        prepare_prefix(prefix)
        answer = native('acquire').splitlines()
        if not answer or answer[-1] != 'ACQUIRED':
            refuse('Administrative node deploy lease is held or needs reconciliation')
        try:
            prepare_parents(prefix, account)
            env['PASSIVE_PHASE'] = 'stage'
            child = subprocess.Popen(['/bin/sh', '-c', scripts['guard']], env=env)
            while True:
                try:
                    status = child.wait(timeout=30)
                    break
                except subprocess.TimeoutExpired:
                    # guard holds the on-node execution lock even when renewal or controller contact is lost.
                    if native('renew') != 'RENEWED':
                        child.wait()
                        refuse('Administrative lease renewal was not confirmed; inspect the completed operation')
            if status:
                refuse('Guarded passive preparation failed; inspect the receiver and deployment lease')
        finally:
            if native('release') != 'RELEASED':
                refuse('Administrative lease release is unconfirmed; reconcile the receiver')


if __name__ == '__main__':
    if sys.argv[1:] == ['lower']:
        lower()
    else:
        main(*sys.argv[1:])
