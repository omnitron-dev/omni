"""Read only the prepared public units. The canonical service configs are stat'd, never opened."""
import base64
import contextlib
import grp
import hashlib
import json
import os
from pathlib import PurePosixPath
import pwd
import re
import stat
import subprocess
import sys
import time


def require(value, message):
    if not value:
        raise ValueError(message)


@contextlib.contextmanager
def directory(parts):
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open('/', flags)
    try:
        for part in parts:
            require(part not in ('', '.', '..') and '/' not in part, 'Invalid path component')
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
            st = os.fstat(fd)
            require(st.st_uid == 0 and not (st.st_mode & 0o022), 'An ancestor is not controlled by root')
        yield fd
    finally:
        os.close(fd)


def unit_hash(folder, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
    with os.fdopen(fd, 'rb') as stream:
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_uid == 0 and
                not (st.st_mode & 0o022) and 0 < st.st_size <= 128 * 1024, 'Invalid staged public unit')
        content = stream.read(128 * 1024 + 1)
        after = os.fstat(fd)
        require(len(content) == st.st_size and st.st_ctime_ns == after.st_ctime_ns, 'Public unit changed during observation')
        return hashlib.sha256(content).hexdigest()


def target_metadata(path):
    parts = PurePosixPath(path).parts[1:]
    try:
        with directory(parts[:-1]) as parent:
            entry = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return {'present': False}
    return {'present': True, 'regular': stat.S_ISREG(entry.st_mode), 'uid': entry.st_uid,
            'gid': entry.st_gid, 'mode': format(stat.S_IMODE(entry.st_mode), '04o')}


def unit_state(unit):
    fields = ['LoadState', 'ActiveState', 'UnitFileState', 'MainPID', 'FragmentPath', 'DropInPaths']
    result = subprocess.run(['/usr/bin/systemctl', 'show', unit, '--property=' + ','.join(fields)],
                            capture_output=True, timeout=5, env={'LC_ALL': 'C', 'PATH': '/usr/bin:/bin'})
    # systemctl show returns 4 for not-found on some systemd releases; its properties are the evidence.
    require(result.returncode in (0, 4) and len(result.stdout) <= 8192, 'Systemd state unavailable')
    seen = dict(line.split('=', 1) for line in result.stdout.decode('utf-8').splitlines() if '=' in line)
    require(set(seen) == set(fields), 'Systemd omitted a requested property')
    return {'load': seen['LoadState'], 'active': seen['ActiveState'], 'enablement': seen['UnitFileState'],
            'pidZero': seen['MainPID'] == '0', 'hasFragment': bool(seen['FragmentPath']), 'hasDropIns': bool(seen['DropInPaths'])}


PROFILES = [('bitcoin', 'bitcoind.service', 'bitcoin', '/etc/bitcoin/bitcoin.conf'),
            ('monero-daemon', 'monerod.service', 'monero', '/etc/monero/monerod.conf'),
            ('monero-wallet-rpc', 'monero-wallet-rpc.service', 'monero-wallet', '/etc/monero/monero-wallet-rpc.conf')]


def observe(spec):
    review, stage = spec['review'], spec['stage']
    require(int(time.time()) < spec['validUntil'] <= int(time.time()) + 3600, 'Observation expired')
    require(re.fullmatch(r'/srv/[A-Za-z0-9_-]+/host-units-[a-f0-9]{8,40}', stage) and
            review['commit'].startswith(stage.rsplit('-', 1)[1]), 'Incorrect public unit stage')
    names = [(b['name'], b['unit'], b['user'], b['config']) for b in review['bindings']]
    require(names == PROFILES, 'Unapproved service path or user')
    with open('/etc/ssh/ssh_host_ed25519_key.pub', encoding='ascii') as stream:
        kind, key = stream.read(2048).split()[:2]
    pin = 'SHA256:' + base64.b64encode(hashlib.sha256(base64.b64decode(key, validate=True)).digest()).decode().rstrip('=')
    require(kind == 'ssh-ed25519' and pin == review['sshFingerprint'], 'Recipient identity changed')
    accounts = set()
    groups = set()
    results = []
    with directory(PurePosixPath(stage).parts[1:]) as fd:
        for binding in review['bindings']:
            name, unit, user, config = (binding[k] for k in ('name', 'unit', 'user', 'config'))
            require(unit_hash(fd, unit) == binding['unitSha256'], 'Staged public unit differs from release')
            account = pwd.getpwnam(user)
            primary = grp.getgrgid(account.pw_gid)
            extra = set(os.getgrouplist(user, account.pw_gid)) - {account.pw_gid}
            require(account.pw_uid > 0 and account.pw_gid > 0 and account.pw_uid not in accounts and
                    account.pw_gid not in groups and primary.gr_name == user and not extra and
                    account.pw_shell in ('/usr/sbin/nologin', '/sbin/nologin', '/bin/false', '/usr/bin/false'),
                    'A dedicated non-login service account is required')
            accounts.add(account.pw_uid)
            groups.add(account.pw_gid)
            current = unit_state(unit)
            unit_path = target_metadata('/etc/systemd/system/' + unit)
            config_path = target_metadata(config)
            clear = (current == {'load': 'not-found', 'active': 'inactive', 'enablement': '', 'pidZero': True,
                                'hasFragment': False, 'hasDropIns': False} and
                     not unit_path['present'] and not config_path['present'])
            results.append({'service': name, 'unitSha256': binding['unitSha256'], 'uid': account.pw_uid,
                            'gid': account.pw_gid, 'systemd': current, 'unitPath': unit_path,
                            'configPath': config_path, 'freshDestination': clear})
    return {'protocol': 1, 'basis': spec['basis'], 'review': review['digest'], 'nodeId': review['nodeId'], 'bindings': results,
            'freshDestination': all(item['freshDestination'] for item in results), 'observedAt': int(time.time())}


if __name__ == '__main__':
    try:
        report = observe(json.loads(base64.b64decode(sys.argv[1], validate=True)))
        print(json.dumps(report), flush=True)
        sys.exit(0 if report['freshDestination'] else 1)
    except (OSError, ValueError, KeyError, IndexError, TypeError, subprocess.SubprocessError):
        sys.exit('Passive host binding evidence is incomplete; no service files were changed')
