"""Private direct rsync of the four controller databases, through one registered restricted SSH account."""
import base64
import contextlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time

import controller_files as files
import controller_maintenance as maintenance
import omnitron_preseed_channel as channel

FORMAT = 'omnitron-controller-sqlite-v1'
NAMESPACE = 'omnitron-controller-sqlite-snapshot-v1'
DATA = set(files.SLOTS) | {'manifest'}
ROOT = Path('/var/lib/omnitron-controller-snapshots')
CONSENTS = Path('/etc/omnitron/controller-snapshot-grants')
RSYNC = '/usr/bin/rsync'
LIMIT = 32768
require = files.require


def stage(spec):
    return channel.physical(Path(spec['stageParent']), True) / ('controller-snapshot-' + spec['id'])


def validate(spec):
    fields = {'id', 'sourceNode', 'receiverNode', 'sourceIp', 'receiverIp', 'sourceFingerprint', 'receiverFingerprint',
              'receiverPort', 'stageParent', 'ttlMinutes', 'rateKiB', 'maxBytes', 'sourceUid', 'ownerReceipt',
              'sourceReserveBytes', 'receiverReserveBytes'}
    require(isinstance(spec, dict) and fields <= set(spec) <= fields | {'restore'}, 'Invalid controller snapshot specification')
    require(channel.ID.fullmatch(spec['id']) and spec['sourceNode'] != spec['receiverNode'] and
            spec['sourceFingerprint'] != spec['receiverFingerprint'] and spec['sourceIp'] != spec['receiverIp'], 'Distinct endpoints required')
    for side in ('source', 'receiver'):
        addr = ipaddress.IPv4Address(spec[side + 'Ip'])
        require(not (addr.is_loopback or addr.is_multicast or addr.is_unspecified) and str(addr) != '255.255.255.255' and
                re.fullmatch('[A-Za-z0-9._-]{1,128}', spec[side + 'Node']) and spec[side + 'Node'] != 'local'
                and re.fullmatch('SHA256:[A-Za-z0-9+/]{43}', spec[side + 'Fingerprint']), 'Invalid registered endpoint')
    for name, lo, hi in [('sourceUid', 0, 2**32 - 2), ('receiverPort', 1, 65535), ('ttlMinutes', 1, 1440),
                         ('rateKiB', 1, 1024**2), ('maxBytes', 4096, 2**40), ('sourceReserveBytes', 1, 2**48),
                         ('receiverReserveBytes', 1, 2**48)]:
        require(type(spec[name]) is int and lo <= spec[name] <= hi, 'Invalid transfer bound')
    for name in ('stageParent', 'ownerReceipt'):
        v = spec[name]
        require(isinstance(v, str) and re.fullmatch('/[A-Za-z0-9._ /-]{1,1023}', v)
                and str(Path(v)) == v and '..' not in Path(v).parts, 'Invalid endpoint path')
    require(str(spec['stageParent']).startswith(('/srv/', '/var/lib/')), 'Invalid private stage parent')
    require(Path(spec['ownerReceipt']).name == 'managed-owner.json', 'Native owner stop proof required')
    if 'restore' in spec:
        r = spec['restore']
        require(isinstance(r, dict) and set(r) == {'id', 'sha256'} and channel.ID.fullmatch(r['id'])
                and r['id'] != spec['id'] and re.fullmatch('[a-f0-9]{64}', r['sha256']), 'Exact sealed capture required')


def ro_json(path, limit=LIMIT):
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and 0 < st.st_size <= limit, 'Unexpected snapshot record')
    with os.fdopen(os.open(path, files.READ), 'rb') as src:
        require(files.signature(os.fstat(src.fileno())) == files.signature(st), 'Snapshot record changed')
        return json.load(src)


def check_consent(spec, side, consent, public=None):
    expected = {'schema', 'side', 'spec', 'expires'} | ({'key'} if side == 'receiver' else set())
    require(isinstance(consent, dict) and set(consent) == expected and consent['schema'] == 1
            and consent['side'] == side and consent['spec'] == files.digest(spec)
            and type(consent['expires']) is int and 0 < consent['expires'] - time.time() <= spec['ttlMinutes'] * 60,
            'Independent local consent is missing, expired or belongs to another operation')
    if side == 'receiver':
        require(public is not None and consent['key'] == public, 'Receiver did not independently admit this source key')
        channel.fingerprint(public)
    return consent['expires']


