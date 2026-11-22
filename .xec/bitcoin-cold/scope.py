"""Disk layout and clean-shutdown contract for Bitcoin Core 31.x -> 32.1."""

import contextlib
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HASH = re.compile(r'[0-9a-f]{64}\Z')
UUID = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z')
SEGMENT = re.compile(r'(?:blk|rev)[0-9]{5}\.dat\Z')
TABLE = re.compile(r'(?:[0-9]{6,20}\.(?:ldb|sst|log)|MANIFEST-[0-9]{6,20}|CURRENT)\Z')
FILTER = re.compile(r'fltr[0-9]{5}\.dat\Z')
INDEXES = {
    'txindex': 'indexes/txindex',
    'txospenderindex': 'indexes/txospenderindex',
    'coinstatsindex': 'indexes/coinstatsindex/db',
    'blockfilter': 'indexes/blockfilter/basic/db',
}
FIELDS = set(
    'id sourceNode receiverNode sourceIp receiverIp sourceFingerprint receiverFingerprint receiverPort stageParent rateKiB ttlMinutes hotId hotManifest dataDir blocks sourceUnit sourceBootId sourceStartUsec chain pruneMiB indexes anchorHeight anchorHash candidateParent targetUser targetUid targetGid'.split()
)
MAX_FILE = 16 * 1024**3
CHUNK = 1024**2


class Refused(ValueError):
    pass


def need(ok, message):
    if not ok:
        raise Refused(message)


def absolute(p):
    return (
        isinstance(p, str)
        and re.fullmatch(r'/[a-zA-Z0-9_./ -]{1,1023}', p)
        and str(Path(p)) == p
        and '..' not in Path(p).parts
        and p != '/'
    )


def validate(s):
    need(
        set(s) == FIELDS
        and UUID.fullmatch(s['id'])
        and UUID.fullmatch(s['hotId'])
        and s['hotId'] != s['id']
        and HASH.fullmatch(s['hotManifest'])
        and HASH.fullmatch(s['anchorHash']),
        'Invalid operation, hot manifest or anchor.',
    )
    for side in ('source', 'receiver'):
        node = s[side + 'Node']
        pin = s[side + 'Fingerprint']
        ip = ipaddress.IPv4Address(s[side + 'Ip'])
        need(
            re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', node)
            and node != 'local'
            and re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', pin)
            and not (ip.is_unspecified or ip.is_multicast or ip.is_loopback)
            and str(ip) != '255.255.255.255',
            'Invalid registered host or direct IPv4 endpoint.',
        )
    need(
        all(s['source' + k] != s['receiver' + k] for k in ('Node', 'Fingerprint', 'Ip')),
        'Cold endpoints must be distinct.',
    )
    need(
        all(absolute(s[k]) for k in ('dataDir', 'blocks', 'stageParent', 'candidateParent'))
        and Path(s['blocks']).name == 'blocks'
        and s['candidateParent'] != s['dataDir']
        and not Path(s['candidateParent']).is_relative_to(Path(s['dataDir'])),
        'Invalid physical directories.',
    )
    need(
        re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9@_.-]{0,100}\.service', s['sourceUnit'])
        and re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', s['sourceBootId'])
        and re.fullmatch(r'[1-9][0-9]{0,19}', s['sourceStartUsec']),
        'Missing exact source systemd invocation.',
    )
    need(
        s['chain'] in ('main', 'regtest')
        and isinstance(s['indexes'], list)
        and s['indexes'] == sorted(set(s['indexes']))
        and set(s['indexes']) <= INDEXES.keys(),
        'Unsupported chain or index layout.',
    )
    for key, low, high in [
        ('anchorHeight', 1, 2**32 - 1),
        ('pruneMiB', 0, 2**31 - 1),
        ('targetUid', 1, 2**31 - 1),
        ('targetGid', 1, 2**31 - 1),
        ('rateKiB', 1, 1048576),
        ('ttlMinutes', 1, 1440),
        ('receiverPort', 1, 65535),
    ]:
        need(type(s[key]) is int and low <= s[key] <= high, 'Invalid numeric bound.')
    need(s['pruneMiB'] in (0, 1) or s['pruneMiB'] >= 550, 'Invalid Core pruning size.')
    need(re.fullmatch(r'[a-z_][a-z0-9_-]{0,30}', s['targetUser']), 'Invalid target service user.')


def physical(directory):
    need(
        directory.is_absolute()
        and directory.resolve(strict=True) == directory
        and stat.S_ISDIR(directory.lstat().st_mode),
        'A physical directory with no symlink components is required.',
    )
    return directory


def identity(st):
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns


def regular(path):
    need(path.is_absolute() and '..' not in path.parts, 'A physical absolute file is required.')
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        try:
            fd = os.open(path.name, flags | getattr(os, 'O_NOATIME', 0), dir_fd=directory)
        except PermissionError:
            fd = os.open(path.name, flags, dir_fd=directory)
    finally:
        os.close(directory)
    try:
        s = os.fstat(fd)
        need(
            stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 <= s.st_size <= MAX_FILE,
            'Unsupported file type, links or size.',
        )
        return os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise


