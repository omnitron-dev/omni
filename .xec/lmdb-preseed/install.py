"""Install a checked Linux helper from separately reviewed bounded chunks. Only root writes here."""
import base64
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import sys
import tempfile


def ensure(condition):
    if not condition:
        raise ValueError('Rejected')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def real_directory(path):
    ensure(path.resolve(strict=True) == path)
    for p in [path, *path.parents]:
        st = p.lstat()
        ensure(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022)


def sync_dir(directory):
    fd = os.open(directory, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def checked(file, mode, limit):
    st = file.lstat()
    ensure(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and stat.S_IMODE(st.st_mode) == mode and 0 < st.st_size <= limit)
    return file.read_bytes()


def publish(file, data, mode):
    fd, name = tempfile.mkstemp(dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            os.fchmod(out.fileno(), mode)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, file)
        sync_dir(file.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def main(machine, pin, expected, action, *args):
    os.umask(0o077)
    pattern = re.compile('[0-9a-f]{64}\\Z')
    ensure(os.geteuid() == 0 and platform.machine() == machine and pattern.fullmatch(expected))
    alg, encoded = Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[:2]
    raw = base64.b64decode(encoded, validate=True)
    ensure(alg == 'ssh-ed25519' and len(raw) == 51 and raw[:19] == b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' and
           'SHA256:' + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=') == pin)
    root = Path('/var/lib/omnitron-lmdb-tools')
    root.mkdir(mode=0o700, exist_ok=True)
    real_directory(root)
    dest, parts = root / expected, root / ('parts-' + expected)
    lock = os.open(root / '.install.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        present = os.path.lexists(dest)
        if present:
            ensure(sha(checked(dest, 0o500, 1048576)) == expected)
        if action == 'part':
            digest, text = args
            chunk = base64.b64decode(text, validate=True)
            ensure(pattern.fullmatch(digest) and 0 < len(chunk) <= 6144 and sha(chunk) == digest)
            if not present:
                parts.mkdir(mode=0o700, exist_ok=True)
                real_directory(parts)
                item = parts / digest
                if os.path.lexists(item):
                    ensure(sha(checked(item, 0o600, 6144)) == digest)
                else:
                    publish(item, chunk, 0o600)
        elif action == 'finish':
            digests = args[0].split(',')
            ensure(len(args) == 1 and 0 < len(digests) <= 172 and all(pattern.fullmatch(d) for d in digests))
            if not present:
                real_directory(parts)
                chunks = [checked(parts / d, 0o600, 6144) for d in digests]
                ensure(all(sha(chunk) == d for chunk, d in zip(chunks, digests)))
                binary = gzip.decompress(b''.join(chunks))
                arch = {'x86_64': 62, 'aarch64': 183}[machine]
                ensure(64 <= len(binary) <= 1048576 and binary[:6] == b'\x7fELF\x02\x01' and int.from_bytes(binary[18:20], 'little') == arch and sha(binary) == expected)
                publish(dest, binary, 0o500)
            if os.path.lexists(parts):
                real_directory(parts)
                for digest in set(digests):
                    (parts / digest).unlink(missing_ok=True)
                parts.rmdir()
                sync_dir(root)
        else:
            raise ValueError('action')
        print(json.dumps({'helperSha256': expected, 'phase': action, 'alreadyInstalled': present}))
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main(*sys.argv[1:])
    except Exception as error:
        sys.exit('Snapshot helper verification failed (' + type(error).__name__ + ').')