def local_consent(spec, side, public=None):
    path = channel.physical(CONSENTS, True) / (spec['id'] + '.json')
    st = path.lstat()
    require(st.st_uid == 0 and stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and not st.st_mode & 0o077,
            'Expected a private root-owned grant')
    return check_consent(spec, side, ro_json(path, 2048), public)


def original_spec(spec):
    original = ro_json(ROOT / spec['restore']['id'] / 'spec.json')
    validate(original)
    require('restore' not in original and all(original[k] == spec[k] for k in
            ('sourceNode', 'receiverNode', 'sourceFingerprint', 'receiverFingerprint', 'sourceIp', 'receiverIp',
             'stageParent', 'sourceUid', 'ownerReceipt')), 'Restore must use both original administrative endpoints')
    return original


def capture_body(spec, side):
    original = original_spec(spec)
    state = ROOT / original['id']
    if side == 'source':
        body = ro_json(state / 'captured.json')
    else:
        seal = ro_json(state / 'sealed.json')
        require(seal.get('sealed') is True and seal.get('sha256') == spec['restore']['sha256'], 'Original receiver seal is absent')
        directory = stage(original)
        channel.same_stage(directory, ro_json(state / 'stage.json'))
        body = ro_json(directory / 'manifest')['body']
    require(files.digest(body) == spec['restore']['sha256'] and body['spec'] == files.digest(original)
            and body['id'] == original['id'], 'Capture does not match the authorized restore')
    files.check_manifest(body['rows'], spec)
    return body


def home(spec):
    return Path(pwd.getpwuid(spec['sourceUid']).pw_dir) / '.omnitron'


def assert_space(path, floor, extra=0):
    require(files.available(path) >= floor + extra, 'Insufficient space to retain the declared reserve')


def offer(spec, state):
    if 'restore' in spec:
        body = capture_body(spec, 'source')
        require(maintenance.stopped(spec, body['fence']['source']) == body['fence']['closed'],
                'The original clean stop has been superseded; later controller writes require separate reconciliation')
        anchor = {'capture': spec['restore']['sha256']}
    else:
        with files.controller(home(spec), spec['sourceUid']) as (dirs, device):
            main = files.inventory(dirs, device, spec['sourceUid'], mains_only=True)
            require(sum(x.st_size for x in main.values()) <= spec['maxBytes'], 'Database set exceeds its grant')
        anchor = maintenance.live(spec)
    f = state / 'anchor.json'
    if f.is_file():
        require(ro_json(f) == anchor, 'A different owner incarnation requires a fresh capture')
    else:
        channel.write_record(f, anchor)
    assert_space(home(spec), spec['sourceReserveBytes'])
    return channel.issue_offer(spec, state, {'format': FORMAT, 'manifest': files.digest(anchor)})


def check_offer(spec, obj):
    require(isinstance(obj, dict) and set(obj) == {'format', 'manifest', 'protocol', 'id', 'spec', 'publicKey', 'issued', 'expires'}
            and obj['format'] == FORMAT and obj['id'] == spec['id'] and obj['spec'] == files.digest(spec)
            and obj['protocol'] == 1 and type(obj['issued']) is int and type(obj['expires']) is int
            and obj['issued'] <= time.time() < obj['expires'] == obj['issued'] + 60 * spec['ttlMinutes']
            and re.fullmatch('[a-f0-9]{64}', obj['manifest'])
            and re.fullmatch('ssh-ed25519 [A-Za-z0-9+/]{68}', obj['publicKey']), 'Invalid or expired peer offer')
    channel.fingerprint(obj['publicKey'])


def signed(state, body):
    proc = subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'sign', '-f', str(state / 'identity'), '-n', NAMESPACE, '-'],
                          input=channel.canonical(body), capture_output=True, timeout=30)
    require(proc.returncode == 0 and 0 < len(proc.stdout) < 2048, 'Source could not sign the closed snapshot')
    return {'body': body, 'signature': proc.stdout.decode('ascii')}


