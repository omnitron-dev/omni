"""Compact Monero LMDB payload policy for the reviewed, source-pinned Omnitron SSH channel."""
import ctypes
import hashlib
import json
import os
import pathlib
import platform
import re
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace

import omnitron_preseed_channel as channel

P = pathlib.Path
GIB = 1024 ** 3
FLOOR = 8 * GIB
POLL = 5
FORMAT = 'monero-lmdb-compact-v1'
RELEASE = '4f92268d7c16741cfb41e5bbe2aa46cc260a9ea5'
SHA = re.compile(r'[0-9a-f]{64}\Z')
SIGNATURE_DOMAIN = 'omnitron-monero-lmdb-v1'
require = channel.require


def validate_spec(spec):
    # Reuse the same network, path ownership and credential bounds as block preseed.
    channel.endpoint_spec({**spec, 'blocks': '/blocks', 'firstActive': 1})
    require(spec['payload'] == FORMAT and spec['nettype'] == 'mainnet' and spec['machine'] in ('x86_64', 'aarch64') and
            SHA.fullmatch(spec['helperSha256']) and P(spec['lmdb']).is_absolute() and P(spec['lmdb']).name == 'lmdb' and
            '..' not in P(spec['lmdb']).parts and str(P(spec['lmdb'])) == spec['lmdb'] and
            type(spec['minimumHeight']) is int and 2 <= spec['minimumHeight'] < 2**53 and
            type(spec['maxBytes']) is int and 4096 <= spec['maxBytes'] <= 16 * 1024 * GIB and
            spec['rateKiB'] <= 24 * 1024, 'Invalid private compact snapshot policy.')


def producer(spec):
    require(platform.machine() == spec['machine'], 'The qualified helper architecture differs.')
    binary = P('/var/lib/omnitron-lmdb-tools') / spec['helperSha256']
    channel.physical(binary.parent, True)
    st = binary.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and
            st.st_mode & 0o777 == 0o500 and st.st_size <= 1024 * 1024 and
            hashlib.sha256(binary.read_bytes()).hexdigest() == spec['helperSha256'], 'The qualified LMDB helper differs.')
    require(channel.run([str(binary), 'version']).decode().strip() == 'omnitron-monero-snapshot/1 ' + RELEASE,
            'The snapshot helper uses another Monero release.')
    return str(binary)


def source_database(spec):
    directory = channel.physical(P(spec['lmdb']))
    identity = []
    for name in ('data.mdb', 'lock.mdb'):
        st = (directory / name).lstat()
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size > 0,
                'The live LMDB requires physical existing data and reader-lock files.')
        identity.append([st.st_dev, st.st_ino])
    return directory, identity


def check_space(paths):
    for path in paths:
        s = os.statvfs(path)
        require(s.f_bavail * s.f_frsize >= FLOOR, 'Source free space is below the 8 GiB floor.')


def inspect(binary, path, index, live):
    metadata = json.loads(channel.run([binary, 'observe-live' if live else 'inspect-offline', str(path), str(index)], timeout=90))
    require(metadata['nettype'] == 'mainnet' and metadata['checkpointHeight'] == index and
            metadata['height'] >= 2 and all(SHA.fullmatch(metadata[k]) for k in ('genesis', 'tip', 'checkpointHash')),
            'The database failed mainnet identity or checkpoint inspection.')
    return metadata


def offer(spec, state):
    if (state / 'sent.json').exists():
        previous = channel.record(state / 'offer.json')
        require(channel.record(state / 'sent.json')['offer'] == channel.digest(channel.canonical(previous)),
                'The completed source receipt differs from the saved offer.')
        return previous
    binary = producer(spec)
    directory, identity = source_database(spec)
    check_space((directory, state))
    file = state / 'snapshot-anchor.json'
    if not file.exists():
        observed = inspect(binary, directory, 1, True)
        require(observed['height'] >= spec['minimumHeight'], 'The source is below the reviewed height.')
        channel.write_record(file, {'anchor': observed, 'sourceIdentity': identity})
    saved = channel.record(file)
    require(saved['sourceIdentity'] == identity, 'The source LMDB identity changed.')
    anchor = saved['anchor']
    public = {'format': FORMAT, 'anchor': anchor, 'sourceFreeFloorBytes': FLOOR, 'pollSeconds': POLL}
    return channel.issue_offer(spec, state, {**public, 'manifest': channel.digest(channel.canonical(public))})


def validate_offer(spec, value):
    now = int(time.time())
    public = {key: value[key] for key in ('format', 'anchor', 'sourceFreeFloorBytes', 'pollSeconds')}
    anchor = value['anchor']
    require(value['format'] == FORMAT and value['protocol'] == 1 and value['id'] == spec['id'] and
            value['spec'] == channel.digest(channel.canonical(spec)) and value['manifest'] == channel.digest(channel.canonical(public)) and
            value['issued'] <= now < value['expires'] == value['issued'] + spec['ttlMinutes'] * 60 and
            value['sourceFreeFloorBytes'] == FLOOR and value['pollSeconds'] == POLL and anchor['nettype'] == 'mainnet' and
            anchor['height'] >= spec['minimumHeight'] and all(SHA.fullmatch(anchor[k]) for k in ('genesis', 'tip', 'checkpointHash')) and
            len(value['publicKey'].split()) == 2, 'The private snapshot offer is expired or differs from review.')
    channel.fingerprint(value['publicKey'])