def inspect(path, on_block=None, expected=None, remember=None):
    with regular(path) as f:
        before = identity(os.fstat(f.fileno()))
        need(
            expected is None or tuple(expected) == before,
            'Source inode or modification time changed since the reviewed offer.',
        )
        h = hashlib.sha256()
        size = 0
        while True:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            size += len(chunk)
            need(size <= before[2], 'An input grew during inspection.')
            h.update(chunk)
            if on_block:
                on_block(chunk)
        need(
            identity(os.fstat(f.fileno())) == identity(path.lstat()) == before and size == before[2],
            'Cold input identity or bytes changed.',
        )
        if remember is not None:
            remember.extend(before)
        return (size, h.hexdigest())


def require_stopped(s):
    fields = [
        'Id',
        'LoadState',
        'ActiveState',
        'SubState',
        'Result',
        'MainPID',
        'ExecMainCode',
        'ExecMainStatus',
        'ExecMainStartTimestampMonotonic',
        'ExecMainExitTimestampMonotonic',
    ]
    p = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--no-pager', '--property=' + ','.join(fields), '--', s['sourceUnit']],
        capture_output=True,
        timeout=15,
    )
    need(p.returncode == 0, 'Systemd could not attest the source stop.')
    state = dict(line.split('=', 1) for line in p.stdout.decode().splitlines())
    expected = dict(
        Id=s['sourceUnit'],
        LoadState='loaded',
        ActiveState='inactive',
        SubState='dead',
        Result='success',
        MainPID='0',
        ExecMainCode='1',
        ExecMainStatus='0',
        ExecMainStartTimestampMonotonic=s['sourceStartUsec'],
    )
    need(
        Path('/proc/sys/kernel/random/boot_id').read_text().strip() == s['sourceBootId']
        and all(state.get(k) == v for k, v in expected.items())
        and int(state['ExecMainExitTimestampMonotonic']) >= int(s['sourceStartUsec']),
        'A clean exit of the reviewed bitcoind invocation is required.',
    )
    return state['ExecMainExitTimestampMonotonic']


def db_dirs(s):
    return ['blocks/index', 'chainstate'] + [INDEXES[name] for name in s['indexes']]


