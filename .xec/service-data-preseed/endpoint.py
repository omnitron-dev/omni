"""Run inside a registered Linux management step, or as one pre-authorized, unprivileged SSH forced command."""
import base64
import datetime
import fcntl
import gzip
import ipaddress
import shlex
import signal
import subprocess
import sys
import time
from service_data_scope import P, UUID, RESERVED, identity, demand, inventory, validate_scope, sha, hashlib, json, os, re, stat

ROOT = P('/var/lib/omnitron-service-data')
SAFE_PATH = '/usr/sbin:/usr/bin:/sbin:/bin'
def output(argv, *, data=None, timeout=60):
    result = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=timeout, check=False, env={'PATH': SAFE_PATH, 'LC_ALL': 'C'})
    demand(result.returncode == 0, 'Required endpoint check failed: ' + P(argv[0]).name)
    return result.stdout

def json_output(argv):
    return json.loads(output(argv))

def trusted_dir(path):
    demand(path.is_absolute() and path.resolve(strict=True) == path, 'A physical directory is required')
    for directory in (path, *path.parents):
        st = directory.lstat()
        demand(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022,
               'Root must own all grant and staging ancestors')
    return path

def local_record(state, name):
    trusted_dir(state)
    path = state / name
    st = path.lstat()
    demand(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and not st.st_mode & 0o027
           and st.st_size <= 65536, 'Unsafe or missing local grant')
    return json.loads(path.read_bytes())

def permit(state, s, side):
    grant = local_record(state, side + '.json')
    fields = {'schema', 'spec', 'expires', 'key'} | ({'device', 'inode'} if side == 'receiver' else set())
    demand(set(grant) == fields and grant['schema'] == 1 and grant['spec'] == sha(s)
           and type(grant['expires']) is int and 0 < grant['expires'] - time.time() <= s['ttlMinutes'] * 60,
           'Missing, expired or foreign endpoint grant')
    ch.fingerprint(grant['key'])
    demand(re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]{68}', grant['key']), 'Invalid operation public key')
    if GRANTS:
        reviewed = GRANTS[side]
        demand(reviewed['side'] == side and reviewed['spec'] == grant['spec'] and
               reviewed['keySha256'] == ch.fingerprint(grant['key']) and reviewed['expires'] == grant['expires'],
               'Endpoint key or lease differs from the reviewed admission receipt')
    return grant

def stage_path(s):
    return trusted_dir(P(s['stageParent'])) / ('service-data-' + s['id'])

def stage_identity(s, grant):
    stage = stage_path(s)
    st = stage.lstat()
    demand(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o027
           and [str(st.st_dev), str(st.st_ino)] == [grant['device'], grant['inode']], 'Private stage differs from its local grant')
    return stage

def account_name(s):
    return 'osd' + s['id'].replace('-', '')[:20]

def restricted_command(s, state):
    return '/usr/bin/python3 -I ' + str(state / 'receiver.py') + ' receive ' + s['id']

def receiver_setup(s, state, grant):
    import pwd
    stage = stage_identity(s, grant)
    user = pwd.getpwnam(account_name(s))
    demand(user.pw_uid != 0 and user.pw_gid != 0 and user.pw_shell == '/bin/sh' and user.pw_dir == str(state / 'home')
           and os.getgrouplist(user.pw_name, user.pw_gid) == [user.pw_gid], 'Unexpected restricted transfer account')
    expiry = datetime.datetime.fromtimestamp(grant['expires'], datetime.timezone.utc).strftime('%Y%m%d%H%M%SZ')
    expected = 'restrict,from="{}",expiry-time="{}",command="{}" {}'.format(s['sourceIp'], expiry, restricted_command(s, state), grant['key'])
    ssh = trusted_dir(state / 'home' / '.ssh')
    keyfile = ssh / 'authorized_keys'
    k = keyfile.lstat()
    demand(stat.S_ISREG(k.st_mode) and k.st_nlink == 1 and k.st_uid == 0 and not k.st_mode & 0o027
           and keyfile.stat().st_size < 4096 and keyfile.read_text().splitlines() == [expected], 'Receiver key must be bound to exactly this operation')
    helper = state / 'receiver.py'
    h = helper.lstat()
    demand(stat.S_ISREG(h.st_mode) and h.st_uid == 0 and h.st_nlink == 1 and not h.st_mode & 0o027
           and hashlib.sha256(helper.read_bytes()).digest() == hashlib.sha256(SELF.encode()).digest(),
           'Installed restricted receiver differs from the reviewed helper')
    demand(set(os.listdir(stage)) == {r['tag'] for r in s['volumes']}, 'Stage contains an unexpected tree')
    for row in s['volumes']:
        st = (stage / row['tag']).lstat()
        demand(stat.S_ISDIR(st.st_mode) and st.st_uid == user.pw_uid and st.st_dev == stage.stat().st_dev,
               'A target tree is not reserved for the transfer account')
    return stage, user

