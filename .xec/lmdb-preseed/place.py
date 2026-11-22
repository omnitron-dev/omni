"""Place a qualified public LMDB at the declared mainnet path before service activation."""
import base64
from contextlib import ExitStack
import ctypes
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys

import omnitron_preseed_channel as ch


SERVICE_DATA = Path('/var/lib/monero/.bitmonero')


def require_inactive(unit):
    probe = subprocess.run(['systemctl', 'show', unit, '-p', 'Id', '-p', 'ActiveState', '-p', 'MainPID'],
                           capture_output=True, text=True, timeout=15)
    fields = dict(line.split('=', 1) for line in probe.stdout.splitlines() if '=' in line)
    ch.require(probe.returncode in (0, 4) and fields.get('Id') == unit and
               fields.get('ActiveState') == 'inactive' and fields.get('MainPID') == '0',
               'The transfer requires an inactive service.')


def place(spec, target, proof):
    os.umask(0o077)
    ch.require(sys.platform == 'linux' and os.geteuid() == 0 and ch.ID.fullmatch(spec['id']) and
               str(SERVICE_DATA) == target and spec['nettype'] == 'mainnet' and
               spec['payload'] == 'monero-lmdb-compact-v1' and
               spec['receiverFingerprint'] == ch.fingerprint(ch.key_text(ch.HOST_KEY)), 'Unexpected data destination.')
    state = ch.physical(ch.ROOT / spec['id'], True)
    with ch.lock(state / 'admin.lock', True):
        prepared = ch.record(state / 'prepare-data-ready.json')
        checked = ch.record(state / 'daemon-checked.json')
        release = ch.record(state / 'daemon-check-intent.json')['release']
        user = pwd.getpwnam('monero')
        uid, gid = user.pw_uid, user.pw_gid
        src = ch.physical(Path(spec['stageParent']), True) / ('monero-data-' + spec['id'])
        expected = checked['fileIdentity']
        ch.require(ch.record(state / 'spec.json') == spec and ch.digest(json.dumps(checked, sort_keys=True).encode()) == proof and
                   checked['native']['nettype'] == 'mainnet' and checked['native']['cleanShutdown'] is True and
                   checked['native']['offline'] is True and checked['sealedSha256'] == ch.record(state / 'sealed.json')['sha256'] and
                   checked['dataDir'] == prepared['dataDir'] == str(src) and checked['binarySha256'] == release['sha256'] and
                   (release['user'], release['uid'], release['gid']) == ('monero', uid, gid) and min(uid, gid) > 0 and
                   Path(user.pw_shell).name in ('false', 'nologin'), 'The verified daemon, directory or service account differs.')
        require_inactive('monerod.service')
        require_inactive('monero-wallet-rpc.service')
        return publish(state, src, SERVICE_DATA, prepared['directoryIdentity'], expected, uid, gid, proof)


def publish(state, src, target, tree_id, expected, uid, gid, proof):
    parent = target.parent
    ch.physical(parent.parent, True)
    if not os.path.lexists(parent):
        previous_mask = os.umask(0o066)
        try:
            parent.mkdir(mode=0o711)
        finally:
            os.umask(previous_mask)
        ch.sync_directory(parent.parent)
    ch.physical(parent, True)
    parent_stat = parent.stat()
    ch.require((parent_stat.st_mode & 0o001 or parent_stat.st_gid == gid and parent_stat.st_mode & 0o010) and
               parent_stat.st_dev == tree_id[0], 'The target needs a traversable protected parent on the same filesystem.')
    intent, ready = state / 'place-data-intent.json', state / 'place-data-ready.json'
    request = {'source': str(src), 'dataDir': str(target), 'proof': proof, 'uid': uid, 'gid': gid,
               'parentIdentity': [parent_stat.st_dev, parent_stat.st_ino], 'treeIdentity': tree_id}
    moved = not os.path.lexists(src)
    if intent.exists():
        ch.require(ch.record(intent) == request, 'Another placement owns this operation.')
    else:
        ch.require(not moved and not os.path.lexists(target) and not ready.exists(), 'Destination or placement already exists.')
    tree = target if moved else src
    ch.require(moved or not os.path.lexists(target), 'The canonical path is occupied.')
    # Open the three reviewed objects before ownership changes. No recursive chown and no link traversal.
    dirflags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    with ExitStack() as handles:
        rootfd = os.open(tree, dirflags)
        handles.callback(os.close, rootfd)
        root = os.fstat(rootfd)
        owners = {(0, 0), (uid, gid)}
        ch.require([root.st_dev, root.st_ino] == tree_id and stat.S_IMODE(root.st_mode) == 0o700 and
                   (root.st_uid, root.st_gid) in owners and os.listdir(rootfd) == ['lmdb'], 'Unexpected root of the public database.')
        lmdb = os.open('lmdb', dirflags, dir_fd=rootfd)
        handles.callback(os.close, lmdb)
        dbdir = os.fstat(lmdb)
        ch.require(stat.S_IMODE(dbdir.st_mode) == 0o700 and (dbdir.st_uid, dbdir.st_gid) in owners and
                   os.listdir(lmdb) == ['data.mdb'], 'Unexpected contents of the public database directory.')
        data = os.open('data.mdb', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=lmdb)
        handles.callback(os.close, data)
        st = os.fstat(data)
        signature = list(ch.signature(st))
        ch.require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and stat.S_IMODE(st.st_mode) == 0o600 and
                   (st.st_uid, st.st_gid) in owners and signature[:4] == expected[:4], 'The qualified mainnet file changed.')
        if ready.exists():
            receipt = ch.record(ready)
            ch.require(moved and signature == receipt['fileIdentity'] and (st.st_uid, st.st_gid) == (uid, gid) and
                       (dbdir.st_uid, dbdir.st_gid) == (uid, gid) and receipt['placement'] == request,
                       'The published mainnet file differs from its receipt.')
        else:
            ch.require(root.st_uid == 0 and (st.st_uid == uid and moved or signature == expected),
                       'The data changed before it was handed to the service.')
            if not intent.exists():
                ch.write_record(intent, request)
            if not moved:
                libc = ctypes.CDLL(None, use_errno=True)
                ch.require(libc.renameat2(-100, os.fsencode(src), -100, os.fsencode(target), 1) == 0,
                           'The destination could not be reserved atomically.')
            ch.sync_directory(src.parent)
            ch.sync_directory(parent)
            for fd in (data, lmdb):
                s = os.fstat(fd)
                if (s.st_uid, s.st_gid) != (uid, gid):
                    os.fchown(fd, uid, gid)
                os.fsync(fd)
            receipt = {'placement': request, 'fileIdentity': list(ch.signature(os.fstat(data)))}
            ch.write_record(ready, receipt)
        if (root.st_uid, root.st_gid) != (uid, gid):
            os.fchown(rootfd, uid, gid)
        os.fsync(rootfd)
        return receipt


if __name__ == '__main__':
    try:
        print(json.dumps(place(*(json.loads(base64.b64decode(v, validate=True)) for v in sys.argv[1:])), sort_keys=True))
    except ch.Refusal as error:
        sys.exit(str(error))
    except (OSError, KeyError, ValueError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        sys.exit('Passive data placement refused (' + type(error).__name__ + ').')