def verify_signature(state, obj, proof):
    require(isinstance(proof, dict) and set(proof) == {'body', 'signature'} and isinstance(proof['signature'], str)
            and 0 < len(proof['signature']) < 2048, 'Invalid closed snapshot proof')
    with tempfile.TemporaryDirectory(dir=state) as d:
        signers, sig = Path(d) / 'signers', Path(d) / 'signature'
        signers.write_text('source ' + obj['publicKey'] + '\n')
        sig.write_text(proof['signature'])
        p = subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'verify', '-f', str(signers), '-I', 'source', '-n', NAMESPACE,
                            '-s', str(sig)], input=channel.canonical(proof['body']), capture_output=True, timeout=30)
        require(p.returncode == 0, 'Closed snapshot signature differs')


def forced(original, directory, pull):
    argv = shlex.split(original)
    prefix = ['rsync', '--server'] + (['--sender'] if pull else [])
    require(len(argv) <= 12 and len(original) <= 300 and argv[:len(prefix)] == prefix and len(argv) > len(prefix) + 2
            and argv[-2] == '.' and argv[-1] in (files.SLOTS if pull else DATA), 'Only one fixed SQLite slot is accessible')
    flags = argv[len(prefix):-2]
    # Only the negotiated rsync protocol capability letters may vary between packaged GNU releases.
    require(re.fullmatch(r'-Ie[0-9]*\.[iLsfxCIvu]*', flags[0]) and len(set(flags)) == len(flags)
            and len(flags) == (4 if pull else 5) and '--timeout=120' in flags
            and ('--inplace' in flags if pull else {'--partial', '--fsync'} <= set(flags))
            and sum(bool(re.fullmatch(r'--bwlimit=[1-9][0-9]{0,6}', s)) for s in flags) == 1,
            'The rsync command differs from the approved single-file operation')
    return ['/usr/bin/rrsync', '-ro' if pull else '-wo', '-no-lock', str(directory)]


def receiver_budget(directory, spec):
    # GNU rsync can temporarily retain the old basis and a new copy of the current file.
    total = 0
    allocated = 0
    for entry in os.scandir(directory):
        tmp = re.fullmatch(r'\.(d[0-3](?:-wal|-shm|-journal)?|manifest)\.[A-Za-z0-9]{6}', entry.name)
        require(entry.name in DATA or tmp, 'Unrecognized entry in the private transfer stage')
        try:
            st = entry.stat(follow_symlinks=False)
        except FileNotFoundError:
            # rsync may rename its verified temporary file between readdir and stat.
            continue
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= spec['maxBytes'] + LIMIT,
                'Staging entry exceeds its fixed type or size limit')
        total += st.st_size
        allocated += st.st_blocks * 512
        require(total <= 2 * (spec['maxBytes'] + LIMIT), 'Private transfer stage exceeds the reviewed bound')
    assert_space(directory, spec['receiverReserveBytes'], 16 * files.BLOCK + 2 * spec['rateKiB'] * 1024)
    return allocated


def serve(op_id, token):
    require(os.geteuid() != 0 and channel.ID.fullmatch(op_id) and re.fullmatch('[a-f0-9]{64}', token), 'Invalid transfer identity')
    state = ROOT / op_id
    with channel.lock(state / 'session.lock'):
        permit = ro_json(state / 'permit.json')
        spec, obj = permit['spec'], permit['offer']
        validate(spec)
        check_offer(spec, obj)
        require(permit['token'] == token == channel.digest(channel.canonical(obj)) and
                pwd.getpwuid(os.geteuid()).pw_name == channel.account_name(spec)
                and os.environ.get('SSH_CONNECTION', '').split()[:1] == [spec['sourceIp']], 'Unadmitted peer')
        directory = stage(spec)
        channel.same_stage(directory, permit)
        admission = ro_json(state / 'admitted.json')
        require(admission['token'] == token, 'Independent receiver admission differs')
        args = forced(os.environ.get('SSH_ORIGINAL_COMMAND', ''), directory, 'restore' in spec)
        rate = '--bwlimit=' + str(spec['rateKiB'])
        require(rate in shlex.split(os.environ['SSH_ORIGINAL_COMMAND']), 'Transfer rate differs from the grant')
        receiver_budget(directory, spec)
        env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'HOME': str(state / 'home'),
               'SSH_ORIGINAL_COMMAND': os.environ['SSH_ORIGINAL_COMMAND']}
        proc = subprocess.Popen(args, env=env, start_new_session=True)
        try:
            while proc.poll() is None:
                require(time.time() < min(obj['expires'], admission['expires']) and ro_json(state / 'permit.json').get('token') == token,
                        'Transfer grant expired or was revoked')
                receiver_budget(directory, spec)
                time.sleep(.5)
            require(proc.returncode == 0, 'Restricted file transfer failed')
            receiver_budget(directory, spec)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()