def locked(state, fn):
    st = (state / 'session.lock').lstat()
    demand(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and not st.st_mode & 0o027,
           'Invalid operation lock')
    with (state / 'session.lock').open('rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fn()

def closed(state):
    return os.path.lexists(state / 'closed.json')

def receiver_rsync(s, stage, original):
    command = shlex.split(original)
    demand(len(command) >= 4 and command[:2] == ['rsync', '--server'] and '--sender' not in command and command[-2] == '.'
           and command[-1] in {r['tag'] + '/' for r in s['volumes']}, 'Receiver accepts a push to one declared volume')
    directory = stage / command[-1][:-1]
    return ['/usr/bin/rrsync', '-wo', '-munge', '-no-lock', str(directory)], shlex.join(command[:-1] + ['.'])

def receive(state, s):
    demand(os.getuid() != 0 and os.environ.get('SSH_CONNECTION', '').split()[:1] == [s['sourceIp']], 'Unexpected SSH identity')
    def serve():
        grant = permit(state, s, 'receiver')
        stage, user = receiver_setup(s, state, grant)
        admission = local_record(state, 'receiver-admission.json')
        demand(admission['spec'] == sha(s) and admission['keySha256'] == ch.fingerprint(grant['key']),
               'The dedicated receiver grant has not been independently admitted')
        demand(not closed(state) and os.getuid() == user.pw_uid, 'The receiver has closed admission')
        args, original = receiver_rsync(s, stage, os.environ.get('SSH_ORIGINAL_COMMAND', ''))
        env = {'PATH': SAFE_PATH, 'HOME': user.pw_dir, 'LC_ALL': 'C',
               'SSH_ORIGINAL_COMMAND': original}
        child = subprocess.Popen(args, env=env, start_new_session=True)
        try:
            while child.poll() is None:
                demand(time.time() < grant['expires'] and not closed(state), 'Receiver authority expired or was revoked')
                time.sleep(0.5)
            demand(child.returncode == 0, 'Restricted rsync receiver failed')
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    locked(state, serve)

def mounts():
    table = {}
    for line in P('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split()
        mounted = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), fields[4])
        table[mounted] = (fields[0], set(fields[5].split(',')))
    return table

def volume_path(row, data_root):
    volume = json_output(['docker', 'volume', 'inspect', '--format', '{{json .}}', row['volume']])
    root = data_root / 'volumes' / row['volume'] / '_data'
    demand(volume['Name'] == row['volume'] and volume['Driver'] == 'local' and not volume['Options']
           and volume['Mountpoint'] == str(root) and root.resolve(strict=True) == root,
           'Source must be the declared native local Docker volume')
    st = root.stat()
    demand([str(st.st_dev), str(st.st_ino)] == [row['device'], row['inode']], 'Named volume was replaced')
    return root

