"""The four controller SQLite stores. Names in a transport are fixed aliases, never supplied paths."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import tempfile

DATABASES = (('data', 'daemon-state.db'), ('data', 'slave.db'), ('runtime', 'state.db'), ('execution', 'state.db'))
SUFFIXES = ('', '-wal', '-shm', '-journal')
SLOTS = {f'd{n}{suffix}': (folder, name + suffix)
         for n, (folder, name) in enumerate(DATABASES) for suffix in SUFFIXES}
MAINS = tuple(f'd{n}' for n in range(len(DATABASES)))
BLOCK = 2 ** 20
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
READ = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


class Refused(ValueError):
    pass


def require(value, reason):
    if not value:
        raise Refused(reason)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def available(path):
    v = os.statvfs(path)
    return v.f_bavail * v.f_frsize


def signature(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mode, st.st_uid, st.st_gid, st.st_mtime_ns, st.st_ctime_ns)


def regular(st, uid, device):
    require(stat.S_ISREG(st.st_mode) and st.st_uid == uid and st.st_dev == device and st.st_nlink == 1
            and not st.st_mode & 0o022, 'Unsafe SQLite file identity')


@contextlib.contextmanager
def controller(home, uid):
    require(home.is_absolute() and home.resolve(strict=True) == home, 'Controller home must be physical')
    for parent in (home, *home.parents):
        st = parent.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid in (0, uid) and not st.st_mode & 0o022,
                'Controller home has an unsafe ancestor')
    with contextlib.ExitStack() as done:
        root = os.open(home, DIRECTORY)
        done.callback(os.close, root)
        st = os.fstat(root)
        require(st.st_uid == uid and not st.st_mode & 0o022, 'Controller home permits another writer')
        dirs = {}
        for folder, _ in DATABASES:
            if folder in dirs:
                continue
            fd = os.open(folder, DIRECTORY, dir_fd=root)
            done.callback(os.close, fd)
            folder_stat = os.fstat(fd)
            require(folder_stat.st_uid == uid and not folder_stat.st_mode & 0o022 and folder_stat.st_dev == st.st_dev,
                    'Unexpected controller database directory')
            dirs[folder] = fd
        yield dirs, st.st_dev
        require(os.path.samestat(st, home.lstat()), 'Controller home changed')
        for folder, fd in dirs.items():
            require(os.path.samestat(os.fstat(fd), os.stat(folder, dir_fd=root, follow_symlinks=False)),
                    'Controller database directory changed')


def inventory(dirs, device, uid, *, mains_only=False, missing_mains=False):
    rows = {}
    seen = set()
    for slot in (MAINS if mains_only else SLOTS):
        folder, name = SLOTS[slot]
        try:
            st = os.stat(name, dir_fd=dirs[folder], follow_symlinks=False)
        except FileNotFoundError:
            require(slot not in MAINS or missing_mains, 'A required controller database is absent')
            continue
        regular(st, uid, device)
        require((st.st_dev, st.st_ino) not in seen, 'A controller file has an unexpected alias')
        seen.add((st.st_dev, st.st_ino))
        rows[slot] = st
    return rows


def hash_at(directory, name, st):
    fd = os.open(name, READ, dir_fd=directory)
    with os.fdopen(fd, 'rb') as src:
        require(signature(os.fstat(fd)) == signature(st), 'SQLite file changed before hashing')
        h = hashlib.sha256()
        for data in iter(lambda: src.read(BLOCK), b''):
            h.update(data)
        require(signature(os.fstat(fd)) == signature(st), 'SQLite file changed while hashing')
        return h.hexdigest()


def manifest(dirs, stats):
    rows = {}
    for slot, st in stats.items():
        folder, name = SLOTS[slot]
        rows[slot] = {'bytes': st.st_size, 'sha256': hash_at(dirs[folder], name, st),
                      'mode': stat.S_IMODE(st.st_mode), 'uid': st.st_uid, 'gid': st.st_gid, 'mtimeNs': str(st.st_mtime_ns)}
    return rows


def check_manifest(rows, spec):
    import re
    require(isinstance(rows, dict) and set(MAINS) <= rows.keys() <= SLOTS.keys(), 'Incorrect SQLite family')
    for v in rows.values():
        require(isinstance(v, dict) and set(v) == {'bytes', 'sha256', 'mode', 'uid', 'gid', 'mtimeNs'}
                and type(v['bytes']) is int and 0 <= v['bytes'] <= spec['maxBytes']
                and isinstance(v['sha256'], str) and re.fullmatch('[0-9a-f]{64}', v['sha256'])
                and type(v['mode']) is int and 0 <= v['mode'] <= 0o777 and not v['mode'] & 0o022
                and type(v['uid']) is int and v['uid'] == spec['sourceUid']
                and type(v['gid']) is int and 0 <= v['gid'] < 2 ** 32 - 1,
                'Malformed controller file receipt')
        require(isinstance(v['mtimeNs'], str) and re.fullmatch(r'-?(0|[1-9][0-9]{0,18})', v['mtimeNs'])
                and -(2 ** 63) <= int(v['mtimeNs']) < 2 ** 63, 'Malformed original modification time')
    require(sum(row['bytes'] for row in rows.values()) <= spec['maxBytes'], 'Controller snapshot exceeds its grant')


def verify_raw(stage, rows, *, extra=()):
    require(set(os.listdir(stage)) == set(rows) | set(extra), 'Staged SQLite file set differs')
    fd = os.open(stage, DIRECTORY)
    try:
        for slot, row in rows.items():
            st = os.stat(slot, dir_fd=fd, follow_symlinks=False)
            require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size == row['bytes']
                    and hash_at(fd, slot, st) == row['sha256'], 'Staged SQLite bytes differ')
    finally:
        os.close(fd)


def check_recovery(stage, rows, scratch_parent, reserve):
    """SQLite can checkpoint, rewrite SHM, and consume a hot journal only on the independent copy."""
    committed = 0
    for main in MAINS:
        family = [name for name in rows if name == main or name.startswith(main + '-')]
        total = sum(rows[name]['bytes'] for name in family)
        # A complete final WAL can extend the main database. Temporary verification stays on the receiver.
        require(available(scratch_parent) >= 2 * total + reserve, 'Insufficient room for independent SQLite recovery')
        with tempfile.TemporaryDirectory(dir=scratch_parent, prefix='.check-controller-sqlite-') as tmp:
            directory = Path(tmp)
            for slot in family:
                if slot == main + '-shm':
                    continue
                with (stage / slot).open('rb') as src, (directory / slot).open('xb') as dest:
                    shutil.copyfileobj(src, dest, BLOCK)
            with (directory / main).open('rb') as source:
                require(source.read(16) == b'SQLite format 3\x00', 'Expected an existing SQLite database')
            with contextlib.closing(sqlite3.connect((directory / main).as_uri() + '?mode=rw', uri=True)) as db:
                db.execute('PRAGMA trusted_schema=OFF')
                db.execute('PRAGMA cell_size_check=ON')
                require(db.execute('PRAGMA page_count').fetchone()[0] > 0
                        and db.execute('SELECT 1 FROM sqlite_schema LIMIT 1').fetchone() == (1,),
                        'Expected an initialized controller store')
                require(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'SQLite integrity check refused the restored state')
                busy, frames, checkpointed = db.execute('PRAGMA wal_checkpoint(FULL)').fetchone()
                require(busy == 0 and frames == checkpointed, 'Independent SQLite checkpoint did not complete')
                committed += max(0, frames)
    return committed


def bound_for_restore(rows, current, filesystem_block):
    return sum(max(0, ((v['bytes'] + filesystem_block - 1) // filesystem_block) * filesystem_block
                   - (current[k].st_blocks * 512 if k in current else 0)) for k, v in rows.items())


def unlocked(stats, locks=Path('/proc/locks')):
    reviewed = {(os.major(st.st_dev), os.minor(st.st_dev), st.st_ino) for st in stats.values()}
    with locks.open() as table:
        for line in table:
            for field in line.split():
                identity = field.split(':')
                if len(identity) == 3:
                    try:
                        key = (int(identity[0], 16), int(identity[1], 16), int(identity[2]))
                    except ValueError:
                        continue
                    require(key not in reviewed, 'A controller database or sidecar still has a kernel file lock')
