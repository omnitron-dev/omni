"""Bind a controller snapshot to the native owner's live incarnation and clean stop."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess

from controller_files import READ, digest, require, signature

UNITS = ('omnitron-owner.service', 'omnitron-daemon.service')
BOOT = Path('/proc/sys/kernel/random/boot_id')
SYSTEMD = Path('/etc/systemd/system')
CGROUP = Path('/sys/fs/cgroup')
ADMIN_UID = 0


def system(*args):
    answer = subprocess.run(['/usr/bin/systemctl', *args], capture_output=True, timeout=25, check=False)
    require(answer.returncode == 0, 'The system service manager could not confirm the control roles')
    return answer.stdout.decode()


def units():
    result = {}
    for unit in UNITS:
        info = dict(line.split('=', 1) for line in system('show', '--property=LoadState,ActiveState,SubState,MainPID,InvocationID,DropInPaths,ControlGroup', unit).splitlines() if '=' in line)
        require(info.get('LoadState') == 'loaded', 'Expected a loaded controller system unit')
        result[unit] = info
    return result


def holder(path, uid):
    require(path.name == 'managed-owner.json' and path.is_absolute() and path.resolve(strict=True) == path,
            'A physical native managed-owner receipt is required')
    for directory in path.parents:
        st = directory.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid in (0, uid) and not st.st_mode & 0o022,
                'Unsafe managed-owner receipt directory')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        st = os.fstat(source.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_uid == uid and st.st_nlink == 1 and st.st_size <= 4096 and not st.st_mode & 0o077,
                'Unsafe managed-owner receipt')
        item = json.load(source)
        require(signature(os.fstat(source.fileno())) == signature(st), 'Managed owner changed while observed')
    require(type(item.get('pid')) is int and item['pid'] > 1 and type(item.get('clean')) is bool
            and item.get('bootId') == BOOT.read_text().strip(), 'The managed owner belongs to another host boot')
    return item, [str(st.st_dev), str(st.st_ino), str(st.st_mtime_ns), str(st.st_ctime_ns)]


def live(spec):
    state = units()
    raw, _ = holder(Path(spec['ownerReceipt']), spec['sourceUid'])
    result = {}
    for unit, v in state.items():
        pid = int(v['MainPID'])
        require(v['ActiveState'] == 'active' and pid > 1 and Path('/proc', str(pid)).stat().st_uid == spec['sourceUid']
                and re.fullmatch('[0-9a-f]{32}', v['InvocationID']), 'A live original controller pair is required')
        cgroup = v.get('ControlGroup', '')
        require((CGROUP / 'cgroup.controllers').is_file() and cgroup.startswith('/') and Path(cgroup).name == unit
                and str(Path(cgroup)) == cgroup and '..' not in Path(cgroup).parts,
                'Expected the original systemd cgroup on a unified Linux hierarchy')
        group = CGROUP / cgroup.lstrip('/')
        require(str(pid) in (group / 'cgroup.procs').read_text().split(), 'Original unit PID is outside its reported cgroup')
        result[unit] = {'pid': pid, 'invocation': v['InvocationID'], 'cgroup': cgroup}
    require(not raw['clean'] and raw['pid'] == result[UNITS[0]]['pid'], 'Unexpected initial managed owner')
    return {'boot': raw['bootId'], 'units': result}


def stopped(spec, anchor):
    state = units()
    require(all(s['ActiveState'] == 'inactive' and s['SubState'] == 'dead' and s['MainPID'] == '0'
                for s in state.values()), 'Both controller system units must be stopped')
    raw, identity = holder(Path(spec['ownerReceipt']), spec['sourceUid'])
    require(raw['clean'] and raw['bootId'] == anchor['boot'] and raw['pid'] == anchor['units'][UNITS[0]]['pid'],
            'Clean stop does not belong to the original owner')
    for v in anchor['units'].values():
        require(not Path('/proc', str(v['pid'])).exists(), 'An original role PID is still present')
        group = CGROUP / v['cgroup'].lstrip('/')
        require((CGROUP / 'cgroup.controllers').is_file(), 'Unified cgroup source is unavailable')
        if group.exists():
            events = dict(x.split() for x in (group / 'cgroup.events').read_text().splitlines())
            require(events.get('populated') == '0', 'An original controller cgroup still has a process')
    return {'anchor': digest(anchor), 'boot': raw['bootId'], 'ownerPid': raw['pid'], 'receiptIdentity': identity}


def condition_text(marker):
    return '[Unit]\nConditionPathExists=!' + str(marker) + '\n'


def check_condition(file, marker):
    expected = condition_text(marker).encode()
    with os.fdopen(os.open(file, READ), 'rb') as src:
        st = os.fstat(src.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_uid == ADMIN_UID and st.st_nlink == 1 and not st.st_mode & 0o022
                and st.st_size == len(expected) and src.read(len(expected) + 1) == expected,
                'The systemd recovery condition differs from the approved hold')


def restore_ticket(spec, baseline):
    return {'id': spec['id'], 'snapshot': spec['restore']['sha256'], 'fence': baseline}


def lock_restore(state, spec, baseline, channel):
    """Persistent systemd conditions protect in-place replay even if the transfer process exits."""
    marker = state / 'restoring.json'
    condition = condition_text(marker)
    ticket = restore_ticket(spec, baseline)
    if marker.exists():
        require(channel.record(marker) == ticket, 'Existing restore fence differs')
    else:
        channel.write_record(marker, ticket)
    for unit in UNITS:
        folder = SYSTEMD / (unit + '.d')
        folder.mkdir(mode=0o755, exist_ok=True)
        channel.physical(folder, True)
        file = folder / '95-omnitron-controller-snapshot.conf'
        if os.path.lexists(file):
            check_condition(file, marker)
        else:
            fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
            with os.fdopen(fd, 'w') as dst:
                dst.write(condition)
                dst.flush()
                os.fsync(dst.fileno())
            channel.sync_directory(folder)
    system('daemon-reload')
    verify_hold(state, spec, baseline)


def verify_hold(state, spec, baseline):
    marker = state / 'restoring.json'
    with os.fdopen(os.open(marker, READ), 'rb') as src:
        st = os.fstat(src.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_uid == ADMIN_UID and st.st_nlink == 1 and not st.st_mode & 0o077
                and 0 < st.st_size <= 8192 and json.load(src) == restore_ticket(spec, baseline),
                'Different or unsafe restore marker')
    for unit, s in units().items():
        file = SYSTEMD / (unit + '.d') / '95-omnitron-controller-snapshot.conf'
        check_condition(file, marker)
        require(str(file) in s['DropInPaths'].split() and s['MainPID'] == '0' and s['ActiveState'] == 'inactive',
                'A durable inactive service hold is required')
    require(stopped(spec, baseline['source']) == baseline['closed'], 'Original source fence changed')


def release_restore(state, spec, baseline, channel):
    marker = state / 'restoring.json'
    intent = state / 'release-intent.json'
    expected = {'snapshot': spec['restore']['sha256'], 'fence': baseline}
    if intent.exists():
        require(channel.record(intent) == expected, 'Different pending release')
    else:
        verify_hold(state, spec, baseline)
        channel.write_record(intent, expected)
    owned = [SYSTEMD / (u + '.d') / '95-omnitron-controller-snapshot.conf' for u in UNITS]
    for file in owned:
        if os.path.lexists(file):
            check_condition(file, marker)
    # All bytes were verified before the release intent became durable. Retry only its own remaining work.
    marker.unlink(missing_ok=True)
    channel.sync_directory(state)
    for file in owned:
        file.unlink(missing_ok=True)
        channel.sync_directory(file.parent)
    system('daemon-reload')