def source_roots(s, state, live, prepare=False):
    table = mounts()
    data_root = P(output(['docker', 'info', '--format', '{{.DockerRootDir}}']).decode().strip())
    demand(data_root.is_absolute() and data_root.resolve(strict=True) == data_root and
           data_root != P('/') and P('/root') not in (data_root, *data_root.parents), 'Unexpected Docker data root')
    rows = s['volumes']
    roots, originals = {}, {}
    for row in rows:
        tag = row['tag']
        src = volume_path(row, data_root)
        export = state / 'exports' / tag
        demand(not any(key.startswith(str(src) + '/') or key.startswith(str(export) + '/') for key in table),
               'Nested mounts require independent review')
        roots[tag], originals[tag] = export, src
    if live:
        for kind in ('postgres', 'nominatim', 'redis', 'minio'):
            expected = [r for r in rows if identity(r) == kind]
            cid = expected[0]['container']
            fmt = '{"id":{{json .Id}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}'
            item = json_output(['docker', 'inspect', '--type', 'container', '--format', fmt, cid])
            labels = item['labels']
            demand(item['id'] == cid and item['image'] == expected[0]['image'] and labels.get('omnitron.managed') == 'true' and
                   [labels.get('omnitron.'+k) for k in ('project', 'stack', 'service')] == [s['project'], s['stack'], kind],
                   'A reviewed container/image belongs to another service or stack')
            named = {m['Destination']: m for m in item['mounts'] if m.get('Type') == 'volume'}
            demand(set(named) == {r['target'] for r in expected} and not any(m.get('RW') and m['Type'] != 'volume'
                   for m in item['mounts']), 'Unreviewed writable mount or incomplete service layout')
            for r in expected:
                m = named[r['target']]
                demand(m.get('RW') and m['Name'] == r['volume'] and m['Source'] == str(originals[r['tag']]), 'Container volume binding differs')
    if prepare:
        (state / 'exports').mkdir(mode=0o700, exist_ok=True)
        trusted_dir(state / 'exports')
    for tag, export in roots.items():
        if prepare and str(export) not in table:
            export.mkdir(mode=0o700, exist_ok=True)
            trusted_dir(export)
            demand(not any(export.iterdir()), 'A source bind would cover existing files')
            output(['mount','--bind',str(originals[tag]),str(export)])
        if prepare:
            demand(export.resolve(strict=True) == export and os.path.samestat(originals[tag].stat(),export.stat()),
                   'Source export does not identify its reviewed volume')
            output(['mount','-o','remount,bind,ro,nosuid,nodev,noexec',str(export)])
    if prepare:
        table = mounts()
    for tag, export in roots.items():
        demand(export.resolve(strict=True) == export and os.path.samestat(originals[tag].stat(),export.stat()) and
               'ro' in table.get(str(export), ('', set()))[1], 'Grant needs the independently mounted, read-only source volume')
    return roots, originals

def run_validator(row, root, tool, *args):
    st = root.stat()
    return output(['docker','run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--user',str(st.st_uid)+':'+str(st.st_gid),
        '--mount','type=volume,source='+row['volume']+',target=/input,readonly','--entrypoint',tool,
        '-e','LC_ALL=C',row['image'],*args], timeout=21600)

