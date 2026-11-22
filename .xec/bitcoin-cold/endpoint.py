"""Public, closed Bitcoin chain data over the restricted preseed SSH channel."""

import base64
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import time
from types import SimpleNamespace

import bitcoin_cold_scope as scope
import omnitron_preseed_channel as ch

need = scope.need
FORMAT = 'bitcoin-core-public-cold-v1'
FLAT = re.compile(r'f[0-9]{6}\Z')


def hot(s, source):
    state = ch.physical(ch.ROOT / s['hotId'], True)
    old = ch.record(state / 'spec.json')
    ch.endpoint_spec(old)
    need(
        old['id'] == s['hotId']
        and all(
            old[k] == s[k]
            for k in (
                'sourceNode',
                'receiverNode',
                'sourceFingerprint',
                'receiverFingerprint',
                'sourceIp',
                'receiverIp',
                'receiverPort',
                'blocks',
                'stageParent',
            )
        ),
        'The original hot operation has different endpoints or paths.',
    )
    if source:
        raw = (state / 'manifest.json').read_bytes()
        sent = ch.record(state / 'sent.json')
        need(
            ch.digest(raw) == s['hotManifest'] == sent['manifest'], 'The source hot transfer is unconfirmed.'
        )
        return {name: (size, sha) for name, size, sha in json.loads(raw)}
    stage = ch.stage_path(old)
    binding, sealed = ch.record(state / 'stage.json'), ch.record(state / 'sealed.json')
    ch.same_stage(stage, binding)
    need(
        binding['manifest'] == sealed['manifest'] == s['hotManifest']
        and sealed['sealed'] is True
        and sealed['stage'] == str(stage)
        and stage.stat().st_uid == 0
        and stat.S_IMODE(stage.stat().st_mode) == 0o700,
        'The exact hot stage has not been sealed under root ownership.',
    )
    return stage


def offer(s, state):
    previous = hot(s, True)
    with scope.fenced(s):
        current = scope.files(s)
        rows, identities = [], {}
        for name, path in current.items():
            identities[name] = []
            size, sha = scope.inspect(path, remember=identities[name])
            leaf = name.removeprefix('blocks/')
            reuse = bool(scope.SEGMENT.fullmatch(leaf)) and previous.get(leaf) == (size, sha)
            rows.append([name, size, sha, reuse])
        need(list(scope.files(s)) == list(current), 'Cold inventory changed while creating the offer.')
    raw = ch.canonical(rows)
    need(len(raw) <= ch.FRAME_MAX, 'Cold manifest exceeds its framing bound.')
    manifest = state / 'manifest.json'
    if manifest.exists():
        need(manifest.read_bytes() == raw, 'Another cold manifest is already bound to this operation.')
    else:
        ch.write_file(manifest, raw)
    provenance = state / 'source-identities.json'
    if provenance.exists():
        need(ch.record(provenance) == identities, 'Source identities changed after the first cold offer.')
    else:
        ch.write_record(provenance, identities)
    return ch.issue_offer(
        s,
        state,
        {
            'format': FORMAT,
            'manifest': ch.digest(raw),
            'bytes': sum(r[1] for r in rows),
            'files': len(rows),
            'reuseBytes': sum(r[1] for r in rows if r[3]),
            'reuseFiles': sum(r[3] for r in rows),
        },
    )


def validate_offer(s, value):
    scope.validate(s)
    ch.check_offer(s, value)
    need(
        value['format'] == FORMAT
        and 0 <= value['reuseFiles'] <= value['files']
        and 0 <= value['reuseBytes'] <= value['bytes'],
        'Invalid cold reuse scope.',
    )