def json_frame(pipe, value):
    raw = channel.canonical(value)
    require(0 < len(raw) <= 8192, 'Oversized snapshot receipt.')
    channel.reply(pipe, struct.pack('!I', len(raw)) + raw)


def read_json(pipe):
    length, = struct.unpack('!I', channel.read_exact(pipe, 4))
    require(0 < length <= 8192, 'Invalid snapshot receipt length.')
    return json.loads(channel.read_exact(pipe, length))


def payload_receipt(spec, value, size, sha256):
    return {'format': FORMAT, 'id': spec['id'], 'offer': channel.digest(channel.canonical(value)),
            'helper': spec['helperSha256'], 'bytes': size, 'sha256': sha256}


def allowed(name):
    return name in ('.part', '.proof.json', 'data.mdb')


def receive(stage, spec, value, incoming, outgoing, authorized):
    require(read_json(incoming) == {'protocol': FORMAT, 'offer': channel.digest(channel.canonical(value))},
            'The stream belongs to a different snapshot.')
    require(all(p.name in ('.part', '.proof.json') for p in stage.iterdir()),
            'Stage contains a finalized candidate or unexpected entry.')
    require(not os.path.lexists(stage / '.proof.json'), 'A complete candidate already exists. Accept its original signed offer.')
    item = stage / '.part'
    if os.path.lexists(item):
        info = item.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Unexpected partial snapshot entry.')
        item.unlink()
    disk = os.statvfs(stage)
    require(disk.f_bavail * disk.f_frsize >= spec['maxBytes'], 'The receiver lacks the reviewed maximum space.')
    size, content = 0, hashlib.sha256()
    with (stage / '.part').open('xb') as target:
        channel.reply(outgoing, b'R')
        while True:
            length, = struct.unpack('!I', channel.read_exact(incoming, 4))
            authorized()
            if not length:
                break
            require(length <= channel.CHUNK and size + length <= spec['maxBytes'], 'The stream exceeds a reviewed bound.')
            block = channel.read_exact(incoming, length)
            target.write(block)
            content.update(block)
            size += length
        proof = read_json(incoming)
        require(size > 0 and proof['body'] == payload_receipt(spec, value, size, content.hexdigest()) and not incoming.read(1),
                'The snapshot ended without a matching successful source receipt.')
        target.flush()
        os.fsync(target.fileno())
    channel.write_record(stage / '.proof.json', proof)
    channel.reply(outgoing, b'D')


def sign(state, body):
    result = subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'sign', '-f', str(state / 'identity'), '-n', SIGNATURE_DOMAIN, '-'],
                            input=channel.canonical(body), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    require(result.returncode == 0 and 0 < len(result.stdout) < 2048, 'The source could not attest the completed snapshot.')
    return {'body': body, 'signature': result.stdout.decode('ascii')}


def verify_signature(state, value, proof):
    require(isinstance(proof['signature'], str) and len(proof['signature']) < 2048, 'Invalid snapshot signature.')
    with tempfile.TemporaryDirectory(dir=state) as temp:
        signers, signature = P(temp) / 'signers', P(temp) / 'signature'
        signers.write_text('source ' + value['publicKey'] + '\n')
        signature.write_text(proof['signature'])
        result = subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'verify', '-f', str(signers), '-I', 'source', '-n',
                                 SIGNATURE_DOMAIN, '-s', str(signature)], input=channel.canonical(proof['body']),
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        require(result.returncode == 0, 'The signed source snapshot receipt failed verification.')


def spawn_owned(args, **streams):
    # No threads have started when either child forks. Kill both children on abrupt parent loss,
    # including if SSH is blocked and the compact producer is still holding an LMDB read transaction.
    parent = os.getpid()
    prctl = ctypes.CDLL(None, use_errno=True).prctl

    def on_parent_loss():
        if prctl(1, signal.SIGKILL, 0, 0, 0) or os.getppid() != parent:
            os._exit(125)

    return subprocess.Popen(args, stderr=subprocess.DEVNULL, start_new_session=True, preexec_fn=on_parent_loss, **streams)


class SnapshotGuard:
    def __init__(self, children, paths, expiry):
        self.children, self.paths, self.expiry = children, paths, expiry
        self.stop = threading.Event()
        self.failure = None
        self.thread = threading.Thread(target=self.watch, daemon=True)

    def kill(self):
        for p in self.children:
            if p.poll() is None:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def watch(self):
        while not self.stop.is_set():
            try:
                check_space(self.paths)
                require(time.time() < self.expiry, 'Snapshot credential expired.')
            except Exception as failure:
                self.failure = failure
                self.kill()
                return
            self.stop.wait(POLL)