def filesystem_kind(path):
    return subprocess.run(['/usr/bin/findmnt', '--noheadings', '--output', 'FSTYPE', '--target', str(path)],
                          capture_output=True, text=True, check=True, timeout=10).stdout.strip()


def transfer_file(path, slot, ssh, spec, obj, pull=False, guard=None, directory_fd=None):
    require(slot in DATA, 'Unapproved transfer slot')
    remote = ssh[-2] + ':' + slot
    local = str(path)
    if directory_fd is not None:
        require(slot in files.SLOTS and local == files.SLOTS[slot][1], 'Expected a fixed file inside the pinned directory')
    # No recursive source. The only remote selection is an enumerated flat file.
    args = [RSYNC, '--ignore-times', '--no-whole-file', '--no-links', '--no-specials', '--no-devices',
            '--timeout=120', '--fsync', '--bwlimit=' + str(spec['rateKiB']), '--inplace' if pull else '--partial',
            '-e', shlex.join(ssh[:-2]), '--', *( [remote, local] if pull else [local, remote] )]
    # The single-threaded endpoint pins the child's cwd before exec. The child can close all extra fds
    # without losing its original directory. No process working directory or procfs path is exported.
    options = {} if directory_fd is None else {'pass_fds': (directory_fd,), 'preexec_fn': lambda: os.fchdir(directory_fd)}
    proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            start_new_session=True, **options)
    try:
        while proc.poll() is None:
            assert_space(home(spec), spec['sourceReserveBytes'])
            require(time.time() < obj['expires'], 'Transfer grant expired')
            local_consent(spec, 'source')
            if guard:
                guard()
            time.sleep(.4)
        require(proc.returncode == 0, 'Restricted rsync failed; retain the stage and inspect the original operation')
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()


def input_anchor(spec, obj, state):
    check_offer(spec, obj)
    require(ro_json(state / 'offer.json') == obj and (state / 'identity').is_file(), 'Source grant differs')
    anchor = ro_json(state / 'anchor.json')
    require(files.digest(anchor) == obj['manifest'], 'Source anchor changed')
    assert_space(home(spec), spec['sourceReserveBytes'])
    return anchor


def capture(spec, obj, state, *, cold):
    require('restore' not in spec, 'Capture grant required')
    start = time.monotonic()
    anchor = input_anchor(spec, obj, state)
    closed = maintenance.stopped(spec, anchor) if cold else None
    if not cold:
        require(maintenance.live(spec) == anchor, 'Warm owner changed')
    ssh = channel.ssh_command(spec, state)
    uid = spec['sourceUid']
    with files.controller(home(spec), uid) as (dirs, device):
        rows = files.inventory(dirs, device, uid, mains_only=not cold)
        if cold:
            files.unlocked(rows)
        total = sum(st.st_size for st in rows.values())
        require(total <= spec['maxBytes'], 'Source set exceeds its grant')
        for slot in rows:
            folder, name = files.SLOTS[slot]
            fd = dirs[folder]
            transfer_file(name, slot, ssh, spec, obj, directory_fd=fd)
        if not cold:
            return {'id': spec['id'], 'provisional': True, 'mainDatabases': len(rows), 'bytesObserved': total,
                    'elapsedSeconds': round(time.monotonic() - start, 3)}
        transferred = time.monotonic()
        contents = files.manifest(dirs, rows)
        end = files.inventory(dirs, device, uid)
        files.unlocked(end)
        require({k: files.signature(v) for k,v in rows.items()} == {k: files.signature(v) for k,v in end.items()}
                and maintenance.stopped(spec, anchor) == closed, 'A controller file or its clean owner changed during capture')
    body = {'format': FORMAT, 'id': spec['id'], 'spec': files.digest(spec), 'offer': channel.digest(channel.canonical(obj)),
            'fence': {'source': anchor, 'closed': closed}, 'rows': contents}
    files.check_manifest(contents, spec)
    if (state / 'captured.json').is_file():
        require(ro_json(state / 'captured.json') == body, 'Another closed snapshot has already been recorded')
    channel.write_record(state / 'captured.json', body)
    path = state / 'signed-manifest.json'
    channel.write_record(path, signed(state, body))
    transfer_file(path, 'manifest', ssh, spec, obj)
    return {'id': spec['id'], 'sha256': files.digest(body), 'bytes': total, 'files': len(contents),
            'ownerPid': closed['ownerPid'], 'boot': closed['boot'], 'transferSeconds': round(transferred - start, 3),
            'hashAndSignSeconds': round(time.monotonic() - transferred, 3)}