def checked(s, value, raw):
    need(len(raw) <= ch.FRAME_MAX and ch.digest(raw) == value['manifest'], 'Cold manifest digest differs.')
    rows = json.loads(raw)
    need(
        isinstance(rows, list) and len(rows) == value['files'] and ch.canonical(rows) == raw,
        'Invalid cold manifest encoding.',
    )
    for row in rows:
        need(isinstance(row, list) and len(row) == 4, 'Invalid cold row.')
        name, size, sha, reuse = row
        need(
            isinstance(name, str)
            and scope.permitted(s, name)
            and type(size) is int
            and 0 <= size <= scope.MAX_FILE
            and isinstance(sha, str)
            and scope.HASH.fullmatch(sha)
            and type(reuse) is bool
            and (not reuse or name.startswith('blocks/') and scope.SEGMENT.fullmatch(name[7:])),
            'Unapproved cold row.',
        )
    names = [r[0] for r in rows]
    need(
        names == sorted(set(names))
        and 'blocks/xor.dat' in names
        and all(d + '/CURRENT' in names for d in scope.db_dirs(s))
        and sum(r[1] for r in rows) == value['bytes']
        and sum(r[1] for r in rows if r[3]) == value['reuseBytes']
        and sum(r[3] for r in rows) == value['reuseFiles'],
        'Cold inventory totals differ.',
    )
    return rows


def flat(i):
    return 'f%06d' % i


def allowed(name):
    return name in ('.part', '.inventory') or FLAT.fullmatch(name)


def receive(stage, s, value, incoming, outgoing, authorized):
    (length,) = struct.unpack('!I', ch.read_exact(incoming, 4))
    need(0 < length <= ch.FRAME_MAX, 'Invalid cold manifest frame.')
    raw = ch.read_exact(incoming, length)
    rows = checked(s, value, raw)
    names = {flat(i) for i, r in enumerate(rows) if not r[3]}
    need(
        all(p.name in names | {'.part', '.inventory'} for p in stage.iterdir()),
        'Unexpected cold stage entry.',
    )
    ch.remove_partial(stage)
    inventory = stage / '.inventory'
    if os.path.lexists(inventory):
        need(scope.inspect(inventory) == (len(raw), ch.digest(raw)), 'Staged manifest changed.')
    else:
        ch.write_file(inventory, raw)
    need(
        shutil.disk_usage(stage).free
        >= sum(r[1] for i, r in enumerate(rows) if not r[3] and not os.path.lexists(stage / flat(i))),
        'Insufficient cold staging capacity.',
    )
    for i, (_, size, sha, reused) in enumerate(rows):
        if reused:
            continue
        authorized()
        dest = stage / flat(i)
        if os.path.lexists(dest):
            need(scope.inspect(dest) == (size, sha), 'Retained cold object failed verification.')
            ch.reply(outgoing, b'H')
            continue
        ch.reply(outgoing, b'S')
        remaining, h = size, hashlib.sha256()
        with (stage / '.part').open('xb') as out:
            while remaining:
                block = ch.read_exact(incoming, min(remaining, ch.CHUNK))
                authorized()
                out.write(block)
                h.update(block)
                remaining -= len(block)
            need(h.hexdigest() == sha, 'Cold object differs from the reviewed digest.')
            out.flush()
            os.fsync(out.fileno())
        os.rename(stage / '.part', dest)
        ch.sync_directory(stage)
        ch.reply(outgoing, b'K')
    need(not incoming.read(1), 'Unexpected trailing cold data.')
    ch.reply(outgoing, b'D')