def check_cold(s, roots, originals, persistence=None, state=None):
    cids = output(['docker', 'ps', '--no-trunc', '-q']).decode().split()
    for cid in cids:
        fmt = '{"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}'
        item = json_output(['docker','inspect','--type','container','--format',fmt,cid])
        labels = item['labels'] or {}
        demand([labels.get('omnitron.project'),labels.get('omnitron.stack')] != [s['project'],s['stack']], 'Stack infrastructure is still running')
        for m in item['mounts']:
            if not m.get('RW') or not m.get('Source'):
                continue
            source = P(m['Source']).resolve()
            demand(not any(source == path or source in path.parents or path in source.parents for path in [*originals.values(), *roots.values()]),
                   'A running container can write a granted volume')
    if persistence is None:
        return
    for tag, major, tool in [('postgres-data','17','pg_controldata'),('nominatim-data','14','/usr/lib/postgresql/14/bin/pg_controldata')]:
        root = roots[tag]
        demand((root / 'PG_VERSION').read_text().strip() == major and not os.path.lexists(root / 'postmaster.pid'),
               'PostgreSQL version or shutdown marker differs')
        row = next(r for r in s['volumes'] if r['tag'] == tag)
        result = run_validator(row, root, tool, '/input').decode()
        demand(re.search(r'^Database system identifier:\s*'+s['clusters'][identity(row)]+r'\s*$', result, re.M), 'PostgreSQL system identifier differs')
        demand(re.search(r'^Database cluster state:\s*shut down\s*$', result, re.M), 'PostgreSQL must report a clean shutdown')
        redo = re.search(r"^Latest checkpoint's REDO WAL file:\s*([A-F0-9]{24})\s*$", result, re.M)
        segment_size = re.search(r'^Bytes per WAL segment:\s*([0-9]+)\s*$', result, re.M)
        wal = roots.get(identity(row)+'-wal', root/'pg_wal')
        demand(redo and segment_size and stat.S_ISDIR(wal.lstat().st_mode), 'No reviewed final WAL directory')
        segment = (wal/redo[1]).lstat()
        demand(stat.S_ISREG(segment.st_mode) and segment.st_size == int(segment_size[1]), 'Final PostgreSQL checkpoint WAL is missing or short')
    demand((roots['nominatim-flatnode'] / 'flatnode.file').is_file() and (roots['nominatim-data'] / 'import-finished').is_file(),
           'Nominatim import marker or flatnode is missing')
    demand((roots['minio-data'] / '.minio.sys' / 'format.json').is_file(), 'MinIO data format is missing')
    redis = roots['redis-data']
    files = [redis / 'dump.rdb', redis / 'appendonly.aof', *redis.glob('*/*.manifest')]
    selected = [p for p in files if os.path.lexists(p)]
    demand(selected and all(stat.S_ISREG(p.lstat().st_mode) for p in selected), 'No durable Redis persistence was found')
    demand(any(p.name != 'dump.rdb' for p in selected) if persistence == 'aof' else redis/'dump.rdb' in selected,
           'The persistence selected by the admitted Redis process is missing')
    if persistence == 'rdb':
        # A structurally valid older RDB also passes redis-check-rdb. Bind the final, fenced SAVE to these bytes.
        receipt = local_record(state, 'redis-final.json')
        with (redis/'dump.rdb').open('rb') as stream:
            data = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024**2), b''):
                data.update(chunk)
        demand(receipt == {'schema':1,'spec':sha(s),'stop':STOP,'sha256':data.hexdigest()},
               'RDB-only Redis requires the service owner to attest its final fenced SAVE')
    row = next(r for r in s['volumes'] if r['tag'] == 'redis-data')
    for file in selected:
        run_validator(row, redis, 'redis-check-rdb' if file.name == 'dump.rdb' else 'redis-check-aof',
                      '/input/' + str(file.relative_to(redis)))

def source_authority(s, state):
    grant = permit(state, s, 'source')
    key = state / 'identity'
    st = key.lstat()
    demand(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and not st.st_mode & 0o077
           and not closed(state), 'Source grant is closed or the key is not private')
    demand(output(['/usr/bin/ssh-keygen', '-y', '-f', str(key)]).decode().strip().split()[:2] == grant['key'].split(),
           'Source grant key differs')
    return grant

def rsync_args(root, row, remote, transport, rate, cold, verify=False):
    args = ['/usr/bin/rsync', '-aHAXSx', '--no-devices', '--no-specials', '--numeric-ids', '-M--modify-window=-1', '-M--fake-super', '--fsync', '--compress', '--bwlimit='+str(rate),
            '--partial-dir=.rsync-partial', '--timeout=90', '-e', shlex.join(transport)]
    if cold:
        args += ['--checksum', '--delete-delay']
    elif row['tag'] in ('postgres-data','nominatim-data'):
        args += ['--exclude=/pg_wal', '--exclude=/postmaster.pid', '--exclude=/pg_stat_tmp']
    for reserved in sorted(RESERVED):
        args += ['--exclude='+os.fsdecode(reserved)]
    if verify:
        args += ['--dry-run', '--itemize-changes', '--out-format=%i']
    return args + ['--', str(root)+'/', remote+':'+row['tag']+'/']