@contextlib.contextmanager
def fenced(s):
    # Core and LevelDB use POSIX F_SETLK. A shared lock on an existing O_RDONLY inode
    # fences competing writers without creating or changing a file in the donor tree.
    exit_stamp = require_stopped(s)
    root = physical(Path(s['dataDir']))
    directories = [physical(root / k) for k in db_dirs(s)]
    with contextlib.ExitStack() as stack:
        held = []
        for p in [root / '.lock', physical(Path(s['blocks'])) / '.lock', *(d / 'LOCK' for d in directories)]:
            f = stack.enter_context(regular(p))
            try:
                fcntl.lockf(f.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Refused('Bitcoin Core or LevelDB still holds an exclusive source lock.') from None
            held.append((p, identity(os.fstat(f.fileno()))))
        yield
        need(
            all(identity(p.lstat()) == initial for p, initial in held) and require_stopped(s) == exit_stamp,
            'Source stop or locks changed during cold inspection.',
        )


def permitted(s, name):
    directory, _, leaf = name.rpartition('/')
    return (
        (directory == 'blocks' and (SEGMENT.fullmatch(leaf) or leaf == 'xor.dat'))
        or (directory in db_dirs(s) and TABLE.fullmatch(leaf))
        or (
            'blockfilter' in s['indexes']
            and directory == 'indexes/blockfilter/basic'
            and FILTER.fullmatch(leaf)
        )
    )


def files(s):
    root, raw = physical(Path(s['dataDir'])), physical(Path(s['blocks']))
    need(
        not any(os.path.lexists(root / n) for n in ('chainstate_snapshot', 'chainstate_todelete')),
        'Parallel or pending-removal AssumeUTXO chainstates require separate admission.',
    )
    idx = root / 'indexes'
    actual = {p.name for p in physical(idx).iterdir()} if os.path.lexists(idx) else set()
    need(actual == set(s['indexes']), 'On-disk optional indexes differ from the review.')
    out = {'blocks/' + p.name: p for p in raw.iterdir() if SEGMENT.fullmatch(p.name)}
    need(
        any(k.startswith('blocks/blk') for k in out) and any(k.startswith('blocks/rev') for k in out),
        'Missing cold block or undo family.',
    )
    xor_path = raw / 'xor.dat'
    with regular(xor_path) as xor:
        key = xor.read(9)
        need(len(key) == 8, 'The source requires its exact eight-byte XOR file.')
    magic = {'main': bytes.fromhex('f9beb4d9'), 'regtest': bytes.fromhex('fabfb5da')}[s['chain']]
    last = {
        family: max(p.name for p in out.values() if p.name.startswith(family)) for family in ('blk', 'rev')
    }
    for path in out.values():
        family = path.name[:3]
        with regular(path) as stream:
            size = os.fstat(stream.fileno()).st_size
            if size == 0:
                need(path.name == last[family], 'An empty historic raw segment is unverified.')
                continue
            header = bytes(b ^ k for b, k in zip(stream.read(8), key))
            length = int.from_bytes(header[4:], 'little')
            need(
                len(header) == 8
                and header[:4] == magic
                and (80 if family == 'blk' else 1) <= length <= min(size - 8, 16 * 1024**2),
                'A raw segment header differs from the reviewed network, size or XOR file.',
            )
    out['blocks/xor.dat'] = xor_path
    if 'blockfilter' in s['indexes']:
        filters = physical(root / 'indexes/blockfilter/basic')
        need(
            {p.name for p in physical(root / 'indexes/blockfilter').iterdir()} == {'basic'}
            and all(p.name == 'db' or FILTER.fullmatch(p.name) for p in filters.iterdir()),
            'Unsupported filter index layout.',
        )
        out.update(
            {'indexes/blockfilter/basic/' + p.name: p for p in filters.iterdir() if FILTER.fullmatch(p.name)}
        )
    if 'coinstatsindex' in s['indexes']:
        need(
            {p.name for p in physical(root / 'indexes/coinstatsindex').iterdir()} == {'db'},
            'Unsupported coinstats index layout.',
        )
    for relative in db_dirs(s):
        db = physical(root / relative)
        with regular(db / 'CURRENT') as current:
            content = current.read(128)
        need(
            re.fullmatch(rb'MANIFEST-[0-9]{6,20}\n', content) and (db / content[:-1].decode()).is_file(),
            'LevelDB CURRENT does not identify a manifest.',
        )
        for p in db.iterdir():
            if TABLE.fullmatch(p.name):
                out[relative + '/' + p.name] = p
            else:
                need(p.name in ('LOCK', 'LOG', 'LOG.old'), 'Unsupported LevelDB entry.')
    need(len(out) <= 200000, 'Cold inventory exceeds its limit.')
    return dict(sorted(out.items()))


def target_layout(s, directory):
    root = physical(directory / 'regtest') if s['chain'] == 'regtest' else physical(directory)
    if root != directory:
        need(
            {p.name for p in directory.iterdir()} == {'regtest'},
            'Unexpected entry outside the network data directory.',
        )
    allowed = {
        '.lock',
        'blocks',
        'chainstate',
        'indexes',
        'peers.dat',
        'banlist.json',
        'anchors.dat',
        'fee_estimates.dat',
        'fees',
        'netgroup.map',
    }
    need(
        {p.name for p in root.iterdir()} <= allowed,
        'Installed data contains files outside a public chain handoff.',
    )
    raw = physical(root / 'blocks')
    need(
        all(p.name in ('.lock', 'index', 'xor.dat') or SEGMENT.fullmatch(p.name) for p in raw.iterdir()),
        'Unexpected raw block directory entry.',
    )
    for p in root.iterdir():
        if p.name in ('blocks', 'indexes', 'chainstate'):
            physical(p)
        elif p.name == 'fees':
            need(
                all(
                    x.name in ('mempool_policy_estimator.dat', 'block_policy_estimates.dat')
                    and stat.S_ISREG(x.lstat().st_mode)
                    and x.lstat().st_nlink == 1
                    for x in physical(p).iterdir()
                ),
                'Unexpected local fee directory entry.',
            )
        else:
            need(stat.S_ISREG(p.lstat().st_mode) and p.lstat().st_nlink == 1, 'Unexpected local file type.')
    for p in [raw / '.lock', *(root / d / n for d in db_dirs(s) for n in ('LOCK', 'LOG', 'LOG.old'))]:
        if os.path.lexists(p):
            st = p.lstat()
            need(stat.S_ISREG(st.st_mode) and st.st_nlink == 1, 'Unexpected local database file type.')
    entries = files(dict(s, dataDir=str(root), blocks=str(raw)))
    proof = []
    for name, path in entries.items():
        st = path.lstat()
        need(
            stat.S_ISREG(st.st_mode) and st.st_nlink == 1,
            'A public candidate file has changed type or links.',
        )
        proof.append([name, *identity(st)])
    return hashlib.sha256(json.dumps(proof, separators=(',', ':')).encode()).hexdigest()


@contextlib.contextmanager
def target_tree(s, directory):
    root = physical(directory / 'regtest') if s['chain'] == 'regtest' else physical(directory)
    # User configuration, authentication and wallets are never moved by this empty-target publication.
    with contextlib.ExitStack() as stack:
        for p in [root / '.lock', root / 'blocks/.lock', *(root / d / 'LOCK' for d in db_dirs(s))]:
            f = stack.enter_context(regular(p))
            fcntl.lockf(f.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        yield target_layout(s, directory)


if __name__ == '__main__':
    validate(json.load(sys.stdin))