def send(s, value, state):
    token = ch.digest(ch.canonical(value))
    if (state / 'sent.json').exists():
        result = ch.record(state / 'sent.json')
        need(result['offer'] == token, 'Source already completed a different offer.')
        return result
    validate_offer(s, value)
    need(ch.record(state / 'offer.json') == value, 'Source credential differs from review.')
    raw = (state / 'manifest.json').read_bytes()
    rows = checked(s, value, raw)
    sent = retained = 0
    with scope.fenced(s):
        paths = scope.files(s)
        identities = ch.record(state / 'source-identities.json')
        need(
            list(paths) == [r[0] for r in rows]
            and set(paths) == identities.keys()
            and all(list(scope.identity(p.lstat())) == identities[n] for n, p in paths.items()),
            'Source cold inventory changed.',
        )
        child = subprocess.Popen(
            ch.ssh_command(s, state), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        try:
            signal.alarm(max(1, value['expires'] - int(time.time())))
            ch.reply(child.stdin, struct.pack('!I', len(raw)) + raw)
            rate = s['rateKiB'] * 1024
            due = time.monotonic()

            def transmit(block):
                nonlocal due
                for j in range(0, len(block), min(rate, ch.CHUNK)):
                    part = block[j : j + min(rate, ch.CHUNK)]
                    due = max(time.monotonic(), due) + len(part) / rate
                    time.sleep(max(0, due - time.monotonic()))
                    child.stdin.write(part)
                child.stdin.flush()

            for name, size, sha, reused in rows:
                if reused:
                    continue
                answer = ch.read_exact(child.stdout, 1)
                if answer == b'H':
                    retained += 1
                    continue
                need(answer == b'S', 'Cold receiver refused a file.')
                need(
                    scope.inspect(paths[name], transmit, expected=identities[name]) == (size, sha),
                    'Source cold bytes differ from the offer.',
                )
                need(ch.read_exact(child.stdout, 1) == b'K', 'Cold receiver did not confirm a file.')
                sent += 1
            child.stdin.close()
            need(
                ch.read_exact(child.stdout, 1) == b'D' and child.wait(timeout=30) == 0,
                'Cold transfer completion is unconfirmed.',
            )
        finally:
            signal.alarm(0)
            if child.poll() is None:
                child.kill()
            child.wait()
    result = {
        'offer': token,
        'manifest': value['manifest'],
        'transferredFiles': sent,
        'previouslyTransferred': retained,
        'reusedHotFiles': value['reuseFiles'],
        'bytes': value['bytes'],
    }
    ch.write_record(state / 'sent.json', result)
    return result


def sealed_rows(s, value, stage):
    original = hot(s, False)
    inventory = stage / '.inventory'
    with scope.regular(inventory) as f:
        raw = f.read(ch.FRAME_MAX + 1)
    rows = checked(s, value, raw)
    expected = {flat(i) for i, r in enumerate(rows) if not r[3]} | {'.inventory'}
    need(
        {p.name for p in stage.iterdir()} == expected,
        'Cold stage inventory is incomplete or contains extra objects.',
    )
    return [
        (name, size, sha, original / Path(name).name if reused else stage / flat(i))
        for i, (name, size, sha, reused) in enumerate(rows)
    ]


def verify(stage, s, value):
    token = ch.digest(ch.canonical(value))
    need(
        ch.record(ch.ROOT / s['id'] / ('approved-' + token + '.json')) == {'offer': token},
        'Cold credential was never granted.',
    )
    for _, size, sha, path in sealed_rows(s, value, stage):
        need(scope.inspect(path) == (size, sha), 'Sealed cold or reused hot bytes differ.')
    return {
        'format': FORMAT,
        'offer': token,
        'bytes': value['bytes'],
        'files': value['files'],
        'reusedHotBytes': value['reuseBytes'],
        'reusedHotFiles': value['reuseFiles'],
    }


def clone(source, dest, size, sha):
    fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as out, scope.regular(source) as inp:
        try:
            fcntl.ioctl(
                out.fileno(), 0x40049409, inp.fileno()
            )  # Linux FICLONE always creates a separate inode.
        except OSError as error:
            if error.errno not in (errno.EOPNOTSUPP, errno.ENOTTY, errno.EXDEV, errno.EINVAL):
                raise
            shutil.copyfileobj(inp, out, scope.CHUNK)
        out.flush()
        os.fsync(out.fileno())
    need(
        scope.inspect(dest) == (size, sha) and not os.path.samestat(source.stat(), dest.stat()),
        'Independent target copy failed SHA verification.',
    )


def adopt(s, value, state):
    token = ch.digest(ch.canonical(value))
    stage = ch.stage_path(s)
    ch.same_stage(stage, ch.record(state / 'stage.json'))
    seal = ch.record(state / 'sealed.json')
    need(
        seal['sealed'] and seal['offer'] == token and seal['manifest'] == value['manifest'],
        'Only the exact sealed cold receipt can be adopted.',
    )
    user = pwd.getpwnam(s['targetUser'])
    need(
        user.pw_uid == s['targetUid'] and user.pw_gid == s['targetGid'],
        'Linux account mapping differs from the review.',
    )
    parent = ch.physical(Path(s['candidateParent']), True)
    dest = parent / ('bitcoin-' + s['id'])
    work = parent / ('.bitcoin-' + s['id'])
    journal = state / 'candidate.json'
    if not journal.exists():
        need(
            not os.path.lexists(dest) and not os.path.lexists(work),
            'Candidate name already exists without an operation receipt.',
        )
        work.mkdir(mode=0o700)
        st = work.stat()
        ch.write_record(journal, {'identity': [st.st_dev, st.st_ino], 'offer': token})
        ch.sync_directory(parent)
    binding = ch.record(journal)
    need(binding['offer'] == token, 'Candidate was created for another offer.')
    if dest.exists():
        ch.same_stage(dest, binding)
        need(
            not os.path.lexists(work) and (state / 'candidate-ready.json').exists(),
            'Candidate publication is ambiguous.',
        )
        ready = ch.record(state / 'candidate-ready.json')
        need(
            (not (state / 'publication-intent.json').exists() or (state / 'restored.json').exists())
            and directory_id(dest / 'data') == ready['dataIdentity'],
            'The adopted data directory is not at its recorded candidate path.',
        )
        os.chown(dest, 0, user.pw_gid)
        os.chmod(dest, 0o710)
        ch.sync_directory(dest)
        return ready
    ch.same_stage(work, binding)
    need(
        work.stat().st_uid == 0 and stat.S_IMODE(work.stat().st_mode) == 0o700,
        'Private candidate isolation changed.',
    )
    # Keep the root-only outer directory while building. No service can modify partial contents.
    tree = work / 'data'
    tree.mkdir(mode=0o700, exist_ok=True)
    base = tree / 'regtest' if s['chain'] == 'regtest' else tree
    base.mkdir(mode=0o700, exist_ok=True)
    expected = set()
    for relative, size, sha, source in sealed_rows(s, value, stage):
        file = base / relative
        expected.add(file)
        file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        scope.physical(file.parent)
        part = work / 'pending'
        if os.path.lexists(part):
            with scope.regular(part):
                pass
            part.unlink()
        if os.path.lexists(file):
            need(
                scope.inspect(file) == (size, sha) and not os.path.samestat(source.stat(), file.stat()),
                'Partial candidate differs.',
            )
        else:
            clone(source, part, size, sha)
            os.rename(part, file)
            ch.sync_directory(file.parent)
    directories = {d for p in expected for d in p.parents if d == tree or tree in d.parents}
    for p in tree.rglob('*'):
        need(
            p in expected or p in directories and stat.S_ISDIR(p.lstat().st_mode),
            'Unexpected candidate entry.',
        )
    for p in sorted(expected | directories, key=lambda d: len(d.parts), reverse=True):
        os.chmod(p, 0o700 if p in directories else 0o600)
        os.chown(p, user.pw_uid, user.pw_gid, follow_symlinks=False)
        if p in directories:
            ch.sync_directory(p)
    result = {
        'candidate': str(dest / 'data'),
        'identity': binding['identity'],
        'dataIdentity': directory_id(tree),
        'manifest': value['manifest'],
        'offer': token,
        'owner': user.pw_name,
        'uid': user.pw_uid,
        'gid': user.pw_gid,
        'files': value['files'],
        'bytes': value['bytes'],
        'chain': s['chain'],
        'minimumHeight': s['anchorHeight'],
        'checkpoint': s['anchorHash'],
        'sourceFormatPreserved': True,
    }
    ch.write_record(state / 'candidate-ready.json', result)
    ch.sync_directory(work)
    # RENAME_NOREPLACE prevents replacing an unrelated empty directory even in a race.
    libc = ctypes.CDLL(None, use_errno=True)
    need(
        libc.renameat2(-100, os.fsencode(work), -100, os.fsencode(dest), 1) == 0,
        'Could not publish a unique candidate directory.',
    )
    ch.sync_directory(parent)
    # Outer root-owned execute-only-for-group traversal lets exactly the service GID access its private data/.
    os.chown(dest, 0, user.pw_gid)
    os.chmod(dest, 0o710)
    ch.sync_directory(dest)
    return result


def inactive(unit):
    fields = 'Id,LoadState,ActiveState,SubState,MainPID'
    p = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--no-pager', '--property=' + fields, '--', unit],
        capture_output=True,
        timeout=15,
    )
    state = dict(line.split('=', 1) for line in p.stdout.decode().splitlines())
    need(
        state.get('Id') == unit
        and state.get('LoadState') in ('loaded', 'not-found', 'masked')
        and state.get('ActiveState') == 'inactive'
        and state.get('SubState') == 'dead'
        and state.get('MainPID') == '0',
        'The target unit must be inactive with no main process.',
    )