def sync_volumes(s, state, roots, cold, verify):
    grant = source_authority(s, state)
    ch.account_name = account_name
    ssh = ch.ssh_command(s, state)
    rows = s['volumes']
    for row in rows:
        if not cold and row['tag'] in ('postgres-wal', 'nominatim-wal'):
            continue
        args = rsync_args(roots[row['tag']], row, ssh[-2], ssh[:-2], s['rateKiB'], cold, verify)
        deadline = grant['expires'] - time.time()
        demand(deadline > 0, 'Transfer grant expired')
        child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 start_new_session=True, env={'PATH': SAFE_PATH, 'LC_ALL':'C'})
        try:
            # Output contains only itemized metadata in the dry run. Never emit object names or secrets.
            changed = False
            import selectors
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    demand(time.time() < grant['expires'] and not closed(state), 'Transfer grant expired or was revoked')
                    if not selector.select(0.5):
                        continue
                    frame = os.read(child.stdout.fileno(), 65536)
                    if not frame:
                        break
                    changed = True
            code = child.wait(timeout=10)
            demand((code == 0 or (not cold and code == 24)) and not (verify and changed), 'rsync differs or was interrupted; retain and retry the private stage')
        finally:
            child.stdout.close()
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.wait()

def transfer(s, state, cold):
    source_authority(s, state)
    roots, originals = source_roots(s, state, not cold)
    demand(local_record(state, 'source-admission.json')['spec'] == sha(s), 'Source volume set has never been admitted')
    for row in s['volumes']:
        inventory(roots[row['tag']], row, s['volumes'], metadata_only=True)
    if cold:
        check_cold(s, roots, originals)
    sync_volumes(s, state, roots, cold, False)
    rows = s['volumes']
    if not cold:
        return {'provisional': True, 'id': s['id'], 'spec': sha(s)}
    writers = ch.open_writers()
    trees = {r['tag']: inventory(roots[r['tag']], r, rows, writers=writers) for r in rows}
    check_cold(s, *source_roots(s, state, False), persistence=local_record(state, 'source-admission.json')['redisPersistence'],state=state)
    result = {'id': s['id'], 'spec': sha(s), 'stop': STOP, 'trees': trees, 'sha256': sha(trees)}
    ch.write_record(state / 'cold.json', result)
    return result

def stage_stamp(stage, rows):
    # Linux ctime changes on link, ownership, permission and xattr/ACL updates. Check every inode
    # on both sides of the native rsync checksum/metadata dry run. atime is intentionally omitted.
    h = hashlib.sha256()
    def visit(path, relative):
        st = path.lstat()
        demand(stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode),
               'Receiver contains a special file')
        h.update(os.fsencode(relative) + b'\0' + ch.canonical([st.st_dev,st.st_ino,st.st_mode,st.st_nlink,
            st.st_uid,st.st_gid,st.st_size,st.st_mtime_ns,st.st_ctime_ns]) + b'\0')
        if stat.S_ISDIR(st.st_mode):
            for name in sorted(os.listdir(path), key=os.fsencode):
                visit(path / name, relative + '/' + name)
    for row in sorted(rows, key=lambda r:r['tag']):
        visit(stage / row['tag'], row['tag'])
    return h.hexdigest()