def send(spec, value, state):
    if (state / 'sent.json').exists():
        done = channel.record(state / 'sent.json')
        require(done['offer'] == channel.digest(channel.canonical(value)), 'Another stream receipt already exists.')
        return done
    validate_offer(spec, value)
    require(channel.record(state / 'offer.json') == value, 'The source credential differs from the reviewed offer.')
    binary = producer(spec)
    directory, identity = source_database(spec)
    require(channel.record(state / 'snapshot-anchor.json')['sourceIdentity'] == identity, 'Source LMDB identity changed.')
    paths = [directory, state]
    check_space(paths)
    anchor = value['anchor']
    children = []
    guard = SnapshotGuard(children, paths, value['expires'])
    previous = {}

    def cancelled(*_):
        raise channel.Refusal('Snapshot cancelled.')

    try:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
            previous[sig] = signal.signal(sig, cancelled)
        signal.alarm(max(1, value['expires'] - int(time.time())))
        ssh = spawn_owned(channel.ssh_command(spec, state), stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        children.append(ssh)
        json_frame(ssh.stdin, {'protocol': FORMAT, 'offer': channel.digest(channel.canonical(value))})
        require(channel.read_exact(ssh.stdout, 1) == b'R', 'The private receiver did not admit this fresh stream.')
        check_space(paths)
        native = spawn_owned([binary, 'compact', str(directory), str(anchor['height'] - 1), anchor['genesis'], anchor['tip'],
                              *map(str, identity[0])], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE)
        children.append(native)
        guard.thread.start()
        size, content = 0, hashlib.sha256()
        rate = spec['rateKiB'] * 1024
        due = time.monotonic()
        while True:
            data = native.stdout.read(min(channel.CHUNK, rate))
            if not data:
                break
            size += len(data)
            require(size <= spec['maxBytes'], 'Compact snapshot exceeds the authorized maximum.')
            content.update(data)
            due = max(time.monotonic(), due) + len(data) / rate
            time.sleep(max(0, due - time.monotonic()))
            ssh.stdin.write(struct.pack('!I', len(data)) + data)
        require(native.wait(timeout=30) == 0 and size > 0, 'The compact producer did not confirm success.')
        check_space(paths)
        proof = sign(state, payload_receipt(spec, value, size, content.hexdigest()))
        ssh.stdin.write(struct.pack('!I', 0))
        json_frame(ssh.stdin, proof)
        ssh.stdin.close()
        require(channel.read_exact(ssh.stdout, 1) == b'D' and ssh.wait(timeout=30) == 0, 'Destination receipt is unconfirmed.')
        channel.write_record(state / 'sent.json', proof['body'])
        return proof['body']
    finally:
        signal.alarm(0)
        guard.stop.set()
        guard.kill()
        for child in children:
            child.wait()
        if guard.thread.ident is not None:
            guard.thread.join()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if guard.failure:
            raise guard.failure


def verify(stage, spec, value):
    state = channel.ROOT / spec['id']
    token = channel.digest(channel.canonical(value))
    require(channel.record(state / ('approved-' + token + '.json')) == {'offer': token}, 'This offer has no receiver grant.')
    names = {p.name for p in stage.iterdir()}
    require(names <= {'.part', 'data.mdb', '.proof.json'} and len(names & {'.part', 'data.mdb'}) == 1,
            'Incomplete or unexpected snapshot staging contents.')
    data = stage / ('.part' if '.part' in names else 'data.mdb')
    witness = stage / '.proof.json' if '.proof.json' in names else state / 'verified-proof.json'
    for item, limit in [(witness, 8192), (data, spec['maxBytes'])]:
        s = item.lstat()
        require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 < s.st_size <= limit, 'Invalid private snapshot entry.')
    proof = channel.record(witness)
    verify_signature(state, value, proof)
    content = hashlib.sha256()
    with data.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            content.update(block)
    size = data.stat().st_size
    require(proof['body'] == payload_receipt(spec, value, size, content.hexdigest()), 'Offline snapshot bytes differ from the signed source receipt.')
    anchor = value['anchor']
    offline = inspect(producer(spec), data, anchor['height'] - 1, False)
    require(offline['genesis'] == anchor['genesis'] and offline['height'] >= max(anchor['height'], spec['minimumHeight']) and
            offline['checkpointHash'] == anchor['tip'], 'The staged database fails source genesis, height or checkpoint acceptance.')
    channel.write_record(state / 'verified-proof.json', proof)
    if data.name == '.part':
        os.rename(data, stage / 'data.mdb')
    (stage / '.proof.json').unlink(missing_ok=True)
    channel.sync_directory(stage)
    return {'bytes': size, 'sha256': content.hexdigest(), 'database': offline, 'format': FORMAT, 'offer': token}


if __name__ == '__main__':
    try:
        policy = SimpleNamespace(validate_spec=validate_spec, validate_offer=validate_offer, offer=offer, send=send,
                                 receive=receive, verify=verify, allowed=allowed)
        channel.entry(sys.argv[1:], policy)
    except channel.Refusal as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit('Private LMDB snapshot failed (' + type(error).__name__ + ').')