def directory_id(path):
    try:
        st = path.lstat()
    except FileNotFoundError:
        return None
    need(stat.S_ISDIR(st.st_mode), 'A publication path is not a physical directory.')
    return [str(st.st_dev), str(st.st_ino)]


def publish(action, s, value, state, installation):
    need(
        set(installation) == {'dataDir', 'unit', 'previous'}
        and scope.absolute(installation['dataDir'])
        and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9@_.-]{0,100}\.service', installation['unit']),
        'Invalid target publication scope.',
    )
    target = Path(installation['dataDir'])
    # Different cold operation UUIDs can address the same canonical path. Serialize
    # its inode precondition with the exchange on that host.
    target_lock = ch.ROOT / ('bitcoin-publication-' + ch.digest(os.fsencode(target)) + '.lock')
    with ch.lock(target_lock, create=True):
        return publish_locked(action, s, value, state, installation, target)


def publish_locked(action, s, value, state, installation, target):
    parent = ch.physical(Path(s['candidateParent']), True)
    outer = parent / ('bitcoin-' + s['id'])
    candidate = outer / 'data'
    ch.physical(target.parent, True)
    ch.same_stage(outer, ch.record(state / 'candidate.json'))
    need(
        target != parent
        and target not in candidate.parents
        and candidate not in target.parents
        and target != candidate,
        'The canonical and disposable paths must be disjoint.',
    )
    seal, proof = ch.record(state / 'sealed.json'), ch.record(state / 'qualified.json')
    need(
        seal['offer'] == ch.digest(ch.canonical(value))
        and proof['manifest'] == seal['manifest']
        and proof['candidate'] == str(candidate)
        and proof['cleanStop']
        and proof['version'] == 320100,
        'The exact candidate has not qualified.',
    )
    previous = installation['previous']
    if previous.get('kind') == 'absent' and set(previous) == {'kind'}:
        old = None
    else:
        need(
            previous.get('kind') == 'empty'
            and set(previous) == {'kind', 'device', 'inode'}
            and all(re.fullmatch(r'[1-9][0-9]{0,24}', previous[k]) for k in ('device', 'inode')),
            'An absent or identified empty target is required.',
        )
        old = [previous['device'], previous['inode']]
    inactive(installation['unit'])
    journal = state / 'publication-intent.json'

    def coordinates():
        return directory_id(candidate), directory_id(target)

    if not journal.exists():
        need(action == 'publish', 'This operation never published the target.')
        new, current = coordinates()
        need(
            new == proof['dataIdentity']
            and current == old
            and (current is None or not any(target.iterdir())),
            'The candidate or the canonical target has other data or identity.',
        )
        need(
            int(new[0]) == target.parent.stat().st_dev,
            'Atomic publication requires the same target filesystem.',
        )
        ch.write_record(
            journal, {'installation': installation, 'candidate': new, 'offer': seal['offer'], 'previous': old}
        )
    binding = ch.record(journal)
    need(
        binding['installation'] == installation
        and binding['offer'] == seal['offer']
        and binding['previous'] == old,
        'Another target already binds the operation.',
    )
    new = binding['candidate']
    before, after = (new, old), (old, new)
    current = coordinates()
    need(
        current in (before, after),
        'Candidate or target path was substituted; reconcile its physical identity.',
    )
    published = state / 'published.json'
    restored = state / 'restored.json'
    result = {
        'installed': action == 'publish',
        'canonical': str(target),
        'candidateIdentity': new,
        'previousIdentity': old,
        'qualifiedTip': proof['tip'],
        'qualifiedHeight': proof['height'],
        'manifest': value['manifest'],
    }
    complete = published if action == 'publish' else restored
    if action == 'publish':
        need(not (state / 'restore-intent.json').exists(), 'A restored publication is closed.')
        origin, destination, expected, finished = candidate, target, before, after
    else:
        need(published.exists(), 'Original publication has no confirmed receipt.')
        origin, destination, expected, finished = target, candidate, after, before
        if not (state / 'restore-intent.json').exists():
            ch.write_record(state / 'restore-intent.json', {'operation': s['id'], 'candidate': new})
    if complete.exists():
        need(
            current == finished and ch.record(complete) == result,
            'The recorded handoff now has different paths.',
        )
        return result
    if current == expected:
        need(old is None or not any(destination.iterdir()), 'The reviewed previous directory gained content.')
        with scope.target_tree(s, origin) as witness:
            if action == 'publish':
                need(
                    witness == proof['treeWitness'], 'Public chain files changed after native qualification.'
                )
            inactive(installation['unit'])
            libc = ctypes.CDLL(None, use_errno=True)
            flag = 1 if old is None else 2  # Linux RENAME_NOREPLACE or RENAME_EXCHANGE
            need(
                libc.renameat2(-100, os.fsencode(origin), -100, os.fsencode(destination), flag) == 0,
                'Atomic target handoff failed.',
            )
            ch.sync_directory(origin.parent)
            ch.sync_directory(destination.parent)
    need(coordinates() == finished, 'The target handoff outcome is unconfirmed.')
    if current == finished and action == 'publish':
        with scope.target_tree(s, target) as witness:
            need(
                witness == proof['treeWitness'],
                'Unconfirmed publication has changed since native qualification.',
            )
    inactive(installation['unit'])
    ch.write_record(complete, result)
    return result