def seal(stage_dir, spec, obj):
    start = time.monotonic()
    require('restore' not in spec, 'Use a capture grant to seal controller state')
    state = ROOT / spec['id']
    token = channel.digest(channel.canonical(obj))
    require(ro_json(state / ('approved-' + token + '.json')) == {'offer': token}, 'Offer was never admitted on the receiver')
    proof = ro_json(stage_dir / 'manifest')
    verify_signature(state, obj, proof)
    body = proof['body']
    require(body.get('format') == FORMAT and body.get('id') == spec['id'] and body.get('spec') == files.digest(spec)
            and body.get('offer') == channel.digest(channel.canonical(obj))
            and files.digest(body['fence']['source']) == obj['manifest'] and body['fence']['closed']['anchor'] == obj['manifest'],
            'Snapshot proof belongs to another owner or grant')
    files.check_manifest(body['rows'], spec)
    # A failed provisional pass may have left an old optional sidecar. The signed cold set is authoritative.
    for slot in set(os.listdir(stage_dir)) - set(body['rows']) - {'manifest'}:
        require(slot in files.SLOTS and slot not in files.MAINS, 'Unexpected entry inside the private snapshot')
        info = (stage_dir / slot).lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Unsafe obsolete provisional sidecar')
        (stage_dir / slot).unlink()
    channel.sync_directory(stage_dir)
    files.verify_raw(stage_dir, body['rows'], extra=['manifest'])
    frames = files.check_recovery(stage_dir, body['rows'], stage_dir.parent, spec['receiverReserveBytes'])
    return {'sha256': files.digest(body), 'offer': body['offer'], 'bytes': sum(r['bytes'] for r in body['rows'].values()),
            'files': len(body['rows']), 'sqliteIntegrityChecks': len(files.MAINS), 'checkpointedWalFrames': frames,
            'verificationSeconds': round(time.monotonic() - start, 3)}


def export_restore(spec, state):
    body = capture_body(spec, 'receiver')
    snapshot = stage(original_spec(spec))
    files.verify_raw(snapshot, body['rows'], extra=['manifest'])
    directory = stage(spec)
    channel.same_stage(directory, ro_json(state / 'stage.json'))
    user = channel.account(spec, state)
    require(user is not None, 'Missing restricted receiver account')
    # This independent export never grants a transfer UID access to the sealed original.
    with channel.lock(state / 'session.lock'):
        os.chown(directory, 0, user.pw_gid)
        os.chmod(directory, 0o750)
        require(set(os.listdir(directory)) <= set(body['rows']), 'Unexpected private restore export entry')
        for name, row in body['rows'].items():
            dest = directory / name
            if os.path.lexists(dest):
                st = dest.lstat()
                require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1, 'Unsafe restore export')
                with contextlib.ExitStack() as opened:
                    fd = os.open(directory, files.DIRECTORY)
                    opened.callback(os.close, fd)
                    if st.st_size != row['bytes'] or files.hash_at(fd, name, st) != row['sha256']:
                        dest.unlink()
            if not dest.exists():
                assert_space(directory, spec['receiverReserveBytes'], row['bytes'])
                with (snapshot / name).open('rb') as source, dest.open('xb') as target:
                    shutil.copyfileobj(source, target, files.BLOCK)
                    os.fchown(target.fileno(), 0, user.pw_gid)
                    os.fchmod(target.fileno(), 0o440)
                    target.flush()
                    os.fsync(target.fileno())
            os.chown(dest, 0, user.pw_gid, follow_symlinks=False)
            os.chmod(dest, 0o440)
        files.verify_raw(directory, body['rows'])
        channel.sync_directory(directory)
    return {'restoreExport':spec['restore']['sha256'], 'files':len(body['rows'])}