def run_action(action, s, state):
    if action == 'status':
        stage = stage_identity(s, local_record(state, 'receiver.json'))
        if (state / 'sealed.json').is_file():
            result = local_record(state, 'sealed.json')
            demand(result['id'] == s['id'] and result['spec'] == sha(s) and result['stage'] == str(stage) and closed(state),
                   'Sealed receipt or stage identity differs')
            return result
        return {'id':s['id'],'spec':sha(s),'stage':str(stage),'sealed':False,'closed':closed(state)}
    if action == 'source-grant':
        grant = source_authority(s, state)
        demand(os.access('/usr/bin/rsync',os.X_OK), 'The source requires GNU rsync')
        previous = (state / 'source-admission.json').exists()
        if previous:
            old = local_record(state, 'source-admission.json')
            demand(old['spec'] == sha(s), 'Another source was admitted')
        source_roots(s, state, not previous)
        receipt = {'side':'source','spec':sha(s),'keySha256':ch.fingerprint(grant['key']), 'expires':grant['expires']}
        if previous:
            receipt['redisPersistence'] = old['redisPersistence']
        else:
            redis = next(r for r in s['volumes'] if r['tag'] == 'redis-data')
            info = output(['docker','exec',redis['container'],'redis-cli','--raw','INFO','persistence']).decode()
            enabled = re.search(r'^aof_enabled:([01])\r?$', info, re.M)
            demand(enabled, 'The local Redis grant must permit reading its effective persistence mode')
            receipt['redisPersistence'] = 'aof' if enabled[1] == '1' else 'rdb'
        ch.write_record(state / 'source-admission.json', receipt)
        return receipt
    if action == 'receiver-grant':
        grant = permit(state, s, 'receiver')
        stage, user = receiver_setup(s, state, grant)
        output(['/usr/bin/setpriv','--reuid='+str(user.pw_uid),'--regid='+str(user.pw_gid),'--clear-groups',
                '/usr/bin/test','-x',str(stage)])
        demand(os.access('/usr/bin/rrsync',os.X_OK) and os.access('/usr/bin/rsync',os.X_OK),
               'The receiver requires the packaged GNU rsync and rrsync')
        def admit():
            demand(not closed(state), 'Receiver admission is closed')
            receipt = {'side':'receiver','spec':sha(s),'stage':str(stage),'keySha256':ch.fingerprint(grant['key']), 'expires':grant['expires']}
            if (state / 'receiver-admission.json').exists():
                old = local_record(state, 'receiver-admission.json')
                demand(old['spec'] == receipt['spec'] and old['stage'] == receipt['stage'], 'Another receiver stage was admitted')
            else:
                demand(all(not any((stage / r['tag']).iterdir()) for r in s['volumes']), 'First admission requires empty volume stages')
            ch.write_record(state / 'receiver-admission.json', receipt, 0o640, user.pw_gid)
            return receipt
        return locked(state, admit)
    if action in ('seed', 'cold'):
        ch.lower_source_priority()
        return locked(state, lambda: transfer(s, state, action == 'cold'))
    if action == 'receiver-observe':
        grant = permit(state, s, 'receiver')
        stage, _ = receiver_setup(s, state, grant)
        def observe():
            result = {'stop': STOP, 'cold': RECEIPT['sha256'], 'snapshot': stage_stamp(stage, s['volumes'])}
            ch.write_record(state / 'observed.json', result)
            return result
        return locked(state, observe)
    if action == 'source-check':
        demand(RECEIPT == local_record(state, 'cold.json') and RECEIPT['stop'] == STOP and RECEIPT['spec'] == sha(s),
               'Cold receipt is not the source-owned evidence for this exact stop')
        roots, originals = source_roots(s, state, False)
        check_cold(s, roots, originals)
        locked(state, lambda: sync_volumes(s, state, roots, True, True))
        writers = ch.open_writers()
        for row in s['volumes']:
            demand(inventory(roots[row['tag']], row, s['volumes'], writers=writers) == RECEIPT['trees'][row['tag']],
                   'A cold source tree changed after the reviewed receipt')
        check_cold(s, *source_roots(s, state, False))
        return {'spec': sha(s), 'stop': STOP, 'sha256': RECEIPT['sha256']}
    demand(action in ('revoke-source', 'revoke-receiver', 'seal'), 'Unknown action')
    if action.startswith('revoke-'):
        ch.write_record(state / 'closed.json', {'revoked': True}, 0o644)
        return locked(state, lambda: {'id': s['id'], 'revoked': True})
    grant = local_record(state, 'receiver.json')
    demand(grant['spec'] == sha(s), 'Receiver grant was changed')
    stage = stage_identity(s, grant)
    # Closing the credential before obtaining the lock also interrupts an in-flight authenticated session.
    ch.write_record(state / 'closed.json', {'stop': STOP, 'sha256': RECEIPT['sha256']}, 0o644)
    def seal():
        observed = local_record(state, 'observed.json')
        demand(observed == {'stop':STOP,'cold':RECEIPT['sha256'],'snapshot':stage_stamp(stage, s['volumes'])},
               'Target bytes, identities or filesystem metadata changed around the native checksum audit')
        os.chmod(stage, 0o700)
        rows = s['volumes']
        demand(set(os.listdir(stage)) == {r['tag'] for r in rows}, 'Unreviewed receiver directory')
        for row in rows:
            root = stage / row['tag']
            demand(stat.S_ISDIR(root.lstat().st_mode), 'Volume staging root changed')
            demand(inventory(root, row, rows, receiver=True) == RECEIPT['trees'][row['tag']], 'Cold volume differs from source receipt')
        result = {'id':s['id'],'spec':sha(s),'stop':STOP,'stage':str(stage),'sha256':RECEIPT['sha256'],'sealed':True}
        ch.write_record(state / 'sealed.json', result)
        return result
    return locked(state, seal)

