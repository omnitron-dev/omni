"""Open only the new candidate with a pinned official Core 32.1, on isolated loopback."""

import bitcoin_cold_scope as scope
import base64
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import shutil
import signal
import socket
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time

ARCHIVE = {
    'x86_64': '61545c17c3120fb7412f896d248b11993af04ec8817aad3649c55b2afb044963',
    'aarch64': '7ed37c7373eb6aa3e3f72842596a1afeba1b223717033cade9842b25773e1922',
}
INSTALLED_X86 = {
    'bitcoind': '580ac61190154da31aac3f82d13c4254ef453d70e1bf2c39d338dac5129c92ac',
    'bitcoin-cli': '83dad233fb62b1b2931efd446f7c66fe02585055143e0f0087c742732c75b52d',
}
INDEX = {
    'txindex': 'txindex',
    'txospenderindex': 'txospenderindex',
    'coinstatsindex': 'coinstatsindex',
    'blockfilter': 'basic block filter index',
}


def need(v, msg):
    if not v:
        raise ValueError(msg)


def trust_dir(p):
    for d in (p, *p.parents):
        s = d.lstat()
        need(
            stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
            'Unsafe root-owned directory.',
        )


def network():
    libc = ctypes.CDLL(None, use_errno=True)
    # On a host create a new namespace. An existing Linux sandbox may already
    # have loopback as its only interface and deny creation of nested namespaces.
    if libc.unshare(0x40000000) != 0:
        need([name for _, name in socket.if_nameindex()] == ['lo'], 'Cannot isolate validation network.')
    need([name for _, name in socket.if_nameindex()] == ['lo'], 'Validation requires loopback alone.')
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        device = struct.pack('16sH14x', b'lo', 0)
        flags = struct.unpack('16sH14x', fcntl.ioctl(sock.fileno(), 0x8913, device))[1]
        if not flags & 1:
            fcntl.ioctl(sock.fileno(), 0x8914, struct.pack('16sH14x', b'lo', flags | 1))


