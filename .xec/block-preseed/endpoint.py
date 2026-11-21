"""Linux endpoint embedded in reviewed Omnitron shell steps and the restricted SSH command."""
import base64
import contextlib
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
import pathlib
import pwd
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time

P = pathlib.Path
ROOT = P('/var/lib/omnitron-block-preseed')
HOST_KEY = P('/etc/ssh/ssh_host_ed25519_key.pub')
NAME = re.compile(r'(blk|rev)([0-9]{5})\.dat\Z')
ID = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z')
FRAME_MAX = 24 * 1024 * 1024
FILE_MAX = 512 * 1024 * 1024
CHUNK = 256 * 1024
SSH_COMMAND = 'omnitron-block-preseed-v1'


class Refusal(Exception):
    pass


def require(test, reason):
    if not test:
        raise Refusal(reason)


def canonical(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True, ensure_ascii=True).encode('ascii')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_file(file, contents, mode=0o600, group=None):
    fd, temp = tempfile.mkstemp(dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(contents)
            if group is not None:
                os.fchown(output.fileno(), 0, group)
            os.fchmod(output.fileno(), mode)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, file)
        sync_directory(file.parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def write_record(file, value, mode=0o600, group=None):
    write_file(file, canonical(value), mode, group)


def record(path):
    return json.loads(path.read_bytes())


def physical(path, root_owned=False):
    require(path.is_absolute() and path.resolve(strict=True) == path, 'A physical directory is required.')
    for part in [path, *path.parents]:
        st = part.lstat()
        require(stat.S_ISDIR(st.st_mode), 'An ancestor is not a directory.')
        if root_owned:
            require(st.st_uid == 0 and not st.st_mode & 0o022, 'A staging ancestor permits another writer.')
    return path


def fingerprint(public):
    parts = public.strip().split()
    require(len(parts) >= 2 and parts[0] == 'ssh-ed25519', 'An Ed25519 host or operation key is required.')
    raw = base64.b64decode(parts[1], validate=True)
    require(len(raw) == 51 and raw[:19] == b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20', 'Invalid Ed25519 key.')
    return 'SHA256:' + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=')


def key_text(path):
    return ' '.join(path.read_text().split()[:2])


def endpoint_spec(spec):
    require(ID.fullmatch(spec['id']) and spec['sourceNode'] != spec['receiverNode'] and
            spec['sourceFingerprint'] != spec['receiverFingerprint'], 'Invalid endpoint identity.')
    for field in ('blocks', 'stageParent'):
        value = spec[field]
        require(value.startswith('/') and value != '/' and str(P(value)) == value and '..' not in P(value).parts,
                'An absolute physical data directory is required.')
    require(P(spec['blocks']).name == 'blocks' and spec['sourceIp'] != spec['receiverIp'], 'Invalid source directory or network endpoints.')
    for field in ('sourceIp', 'receiverIp'):
        ip = ipaddress.IPv4Address(spec[field])
        require(not (ip.is_unspecified or ip.is_multicast or ip.is_loopback) and str(ip) != '255.255.255.255', 'A unicast node address is required.')
    for field, maximum in [('firstActive', 99999), ('receiverPort', 65535), ('rateKiB', 1048576), ('ttlMinutes', 1440)]:
        require(type(spec[field]) is int and 1 <= spec[field] <= maximum, 'An endpoint limit is outside the supported range.')


@contextlib.contextmanager
def lock(path, create=False):
    flags = os.O_NOFOLLOW | (os.O_RDWR | os.O_CREAT if create else os.O_RDONLY)
    fd = os.open(path, flags, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refusal('An endpoint operation is active; inspect its run before retrying.') from None
        yield
    finally:
        os.close(fd)


def signature(st):
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns


def regular(directory, name):
    require(bool(NAME.fullmatch(name)), 'Only public block and undo filenames are accepted.')
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    stream = os.fdopen(fd, 'rb')
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or not 0 < st.st_size <= FILE_MAX:
        stream.close()
        raise Refusal('A selected segment is not a bounded regular file with one link.')
    return stream


def inspect_file(directory, name, sink=None):
    with regular(directory, name) as source:
        before = os.fstat(source.fileno())
        h = hashlib.sha256()
        size = 0
        while True:
            chunk = source.read(CHUNK)
            if not chunk:
                break
            h.update(chunk)
            size += len(chunk)
            require(size <= before.st_size, 'A segment grew during inspection.')
            if sink is not None:
                sink.write(chunk)
        after = os.stat(name, dir_fd=directory, follow_symlinks=False)
        require(signature(before) == signature(os.fstat(source.fileno())) == signature(after) and size == before.st_size,
                'A segment changed during inspection.')
    return [name, size, h.hexdigest()]


@contextlib.contextmanager
def directory_fd(path):
    fd = os.open(physical(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        yield fd
    finally:
        os.close(fd)


def open_writers():
    writers = set()
    for pid in P('/proc').iterdir():
        if not pid.name.isdigit():
            continue
        try:
            for entry in (pid / 'fd').iterdir():
                try:
                    info = entry.stat()
                    if stat.S_ISREG(info.st_mode):
                        flags = next(line for line in (pid / 'fdinfo' / entry.name).read_text().splitlines() if line.startswith('flags:'))
                        if int(flags.split()[1], 8) & os.O_ACCMODE != os.O_RDONLY:
                            writers.add((info.st_dev, info.st_ino))
                except (FileNotFoundError, ProcessLookupError):
                    continue
        except (FileNotFoundError, ProcessLookupError):
            continue
    return writers


def select_rows(directory, first_active):
    groups = {'blk': {}, 'rev': {}}
    for name in os.listdir(directory):
        match = NAME.fullmatch(name)
        if match:
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'An invalid segment cannot establish a closed-file boundary.')
            groups[match[1]][int(match[2])] = name
    require(all(groups.values()), 'No block and undo segment families were found.')
    cutoff = min(first_active, max(groups['blk']), max(groups['rev']))
    candidates = sorted(i for i in groups['blk'].keys() & groups['rev'].keys() if i < cutoff)
    writers = open_writers()
    names = []
    for i in candidates:
        pair = [groups[family][i] for family in ('blk', 'rev')]
        stats = [os.stat(name, dir_fd=directory, follow_symlinks=False) for name in pair]
        if any((s.st_dev, s.st_ino) in writers for s in stats):
            continue
        names.extend(pair)
    require(names, 'There are no closed, paired segments below the reviewed boundary.')
    return [inspect_file(directory, name) for name in sorted(names)]


def run(args, timeout=30):
    proc = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
    require(proc.returncode == 0, 'An endpoint prerequisite or process failed: ' + P(args[0]).name)
    return proc.stdout


def lower_source_priority():
    os.setpriority(os.PRIO_PROCESS, 0, 19)
    require(os.getpriority(os.PRIO_PROCESS, 0) == 19, 'Could not lower source CPU priority.')
    ionice = shutil.which('ionice', path='/usr/sbin:/usr/bin:/sbin:/bin')
    if ionice:
        run([ionice, '-c', '2', '-n', '7', '-p', str(os.getpid())])
    print('Source read priority: nice 19; ' + ('ionice best-effort 7.' if ionice else 'ionice unavailable.'), file=sys.stderr, flush=True)


def offered(spec, state):
    manifest_file = state / 'manifest.json'
    if not manifest_file.exists():
        with directory_fd(P(spec['blocks'])) as directory:
            manifest = select_rows(directory, spec['firstActive'])
        write_record(manifest_file, manifest)
    raw = manifest_file.read_bytes()
    require(len(raw) <= FRAME_MAX, 'Segment manifest is too large.')
    rows = json.loads(raw)
    key = state / 'identity'
    receipt = state / 'offer.json'
    now = int(time.time())
    if receipt.exists() and key.is_file():
        old = record(receipt)
        if old['expires'] > now and old['publicKey'] == run(['/usr/bin/ssh-keygen', '-y', '-f', str(key)]).decode().strip():
            return old
    new, pub = state / 'identity.next', state / 'identity.next.pub'
    for item in (new, pub):
        item.unlink(missing_ok=True)
    try:
        run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', str(new)])
        public = key_text(pub)
        fingerprint(public)
        os.replace(new, key)
        sync_directory(state)
    finally:
        for item in (new, pub):
            item.unlink(missing_ok=True)
    result = {'protocol': 1, 'id': spec['id'], 'spec': digest(canonical(spec)), 'publicKey': public,
              'manifest': digest(raw), 'files': len(rows), 'bytes': sum(row[1] for row in rows),
              'issued': now, 'expires': now + spec['ttlMinutes'] * 60}
    write_record(receipt, result)
    return result


def check_offer(spec, offer):
    now = int(time.time())
    require(offer['protocol'] == 1 and offer['id'] == spec['id'] and offer['spec'] == digest(canonical(spec)) and
            offer['issued'] <= now < offer['expires'] == offer['issued'] + spec['ttlMinutes'] * 60 and
            re.fullmatch(r'[a-f0-9]{64}', offer['manifest']) and 2 <= offer['files'] <= 200000 and offer['bytes'] > 0,
            'The public offer is invalid, expired or belongs to another specification.')
    fingerprint(offer['publicKey'])
    require(len(offer['publicKey'].split()) == 2, 'Unexpected public key options.')


def account_name(spec):
    return 'obp' + spec['id'].replace('-', '')[:20]


def account(spec, state, create=False):
    name = account_name(spec)
    home = state / 'home'
    tag = 'omnitron-preseed-' + spec['id']
    try:
        user = pwd.getpwnam(name)
    except KeyError:
        if not create:
            return None
        run(['/usr/sbin/useradd', '--system', '--user-group', '--no-create-home', '--no-log-init', '--home-dir', str(home),
             '--shell', '/bin/sh', '--comment', tag, '--password', '*', name])
        user = pwd.getpwnam(name)
    require(user.pw_uid != 0 and user.pw_gid != 0 and user.pw_dir == str(home) and user.pw_gecos == tag and
            user.pw_shell == '/bin/sh' and os.getgrouplist(name, user.pw_gid) == [user.pw_gid],
            'The operation account differs from the dedicated identity.')
    return user


def stage_path(spec):
    return physical(P(spec['stageParent']), True) / ('block-preseed-' + spec['id'])


def same_stage(stage, record_):
    st = stage.lstat()
    require(stat.S_ISDIR(st.st_mode) and [st.st_dev, st.st_ino] == record_['identity'], 'Staging directory identity changed.')


def write_keys(state, value, group):
    directory = state / 'home' / '.ssh'
    for part in (state / 'home', directory):
        part.mkdir(mode=0o750, exist_ok=True)
        os.chown(part, 0, group)
        os.chmod(part, 0o750)
    write_file(directory / 'authorized_keys', value.encode('ascii'), 0o640, group)


def grant(spec, offer, state):
    stage = stage_path(spec)
    journal = state / 'stage.json'
    if (state / 'sealed.json').exists():
        sealed = record(state / 'sealed.json')
        same_stage(stage, record(journal))
        require(offer['spec'] == digest(canonical(spec)) and sealed['manifest'] == offer['manifest'], 'Stage was sealed for another offer.')
        return sealed
    check_offer(spec, offer)
    if not journal.exists():
        require(not os.path.lexists(stage) and account(spec, state) is None, 'The initial stage or account already exists.')
        stage.mkdir(mode=0o700)
        st = stage.lstat()
        write_record(journal, {'identity': [st.st_dev, st.st_ino], 'manifest': offer['manifest']})
        sync_directory(stage.parent)
    binding = record(journal)
    same_stage(stage, binding)
    require(binding['manifest'] == offer['manifest'] and not (state / 'sealed.json').exists(), 'Stage is sealed or bound to another manifest.')
    user = account(spec, state, True)
    os.chown(state, 0, user.pw_gid)
    os.chmod(state, 0o750)
    session = state / 'session.lock'
    session.touch(mode=0o640, exist_ok=True)
    os.chown(session, 0, user.pw_gid)
    os.chmod(session, 0o640)
    with lock(session):
        program = state / 'receiver.py'
        # This physical program and every ancestor remain under root ownership.
        write_file(program, SELF.encode('utf8'), 0o640, user.pw_gid)
        os.chown(stage, user.pw_uid, user.pw_gid)
        os.chmod(stage, 0o700)
        token = digest(canonical(offer))
        write_record(state / 'permit.json', {'spec': spec, 'offer': offer, 'token': token, 'identity': binding['identity']}, 0o640, user.pw_gid)
        expiry = datetime.datetime.fromtimestamp(offer['expires'], datetime.timezone.utc).strftime('%Y%m%d%H%M%SZ')
        line = 'restrict,from="{}",expiry-time="{}",command="/usr/bin/python3 -I {} receive {} {}" {}\n'.format(
            ipaddress.IPv4Address(spec['sourceIp']), expiry, program, spec['id'], token, offer['publicKey'])
        write_keys(state, line, user.pw_gid)
    return {'stage': str(stage), 'account': user.pw_name, 'expires': offer['expires']}


def checked_manifest(raw, spec, offer):
    require(len(raw) <= FRAME_MAX and digest(raw) == offer['manifest'], 'Unexpected transfer manifest.')
    rows = json.loads(raw)
    require(isinstance(rows, list) and len(rows) == offer['files'] and canonical(rows) == raw, 'Invalid manifest structure.')
    names = []
    for row in rows:
        require(isinstance(row, list) and len(row) == 3 and isinstance(row[0], str) and NAME.fullmatch(row[0]) and
                int(row[0][3:8]) < spec['firstActive'] and type(row[1]) is int and 0 < row[1] <= FILE_MAX and
                isinstance(row[2], str) and re.fullmatch(r'[a-f0-9]{64}', row[2]), 'An unapproved segment was offered.')
        names.append(row[0])
    require(names == sorted(set(names)) and {n[3:] for n in names if n.startswith('blk')} ==
            {n[3:] for n in names if n.startswith('rev')} and sum(row[1] for row in rows) == offer['bytes'],
            'Transfer inventory does not match the approved pairs and byte count.')
    return rows


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        block = stream.read(min(CHUNK, size - len(data)))
        require(block, 'Transfer stream ended before the expected length.')
        data.extend(block)
    return bytes(data)


def reply(out, code):
    out.write(code)
    out.flush()


def remove_partial(stage):
    part = stage / '.part'
    try:
        st = part.lstat()
    except FileNotFoundError:
        return
    require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1, 'Unexpected partial staging entry.')
    part.unlink()


def receive_stream(stage, spec, offer, incoming, outgoing, still_authorized=lambda: None):
    length, = struct.unpack('!I', read_exact(incoming, 4))
    require(0 < length <= FRAME_MAX, 'Invalid manifest length.')
    rows = checked_manifest(read_exact(incoming, length), spec, offer)
    allowed = {row[0] for row in rows}
    require(all(p.name == '.part' or p.name in allowed for p in stage.iterdir()), 'Staging contains an unapproved entry.')
    remove_partial(stage)
    with directory_fd(stage) as directory:
        missing = 0
        for name, size, _ in rows:
            if not os.path.lexists(stage / name):
                missing += size
        require(shutil.disk_usage(stage).free >= missing, 'Insufficient free space on the receiving filesystem.')
        for row in rows:
            still_authorized()
            name, size, expected = row
            if os.path.lexists(stage / name):
                require(inspect_file(directory, name) == row, 'Existing staged segment differs from the approved bytes.')
                reply(outgoing, b'H')
                continue
            reply(outgoing, b'S')
            part = stage / '.part'
            fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            h = hashlib.sha256()
            remaining = size
            with os.fdopen(fd, 'wb') as file:
                while remaining:
                    chunk = read_exact(incoming, min(CHUNK, remaining))
                    still_authorized()
                    file.write(chunk)
                    h.update(chunk)
                    remaining -= len(chunk)
                require(h.hexdigest() == expected, 'Received bytes differ from the approved segment.')
                file.flush()
                os.fsync(file.fileno())
            # Private stage and the single session lock make this the only publisher.
            os.rename(part, stage / name)
            os.fsync(directory)
            reply(outgoing, b'K')
    require(not incoming.read(1), 'Unexpected bytes follow the approved manifest.')
    reply(outgoing, b'D')


def receive(op_id, token):
    require(os.geteuid() != 0 and ID.fullmatch(op_id) and re.fullmatch(r'[a-f0-9]{64}', token) and
            os.environ.get('SSH_ORIGINAL_COMMAND') == SSH_COMMAND, 'Restricted preseed admission failed.')
    state = ROOT / op_id
    with lock(state / 'session.lock'):
        permit = record(state / 'permit.json')
        require(permit.get('token') == token, 'The transfer credential was revoked.')
        spec, offer = permit['spec'], permit['offer']
        require(os.environ.get('SSH_CONNECTION', '').split()[:1] == [spec['sourceIp']] and
                pwd.getpwuid(os.geteuid()).pw_name == account_name(spec), 'Unexpected SSH source or identity.')
        check_offer(spec, offer)
        # Covers idle, stalled and already-authenticated sessions until the same absolute expiry.
        signal.alarm(max(1, offer['expires'] - int(time.time())))
        stage = stage_path(spec)
        same_stage(stage, permit)
        next_check = 0

        def still_authorized():
            nonlocal next_check
            if time.monotonic() >= next_check:
                require(record(state / 'permit.json').get('token') == token, 'The transfer credential was revoked.')
                next_check = time.monotonic() + 1

        receive_stream(stage, spec, offer, sys.stdin.buffer, sys.stdout.buffer, still_authorized)


def send(spec, offer, state):
    if (state / 'sent.json').exists():
        previous = record(state / 'sent.json')
        require(offer['spec'] == digest(canonical(spec)) and offer['manifest'] == previous['manifest'], 'Another send receipt already exists.')
        return previous
    check_offer(spec, offer)
    require(record(state / 'offer.json') == offer and (state / 'identity').is_file(), 'The source credential differs from the public offer.')
    raw = (state / 'manifest.json').read_bytes()
    rows = checked_manifest(raw, spec, offer)
    host, port = str(ipaddress.IPv4Address(spec['receiverIp'])), str(spec['receiverPort'])
    scanned = run(['/usr/bin/ssh-keyscan', '-4', '-T', '8', '-t', 'ed25519', '-p', port, host]).decode()
    keys = {' '.join(line.split()[1:3]) for line in scanned.splitlines() if not line.startswith('#') and len(line.split()) == 3}
    keys = [key for key in keys if fingerprint(key) == spec['receiverFingerprint']]
    require(len(keys) == 1, 'The direct receiver SSH fingerprint differs from review.')
    known = state / 'known_hosts'
    write_file(known, ('omnitron-block-peer ' + keys[0] + '\n').encode('ascii'))
    args = ['/usr/bin/ssh', '-4', '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'IdentityAgent=none', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
            '-o', 'HostKeyAlias=omnitron-block-peer', '-o', 'HostKeyAlgorithms=ssh-ed25519',
            '-o', 'UserKnownHostsFile=' + str(known), '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ForwardAgent=no',
            '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15',
            '-o', 'ServerAliveCountMax=3', '-b', str(ipaddress.IPv4Address(spec['sourceIp'])), '-p', port,
            '-i', str(state / 'identity'), account_name(spec) + '@' + host, SSH_COMMAND]
    child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    sent = retained = 0
    rate = spec['rateKiB'] * 1024
    try:
        signal.alarm(max(1, offer['expires'] - int(time.time())))
        writers = open_writers()
        with directory_fd(P(spec['blocks'])) as directory:
            reply(child.stdin, struct.pack('!I', len(raw)) + raw)
            for row in rows:
                status = read_exact(child.stdout, 1)
                if status == b'H':
                    retained += 1
                    continue
                require(status == b'S', 'The receiver refused the requested segment.')
                st = os.stat(row[0], dir_fd=directory, follow_symlinks=False)
                require((st.st_dev, st.st_ino) not in writers, 'An offered segment has a live writer.')
                # Validate a bounded private copy before any payload byte can leave the source.
                with tempfile.TemporaryFile(dir=state) as verified:
                    require(inspect_file(directory, row[0], verified) == row, 'Source bytes changed since the offer.')
                    verified.seek(0)
                    due = time.monotonic()
                    while True:
                        block = verified.read(min(CHUNK, rate))
                        if not block:
                            break
                        due = max(time.monotonic(), due) + len(block) / rate
                        time.sleep(max(0, due - time.monotonic()))
                        child.stdin.write(block)
                    child.stdin.flush()
                require(read_exact(child.stdout, 1) == b'K', 'The receiver did not confirm the approved segment.')
                sent += 1
        child.stdin.close()
        require(read_exact(child.stdout, 1) == b'D' and child.wait(timeout=30) == 0, 'Transfer completion is unconfirmed.')
        result = {'manifest': offer['manifest'], 'sentFiles': sent, 'retainedFiles': retained, 'bytes': offer['bytes']}
        write_record(state / 'sent.json', result)
        return result
    finally:
        signal.alarm(0)
        if child.poll() is None:
            child.kill()
        child.wait()


def revoke(spec, state, offer=None):
    journal = state / 'stage.json'
    if not journal.exists():
        require(offer is None, 'The destination stage was never created.')
        return {'revoked': True}
    binding = record(journal)
    stage = stage_path(spec)
    same_stage(stage, binding)
    if (state / 'sealed.json').exists():
        sealed = record(state / 'sealed.json')
        require(offer is None or sealed['manifest'] == offer['manifest'], 'Unexpected sealed receipt.')
        return sealed
    user = account(spec, state)
    # Disable both new SSH authentication and any further channels on an existing connection.
    if user:
        write_record(state / 'permit.json', {'revoked': True}, 0o640, user.pw_gid)
        write_keys(state, '', user.pw_gid)
    with lock(state / 'session.lock', True):
        os.chown(stage, 0, 0)
        os.chmod(stage, 0o700)
        if offer is not None:
            require(offer['spec'] == digest(canonical(spec)) and offer['manifest'] == binding['manifest'],
                    'The stage does not belong to this reviewed offer.')
            with directory_fd(stage) as directory:
                names = sorted(os.listdir(directory))
                require(len(names) == offer['files'] and all(NAME.fullmatch(name) for name in names), 'Staged inventory differs from the offer.')
                rows = [inspect_file(directory, name) for name in names]
                checked_manifest(canonical(rows), spec, offer)
        if user:
            # A partial retained stage can be resumed later under a freshly allocated operation UID.
            for item in stage.iterdir():
                st = item.lstat()
                require((NAME.fullmatch(item.name) or item.name == '.part') and stat.S_ISREG(st.st_mode) and st.st_nlink == 1,
                        'Unexpected entry in the retained private stage.')
                os.chown(item, 0, 0, follow_symlinks=False)
                os.chmod(item, 0o444)
            run(['/usr/sbin/userdel', user.pw_name])
        if offer is None:
            return {'revoked': True, 'stage': str(stage)}
        result = {'sealed': True, 'stage': str(stage), 'manifest': offer['manifest'], 'files': offer['files'], 'bytes': offer['bytes']}
        write_record(state / 'sealed.json', result)
        return result


def entry(args):
    os.umask(0o077)
    if len(args) == 3 and args[0] == 'receive':
        receive(args[1], args[2])
        return
    require(len(args) == 3 and args[0] in ('offer', 'grant', 'send', 'seal', 'revoke', 'forget') and
            sys.platform == 'linux' and os.geteuid() == 0, 'A registered Linux management endpoint with root access is required.')
    action, encoded, receipt = args
    spec, offer = [json.loads(base64.b64decode(item, validate=True)) for item in (encoded, receipt)]
    endpoint_spec(spec)
    side = 'source' if action in ('offer', 'send', 'forget') else 'receiver'
    require(fingerprint(key_text(HOST_KEY)) == spec[side + 'Fingerprint'], 'The endpoint host identity differs from review.')
    if action in ('offer', 'send'):
        lower_source_priority()
    ROOT.mkdir(mode=0o711, exist_ok=True)
    physical(ROOT, True)
    os.chmod(ROOT, 0o711)
    state = ROOT / spec['id']
    state.mkdir(mode=0o700, exist_ok=True)
    physical(state, True)
    with lock(state / 'admin.lock', True):
        config = state / 'spec.json'
        if config.exists():
            require(record(config) == spec, 'Operation identity already binds another specification.')
        else:
            write_record(config, spec)
        if action == 'offer':
            result = offered(spec, state)
        elif action == 'grant':
            result = grant(spec, offer, state)
        elif action == 'send':
            result = send(spec, offer, state)
        elif action in ('seal', 'revoke'):
            result = revoke(spec, state, offer if action == 'seal' else None)
        else:
            for item in ('identity', 'identity.next', 'identity.next.pub'):
                (state / item).unlink(missing_ok=True)
            sync_directory(state)
            result = {'sourceKeyRemoved': True}
    print(canonical(result).decode(), flush=True)


if __name__ == '__main__':
    try:
        entry(sys.argv[1:])
    except Refusal as error:
        sys.exit(str(error))
    except Exception as error:
        # Subprocess output, raw protocol input, environment and filesystem data stay local.
        sys.exit('Block preseed endpoint failed (' + type(error).__name__ + ').')