def local_consent(s, side):
    authorized = local_record(P('/etc/omnitron/service-data-grants'), s['id']+'.json')
    expected = {'schema','spec','side','expires'} | ({'key'} if side == 'receiver' else set())
    demand(set(authorized) == expected and authorized['schema'] == 1 and authorized['side'] == side and
           authorized['spec'] == sha(s) and type(authorized['expires']) is int and
           0 < authorized['expires'] - time.time() <= s['ttlMinutes']*60, 'Missing, expired or foreign independent local consent')
    if side == 'receiver':
        demand(re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]{68}', authorized['key']), 'Refuse unexpected SSH key options')
        ch.fingerprint(authorized['key'])
    return authorized

def reserve_stage(state, s):
    import tempfile
    stage = stage_path(s)
    file = state / 'reservation.json'
    if not file.exists():
        demand(not os.path.lexists(stage), 'The independently granted initial stage must be new')
        temporary = P(tempfile.mkdtemp(dir=stage.parent,prefix='.service-data-'+s['id']+'-'))
        st = temporary.lstat()
        ch.write_record(file, {'name':temporary.name,'device':str(st.st_dev),'inode':str(st.st_ino)})
    saved = local_record(state, 'reservation.json')
    demand(re.fullmatch(r'\.service-data-'+s['id']+r'-[A-Za-z0-9_]+',saved['name']), 'Invalid reservation')
    if not os.path.lexists(stage):
        tmp = stage.parent/saved['name']
        info = tmp.lstat()
        demand(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
               [str(info.st_dev),str(info.st_ino)] == [saved['device'],saved['inode']], 'Reserved directory changed')
        os.rename(tmp,stage)
        ch.sync_directory(stage.parent)
    stage_identity(s,saved)
    return stage,saved