def extract(archive, machine, dest):
    trust_dir(archive.parent)
    with os.fdopen(os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as f:
        st = os.fstat(f.fileno())
        need(
            stat.S_ISREG(st.st_mode)
            and st.st_uid == 0
            and not st.st_mode & 0o022
            and st.st_size < 256 * 1024**2,
            'An immutable root-owned official archive is required.',
        )
        h = hashlib.sha256()
        for part in iter(lambda: f.read(1024**2), b''):
            h.update(part)
        need(h.hexdigest() == ARCHIVE[machine], 'Official Bitcoin Core 32.1 archive digest differs.')
        f.seek(0)
        with tarfile.open(fileobj=f, mode='r:gz') as tar:
            for rel in ('bin/bitcoind', 'bin/bitcoin-cli', 'libexec/bitcoin-node'):
                m = tar.getmember('bitcoin-32.1/' + rel)
                need(m.isfile() and 0 < m.size < 128 * 1024**2, 'Unexpected official executable entry.')
                output = dest / rel
                output.parent.mkdir(mode=0o755, exist_ok=True)
                os.chmod(output.parent, 0o755)
                with tar.extractfile(m) as src, output.open('xb') as out:
                    shutil.copyfileobj(src, out, 1024**2)
                os.chmod(output, 0o555)
        end = os.fstat(f.fileno())
        need(
            (st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
            == (end.st_ino, end.st_size, end.st_mtime_ns, end.st_ctime_ns),
            'Official archive changed during extraction.',
        )


def installed(directory, dest):
    trust_dir(directory)
    output = dest / 'bin'
    output.mkdir(mode=0o755)
    os.chmod(output, 0o755)
    for name, expected in INSTALLED_X86.items():
        h = hashlib.sha256()
        with scope.regular(directory / name) as source, (output / name).open('xb') as binary:
            state = os.fstat(source.fileno())
            need(
                state.st_uid == 0
                and not state.st_mode & 0o022
                and state.st_mode & 0o111
                and state.st_size < 128 * 1024**2,
                'Installed Core executable ownership, permissions or size differs.',
            )
            for block in iter(lambda: source.read(1024**2), b''):
                h.update(block)
                binary.write(block)
            need(
                h.hexdigest() == expected,
                'Installed executable differs from the individually pinned official 32.1 release.',
            )
        os.chmod(output / name, 0o555)


def proof(s, value, release):
    need(
        os.geteuid() == 0 and sys.platform == 'linux' and release['machine'] == platform.machine(),
        'Receiver architecture differs.',
    )
    k = Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()
    need(
        k[0] == 'ssh-ed25519'
        and 'SHA256:'
        + base64.b64encode(hashlib.sha256(base64.b64decode(k[1], validate=True)).digest())
        .decode()
        .rstrip('=')
        == s['receiverFingerprint'],
        'Receiver identity changed.',
    )
    state = Path('/var/lib/omnitron-block-preseed') / s['id']
    trust_dir(state)

    def record(name):
        return json.loads((state / (name + '.json')).read_text())

    need(
        record('spec') == s
        and record('sealed')['offer']
        == hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        'Unreviewed candidate input.',
    )
    bound = record('candidate')
    ready = record('candidate-ready')
    parent = Path(s['candidateParent'])
    trust_dir(parent)
    dest = parent / ('bitcoin-' + s['id'])
    ds = dest.lstat()
    need(
        not (state / 'publication-intent.json').exists()
        and stat.S_ISDIR(ds.st_mode)
        and ds.st_uid == 0
        and ds.st_gid == s['targetGid']
        and stat.S_IMODE(ds.st_mode) == 0o710
        and [ds.st_dev, ds.st_ino] == bound['identity'] == ready['identity']
        and ready['candidate'] == str(dest / 'data')
        and ready['manifest'] == value['manifest'],
        'Candidate physical identity differs.',
    )
    data = scope.physical(dest / 'data').lstat()
    need(
        [str(data.st_dev), str(data.st_ino)] == ready['dataIdentity']
        and (data.st_uid, data.st_gid) == (s['targetUid'], s['targetGid']),
        'The adopted data directory is not at its recorded candidate path.',
    )
    scope.target_layout(s, dest / 'data')
    user = pwd.getpwnam(s['targetUser'])
    need(
        (user.pw_uid, user.pw_gid) == (s['targetUid'], s['targetGid']) and user.pw_uid != 0,
        'Service principal changed.',
    )
    network()
    with tempfile.TemporaryDirectory(dir=parent, prefix='.bitcoin-qualification-') as td:
        tool = Path(td)
        if 'archive' in release:
            extract(Path(release['archive']), release['machine'], tool)
        else:
            need(release['machine'] == 'x86_64', 'Installed executable pins are qualified for x86_64.')
            installed(Path(release['binDir']), tool)
        os.chmod(tool, 0o711)
        run = tool / 'runtime'
        run.mkdir(mode=0o700)
        os.chown(run, user.pw_uid, user.pw_gid)
        opts = dict(
            user=user.pw_uid,
            group=user.pw_gid,
            extra_groups=[],
            cwd=run,
            env={'HOME': str(run), 'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'},
        )
        args = [
            '-chain=' + s['chain'],
            '-datadir=' + str(dest / 'data'),
            '-conf=/dev/null',
            '-rpcport=18449',
            '-rpccookiefile=' + str(run / 'rpc'),
        ]
        node = [
            str(tool / 'bin/bitcoind'),
            *args,
            '-server',
            '-daemon=0',
            '-networkactive=0',
            '-listen=0',
            '-listenonion=0',
            '-discover=0',
            '-dnsseed=0',
            '-fixedseeds=0',
            '-disablewallet',
            '-nosettings',
            '-persistmempool=0',
            '-nodebuglogfile',
            '-printtoconsole=0',
            '-rpcbind=127.0.0.1',
            '-rpcallowip=127.0.0.1',
            '-pid=' + str(run / 'node.pid'),
            '-prune=' + str(s['pruneMiB']),
        ]
        for index in s['indexes']:
            node.append('-blockfilterindex=basic' if index == 'blockfilter' else '-' + index + '=1')
        cli = [str(tool / 'bin/bitcoin-cli'), *args, '-rpcconnect=127.0.0.1']
        parent_pid = os.getpid()

        def own():
            if ctypes.CDLL(None).prctl(1, signal.SIGKILL, 0, 0, 0) or os.getppid() != parent_pid:
                os._exit(125)

        def rpc(method, *args):
            timeout = 3600 if method == 'verifychain' else 60
            p = subprocess.run(
                [*cli, '-rpcclienttimeout=' + str(timeout), method, *map(str, args)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=timeout + 60,
                **opts,
            )
            need(p.returncode == 0, 'Isolated candidate RPC failed: ' + method)
            return p.stdout.decode().strip()

        child = subprocess.Popen(
            node,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            preexec_fn=own,
            **opts,
        )
        try:
            deadline = time.monotonic() + 3600
            while time.monotonic() < deadline:
                need(child.poll() is None, 'Core 32.1 exited before candidate acceptance.')
                try:
                    info = json.loads(rpc('getblockchaininfo'))
                    if info:
                        break
                except ValueError:
                    time.sleep(1)
            else:
                raise ValueError('Core readiness timed out.')
            net = json.loads(rpc('getnetworkinfo'))
            states = json.loads(rpc('getchainstates'))['chainstates']
            need(
                net['version'] == 320100
                and net['networkactive'] is False
                and net['connections'] == 0
                and info['chain'] == s['chain']
                and info['pruned'] == bool(s['pruneMiB'])
                and info['blocks'] >= s['anchorHeight']
                and rpc('getblockhash', s['anchorHeight']) == s['anchorHash']
                and len(states) == 1
                and states[0].get('validated') is True
                and states[0]['bestblockhash'] == info['bestblockhash'],
                'Candidate chain, version, pruning, validated chainstate or checkpoint differs.',
            )
            if s['pruneMiB'] > 1:
                need(
                    info.get('prune_target_size') == s['pruneMiB'] * 1024**2,
                    'Candidate automatic pruning target differs.',
                )
            expected = {INDEX[k] for k in s['indexes']}
            while time.monotonic() < deadline:
                indexes = json.loads(rpc('getindexinfo'))
                need(set(indexes) == expected, 'Unexpected candidate index.')
                if all(r['synced'] and r['best_block_height'] == info['blocks'] for r in indexes.values()):
                    break
                time.sleep(2)
            else:
                raise ValueError('Candidate index sync timed out.')
            # The deep check may only use blocks and undo still available on a pruned donor.
            depth = max(1, min(288, info['blocks'] - info.get('pruneheight', 0)))
            need(rpc('verifychain', 3, depth) == 'true', 'Core failed native chain verification.')
            rpc('stop')
            need(child.wait(timeout=600) == 0, 'Isolated Core shutdown failed.')
            with scope.target_tree(s, dest / 'data') as witness:
                physical_witness = witness
            data_stat = (dest / 'data').lstat()
            return {
                'manifest': value['manifest'],
                'candidate': str(dest / 'data'),
                'treeWitness': physical_witness,
                'dataIdentity': [str(data_stat.st_dev), str(data_stat.st_ino)],
                'archiveSha256': ARCHIVE[release['machine']],
                'releaseMode': 'installed' if 'binDir' in release else 'archive',
                'version': net['version'],
                'chain': s['chain'],
                'height': info['blocks'],
                'tip': info['bestblockhash'],
                'anchorHeight': s['anchorHeight'],
                'anchorHash': s['anchorHash'],
                'pruned': info['pruned'],
                'pruneHeight': info.get('pruneheight'),
                'indexes': sorted(indexes),
                'verifyDepth': depth,
                'cleanStop': True,
                'networkInterfaces': ['lo'],
            }
        finally:
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=120)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()


if __name__ == '__main__':
    try:
        s, o, r = (json.loads(base64.b64decode(arg, validate=True)) for arg in sys.argv[1:])
        state = Path('/var/lib/omnitron-block-preseed') / s['id']
        trust_dir(state)
        with (state / 'admin.lock').open('rb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = proof(s, o, r)
            dest = state / 'qualified.json'
            fd, name = tempfile.mkstemp(dir=state)
            try:
                with os.fdopen(fd, 'w') as f:
                    json.dump(result, f, sort_keys=True)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(name, dest)
                d = os.open(state, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(d)
                finally:
                    os.close(d)
            finally:
                Path(name).unlink(missing_ok=True)
            print(json.dumps(result, separators=(',', ':')), flush=True)
    except ValueError as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit('Offline Core qualification failed (' + type(error).__name__ + ').')