def main(args):
    if args[0] == 'check-hot-seal':
        s = json.loads(base64.b64decode(args[1], validate=True))
        scope.validate(s)
        need(
            sys.platform == 'linux'
            and os.geteuid() == 0
            and ch.fingerprint(ch.key_text(ch.HOST_KEY)) == s['receiverFingerprint'],
            'The reviewed hot receiver is required.',
        )
        hot(s, False)
        sealed = ch.record(ch.ROOT / s['hotId'] / 'sealed.json')
        print(
            ch.canonical({key: sealed[key] for key in ('sealed', 'manifest', 'files', 'bytes')}).decode(),
            flush=True,
        )
        return
    if args[0] in ('adopt', 'publish', 'restore'):
        values = [json.loads(base64.b64decode(x, validate=True)) for x in args[1:]]
        s, value = values[:2]
        scope.validate(s)
        need(
            sys.platform == 'linux'
            and os.geteuid() == 0
            and ch.fingerprint(ch.key_text(ch.HOST_KEY)) == s['receiverFingerprint'],
            'The reviewed Linux receiver is required.',
        )
        state = ch.physical(ch.ROOT / s['id'], True)
        with ch.lock(state / 'admin.lock'):
            need(ch.record(state / 'spec.json') == s, 'Candidate operation mismatch.')
            result = (
                adopt(s, value, state) if args[0] == 'adopt' else publish(args[0], s, value, state, values[2])
            )
            print(ch.canonical(result).decode(), flush=True)
    else:
        ch.entry(
            args,
            SimpleNamespace(
                validate_spec=scope.validate,
                validate_offer=validate_offer,
                offer=offer,
                send=send,
                receive=receive,
                verify=verify,
                allowed=allowed,
                retained_mode=0o444,
            ),
        )


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (scope.Refused, ch.Refusal) as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit('Bitcoin cold endpoint failed (' + type(error).__name__ + ').')