def bootstrap(s, side):
    consent = local_consent(s, side)
    ROOT.mkdir(mode=0o711,exist_ok=True)
    trusted_dir(ROOT)
    # Only named operation accounts need traversal. Each operation controls its own group.
    os.chmod(ROOT,0o711)
    state = ROOT / s['id']
    state.mkdir(mode=0o700,exist_ok=True)
    trusted_dir(state)
    with ch.lock(state/'admin.lock',True):
        specfile=state/'spec.json'
        if specfile.exists():
            demand(local_record(state,'spec.json') == s, 'Operation already bound to another specification')
        else:
            demand(set(os.listdir(state)) <= {'admin.lock'}, 'Refuse to adopt unrelated administrative state')
            ch.write_record(specfile,s)
        demand(not closed(state), 'This operation was already closed')
        ch.account_name = account_name
        if side == 'source':
            source_roots(s,state,not (state/'source-admission.json').exists(),prepare=True)
            offer=ch.issue_offer(s,state,{'manifest':sha(s)})
            grant={'schema':1,'spec':sha(s),'expires':consent['expires'],'key':offer['publicKey']}
            ch.write_record(state/'source.json',grant)
            (state/'session.lock').touch(mode=0o600,exist_ok=True)
            receipt=run_action('source-grant',s,state)
            return {**receipt,'publicKey':offer['publicKey']}
        stage,saved=reserve_stage(state,s)
        # Create an operation-owned account only after the independent receiver accepted the source's exact public key.
        user=ch.account(s,state,True)
        os.chown(state,0,user.pw_gid)
        os.chmod(state,0o750)
        ch.write_record(specfile,s,0o640,user.pw_gid)
        session=state/'session.lock'
        session.touch(mode=0o640,exist_ok=True)
        os.chown(session,0,user.pw_gid)
        os.chmod(session,0o640)
        with ch.lock(session):
            os.chown(stage,0,user.pw_gid)
            os.chmod(stage,0o750)
            for row in s['volumes']:
                directory=stage/row['tag']
                directory.mkdir(mode=0o700,exist_ok=True)
                st=directory.lstat()
                demand(stat.S_ISDIR(st.st_mode) and st.st_uid in (0,user.pw_uid) and st.st_dev == stage.stat().st_dev,
                       'Unrelated directory inside the operation stage')
                # Once admitted, native rsync owns all saved metadata underneath this root.
                if not (state/'receiver-admission.json').exists():
                    demand(not any(directory.iterdir()), 'Unexpected data in the initial stage')
                    os.chown(directory,user.pw_uid,user.pw_gid)
                    os.chmod(directory,0o700)
            grant={'schema':1,'spec':sha(s),'expires':consent['expires'],'key':consent['key'],
                   'device':saved['device'],'inode':saved['inode']}
            helper=state/'receiver.py'
            if helper.exists():
                demand(hashlib.sha256(helper.read_bytes()).digest()==hashlib.sha256(SELF.encode()).digest(),
                       'Existing receiver code differs from review')
            else:
                ch.write_file(helper,SELF.encode(),0o640,user.pw_gid)
            ch.write_record(state/'receiver.json',grant,0o640,user.pw_gid)
            expiry=datetime.datetime.fromtimestamp(grant['expires'],datetime.timezone.utc).strftime('%Y%m%d%H%M%SZ')
            line='restrict,from="{}",expiry-time="{}",command="{}" {}\n'.format(s['sourceIp'],expiry,restricted_command(s,state),grant['key'])
            ch.write_keys(state,line,user.pw_gid)
        return run_action('receiver-grant',s,state)


def main():
    os.umask(0o077)
    if sys.argv[1] == 'receive':
        op = sys.argv[2]
        demand(UUID.fullmatch(op), 'Invalid operation ID')
        state = ROOT / op
        s = local_record(state, 'spec.json')
        validate_scope(s)
        demand(s['id'] == op, 'Foreign receiver grant')
        receive(state,s)
        return
    demand(os.geteuid() == 0 and sys.platform == 'linux', 'Registered Linux administration endpoint required')
    action = sys.argv[1]
    s = json.loads(gzip.decompress(base64.b64decode(sys.argv[2], validate=True)))
    validate_scope(s)
    if action in ('bootstrap-source','bootstrap-receiver'):
        side = action.split('-')[1]
        demand(ch.fingerprint(ch.key_text(ch.HOST_KEY)) == s[side+'Fingerprint'], 'Bootstrap host identity differs')
        print(json.dumps(bootstrap(s,side),separators=(',',':')))
        return
    state = trusted_dir(ROOT / s['id'])
    demand(local_record(state, 'spec.json') == s, 'The endpoint has not independently granted this exact specification')
    side = 'source' if action in ('source-grant','seed','cold','source-check','revoke-source') else 'receiver'
    demand(ch.fingerprint(ch.key_text(ch.HOST_KEY)) == s[side+'Fingerprint'], 'Endpoint differs from its reviewed host identity')
    print(json.dumps(run_action(action, s, state), separators=(',',':')))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, ch.Refusal) as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit('Service data endpoint stopped (' + type(error).__name__ + ')')