def restore(spec, obj, state):
    require('restore' in spec, 'Separate restore grant required')
    input_anchor(spec, obj, state)
    body = capture_body(spec, 'source')
    fence, rows = body['fence'], body['rows']
    require(maintenance.stopped(spec, fence['source']) == fence['closed'], 'Source has passed the original stop')
    with files.controller(home(spec), spec['sourceUid']) as (dirs, device):
        current = files.inventory(dirs, device, spec['sourceUid'], missing_mains=True)
        vfs = os.statvfs(home(spec))
        files.unlocked(current)
        changed = {}
        for slot, row in rows.items():
            folder, name = files.SLOTS[slot]
            old = current.get(slot)
            if old is None or old.st_size != row['bytes'] or files.hash_at(dirs[folder], name, old) != row['sha256']:
                changed[slot] = row
        mounted = filesystem_kind(home(spec))
        # Existing ext4 blocks can be overwritten in place. A CoW filesystem can allocate a full replacement.
        growth = files.bound_for_restore(changed, current, vfs.f_frsize) if mounted == 'ext4' else sum(r['bytes'] for r in changed.values())
        reserve = spec['sourceReserveBytes'] + 16 * files.BLOCK + 2 * spec['rateKiB'] * 1024
        assert_space(home(spec), reserve, growth)
        maintenance.lock_restore(state, spec, fence, channel)
        ssh = channel.ssh_command(spec, state)
        for slot, row in rows.items():
            maintenance.verify_hold(state, spec, fence)
            folder, name = files.SLOTS[slot]
            fd = dirs[folder]
            if slot not in current:
                handle = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                try:
                    os.fchown(handle, row['uid'], row['gid'])
                finally:
                    os.close(handle)
            if slot in changed:
                transfer_file(name, slot, ssh, spec, obj, directory_fd=fd, pull=True,
                              guard=lambda: assert_space(home(spec), reserve))
            handle = os.open(name, files.READ, dir_fd=fd)
            try:
                files.regular(os.fstat(handle), row['uid'], device)
                os.fchown(handle, row['uid'], row['gid'])
                os.fchmod(handle, row['mode'])
                os.utime(handle, ns=(os.fstat(handle).st_atime_ns, int(row['mtimeNs'])))
                os.fsync(handle)
            finally:
                os.close(handle)
        for slot in set(current) - set(rows):
            require(slot not in files.MAINS, 'A main database cannot be removed')
            folder, name = files.SLOTS[slot]
            st = os.stat(name, dir_fd=dirs[folder], follow_symlinks=False)
            require(files.signature(st) == files.signature(current[slot]), 'Obsolete sidecar changed')
            os.unlink(name, dir_fd=dirs[folder])
        for fd in dirs.values():
            os.fsync(fd)
        final = files.inventory(dirs, device, spec['sourceUid'])
        files.unlocked(final)
        require(files.manifest(dirs, final) == rows, 'Restored original bytes or permissions differ')
        maintenance.verify_hold(state, spec, fence)
    result = {'restored':spec['restore']['sha256'], 'files':len(rows), 'servicesHeld':True}
    channel.write_record(state / 'restored.json', result)
    return result


def release(spec, state):
    if (state / 'released.json').exists():
        done = ro_json(state / 'released.json')
        require(done.get('released') == spec.get('restore', {}).get('sha256'), 'Another release was recorded')
        return done
    body = capture_body(spec, 'source')
    result = ro_json(state / 'restored.json')
    require(result.get('restored') == spec['restore']['sha256'], 'No complete verified in-place recovery')
    def same_owner():
        require(maintenance.stopped(spec, body['fence']['source']) == body['fence']['closed'], 'The original recovery owner changed')
    same_owner()
    with files.controller(home(spec), spec['sourceUid']) as (dirs, device):
        require(files.manifest(dirs, files.inventory(dirs, device, spec['sourceUid'])) == body['rows'], 'Restored state changed')
    same_owner()
    maintenance.release_restore(state, spec, body['fence'], channel)
    done = {'released': result['restored'], 'servicesStarted':False}
    channel.write_record(state / 'released.json', done)
    return done


def main(args):
    os.umask(0o077)
    channel.ROOT = ROOT
    channel.SELF = SELF
    channel.stage_path = stage
    channel.account_name = lambda spec: 'ocs' + spec['id'].replace('-', '')[:20]
    if len(args)==3 and args[0]=='receive':
        serve(args[1], args[2])
        return
    require(len(args) == 3 and os.geteuid() == 0 and sys.platform == 'linux', 'Registered Linux management endpoint required')
    action, a, b = args
    spec, obj = (json.loads(base64.b64decode(s, validate=True)) for s in (a,b))
    validate(spec)
    sides = {'offer':'source','grant':'receiver','warm':'source','cold':'source','seal':'receiver','export':'receiver',
             'restore':'source','release':'source','revoke':'receiver','forget':'source'}
    require(action in sides and channel.fingerprint(channel.key_text(channel.HOST_KEY)) == spec[sides[action]+'Fingerprint'],
            'Endpoint host identity differs from review')
    if sides[action] == 'source':
        require(Path(spec['ownerReceipt']) == home(spec) / 'execution' / 'managed-owner.json',
                'Only the native owner receipt alongside the approved execution database is supported')
    if action in ('offer', 'warm', 'cold', 'restore', 'release'):
        local_consent(spec, 'source')
    ROOT.mkdir(mode=0o711, exist_ok=True)
    channel.physical(ROOT,True)
    os.chmod(ROOT,0o711)
    state = ROOT / spec['id']
    state.mkdir(mode=0o700, exist_ok=True)
    channel.physical(state,True)
    with channel.lock(state/'admin.lock', True):
        cfg = state/'spec.json'
        if cfg.exists():
            require(ro_json(cfg)==spec, 'Operation identity already belongs to another specification')
        else:
            require(set(os.listdir(state))=={'admin.lock'}, 'Refusing unrelated administrative state')
            channel.write_record(cfg,spec)
        if action in ('offer','warm','cold'):
            channel.lower_source_priority()
        if action == 'offer':
            result = offer(spec,state)
        elif action == 'grant':
            require(not (state / 'revoked.json').exists(), 'This receiver grant has been explicitly closed')
            until = local_consent(spec, 'receiver', obj['publicKey'])
            directory = stage(spec)
            retained = 0
            if (state / 'stage.json').exists():
                channel.same_stage(directory, ro_json(state / 'stage.json'))
                retained = receiver_budget(directory, spec)
            assert_space(directory.parent, spec['receiverReserveBytes'], max(0, 2 * (spec['maxBytes'] + LIMIT) - retained))
            result = channel.grant(spec, obj, state, check_offer, remember=True)
            if not result.get('sealed'):
                user = channel.account(spec, state)
                channel.write_record(state / 'admitted.json', {'token': channel.digest(channel.canonical(obj)), 'expires': until},
                                     0o640, user.pw_gid)
        elif action in ('warm','cold'):
            result = capture(spec,obj,state,cold=action=='cold')
        elif action == 'export':
            result = export_restore(spec,state)
        elif action == 'restore':
            result = restore(spec,obj,state)
        elif action == 'release':
            result = release(spec,state)
        elif action == 'seal':
            result = channel.revoke(spec,state,obj,seal,lambda name:name in DATA,0o400)
        elif action == 'revoke':
            channel.write_record(state / 'revoked.json', {'closed': True})
            result = channel.revoke(spec,state,None,seal,lambda name:name in DATA,0o400)
        else:
            for file in ('identity','identity.next','identity.next.pub'):
                (state/file).unlink(missing_ok=True)
            channel.sync_directory(state)
            result={'sourceKeyRemoved':True}
    print(channel.canonical(result).decode(),flush=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError,OSError,KeyError,TypeError,sqlite3.Error,subprocess.SubprocessError,channel.Refusal) as error:
        # No SQLite records, ssh commands, paths from an untrusted peer or credentials in Pipeline logs.
        if isinstance(error, (files.Refused, channel.Refusal)):
            print(str(error)[:170],file=sys.stderr)
        else:
            print('Controller snapshot endpoint could not confirm its operation',file=sys.stderr)
        sys.exit(1)
