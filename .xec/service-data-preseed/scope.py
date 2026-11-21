"""The only source trees eligible for a service-data grant."""
import hashlib
import errno
import ipaddress
import json
import os
import pathlib
import re
import stat

P = pathlib.Path
FIXED = {
    'postgres-data': ('postgres', '/var/lib/postgresql/data'),
    'nominatim-data': ('nominatim', '/var/lib/postgresql/14/main'),
    'nominatim-flatnode': ('nominatim', '/nominatim/flatnode'),
    'nominatim-merged': ('nominatim', '/merged'),
    'redis-data': ('redis', '/data'),
    'minio-data': ('minio', '/data'),
}
EXTRA = re.compile(r'(postgres|nominatim)-(wal|tblspc-([1-9][0-9]{0,9}))\Z')
HEX = re.compile(r'[0-9a-f]{64}\Z')
UUID = re.compile(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z')
LABEL = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\Z')
RESERVED = {b'registry.credentials', b'wallet.dat', b'wallets', b'.omnitron-files', b'hs_ed25519_secret_key', b'hs_ed25519_public_key'}
def demand(condition, message):
    if not condition:
        raise ValueError(message)

def identity(row):
    tag, target = row['tag'], row['target']
    if tag in FIXED:
        service, wanted = FIXED[tag]
        demand(target == wanted, 'Service mount target differs from its role')
        return service
    extra = EXTRA.fullmatch(tag)
    demand(extra and re.fullmatch(r'/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+', target)
           and not {'.', '..'}.intersection(P(target).parts)
           and P(target).parts[1] in ('srv', 'mnt', 'data', 'var')
           and not target.startswith(('/var/lib/docker', '/var/run', '/var/lib/omnitron')), 'Unknown data role or tablespace/WAL target')
    return extra[1]

def validate_scope(s):
    demand(set(s) == set('id sourceNode receiverNode sourceFingerprint receiverFingerprint sourceIp receiverIp receiverPort stageParent rateKiB ttlMinutes project stack volumes clusters'.split())
           and all(LABEL.fullmatch(s[k]) for k in ('project', 'stack'))
           and type(s['rateKiB']) is int and 1 <= s['rateKiB'] <= 1048576, 'Invalid service data specification')
    demand(re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',s['id'])
           and s['sourceNode'] != s['receiverNode'] and s['sourceFingerprint'] != s['receiverFingerprint']
           and all(re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}',s[side+'Fingerprint']) for side in ('source','receiver'))
           and type(s['receiverPort']) is int and 1 <= s['receiverPort'] <= 65535 and type(s['ttlMinutes']) is int
           and 1 <= s['ttlMinutes'] <= 1440 and s['sourceIp'] != s['receiverIp'], 'Invalid private endpoint identities')
    for side in ('source','receiver'):
        ip = ipaddress.IPv4Address(s[side+'Ip'])
        demand(not (ip.is_loopback or ip.is_unspecified or ip.is_multicast) and str(ip) != '255.255.255.255', 'Invalid peer IP')
    stage = P(s['stageParent'])
    demand(stage.is_absolute() and len(stage.parts)>1 and str(stage)==s['stageParent'] and '..' not in stage.parts and
           stage.parts[1] not in ('root','etc','proc','sys','dev'), 'Unsafe stage parent')
    demand(set(s['clusters']) == {'postgres','nominatim'} and len(set(s['clusters'].values())) == 2 and all(re.fullmatch(r'[1-9][0-9]{0,19}', n) for n in s['clusters'].values()), 'Invalid PostgreSQL system IDs')
    rows = s['volumes']
    demand(isinstance(rows, list) and 6 <= len(rows) <= 72, 'Expected all service volumes')
    tags, names, native, services = set(), set(), set(), {}
    for row in rows:
        demand(set(row) == set('tag container image volume target device inode'.split())
               and LABEL.fullmatch(row['volume']) and HEX.fullmatch(row['container'])
               and re.fullmatch(r'sha256:[0-9a-f]{64}', row['image'])
               and all(re.fullmatch(r'[1-9][0-9]{0,24}', row[k]) for k in ('device', 'inode')), 'Invalid source volume identity')
        kind = identity(row)
        binding = row['container'], row['image']
        demand(services.setdefault(kind, binding) == binding, 'A service has multiple container identities')
        ino = row['device'], row['inode']
        demand(row['tag'] not in tags and row['volume'] not in names and ino not in native, 'Duplicate service volume')
        tags.add(row['tag']); names.add(row['volume']); native.add(ino)
    demand(set(FIXED) <= tags and len({v[0] for v in services.values()}) == len(services), 'Incomplete service volume set')
    for kind in services:
        targets = [row['target'] for row in rows if identity(row) == kind]
        demand(len(set(targets)) == len(targets), 'A mount target is ambiguous')

def sha(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':'), sort_keys=True).encode('ascii')).hexdigest()

def inventory(root, row, rows, receiver=False, writers=frozenset(), metadata_only=False):
    """Hash names, content and link topology in byte order, anchored to open directories."""
    result = hashlib.sha256()
    files = size = 0
    hardlinks, links = {}, set()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    sig = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    wanted_links = {}
    if row['tag'] in ('postgres-data', 'nominatim-data'):
        for child in rows:
            match = EXTRA.fullmatch(child['tag'])
            if match and match[1] == identity(row):
                name = 'pg_wal' if match[2] == 'wal' else 'pg_tblspc/' + match[3]
                wanted_links[name] = child['target']

    def stored_link(parent, leaf, relative, st):
        # Linux fake-super may store a symlink as an inert regular file carrying an rsync stat xattr.
        if stat.S_ISLNK(st.st_mode):
            target = os.readlink(leaf, dir_fd=parent)
            if receiver:
                demand(target.startswith('/rsyncd-munged/'), 'The restricted receiver did not munge this link')
                target = target[len('/rsyncd-munged/'):]
            return target
        if not stat.S_ISREG(st.st_mode) or not hasattr(os, 'getxattr'):
            return None
        fd = os.open(leaf, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=parent)
        try:
            demand(os.path.samestat(st, os.fstat(fd)), 'Entry was replaced before checking saved attributes')
            try:
                raw = os.getxattr(fd, 'user.rsync.%stat')
            except OSError as e:
                if e.errno in (errno.ENODATA, errno.ENOTSUP, getattr(errno, 'ENOATTR', errno.ENODATA)):
                    return None
                raise
            demand(receiver, 'Source contains reserved rsync fake-super metadata')
            mode = re.fullmatch(rb'([0-7]+) [0-9]+,[0-9]+ [0-9]+:[0-9]+', raw)
            demand(mode is not None, 'Invalid saved POSIX metadata')
            mode = int(mode[1],8)
            if stat.S_ISREG(mode):
                return None
            demand(stat.S_ISLNK(mode) and relative in wanted_links and st.st_nlink == 1 and st.st_size <= 4096,
                   'Unsupported or unreviewed fake-super entry')
            value = os.fsdecode(os.read(fd,4097))
            if value.startswith('/rsyncd-munged/'):
                value = value[len('/rsyncd-munged/'):]
            return value
        finally:
            os.close(fd)

    def inspect(parent, leaf, relative, device):
        nonlocal files, size
        path = os.fsencode(relative)
        demand(os.fsencode(leaf) not in RESERVED and leaf != '.rsync-partial',
               'An excluded private/control or unfinished transfer entry exists')
        st = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
        demand(st.st_dev == device, 'Nested filesystems require their own reviewed mount')
        demand((st.st_dev,st.st_ino) not in writers, 'Cold data has a native writer')
        target = stored_link(parent, leaf, relative, st)
        if stat.S_ISDIR(st.st_mode):
            result.update(b'D\0' + path + b'\0')
            child = os.open(leaf, flags, dir_fd=parent)
            try:
                demand(os.path.samestat(st, os.fstat(child)), 'Directory was replaced')
                visit(child, relative + '/', device)
            finally:
                os.close(child)
        elif target is not None:
            demand(wanted_links.get(relative) == target, 'Every link must map its PostgreSQL tablespace/WAL to a reviewed volume')
            links.add(relative)
            result.update(b'L\0' + path + b'\0' + os.fsencode(target) + b'\0')
        else:
            demand(stat.S_ISREG(st.st_mode), 'Unsupported special file in service volume')
            alias = hardlinks.setdefault((st.st_dev,st.st_ino), [relative,st.st_nlink,0]) if st.st_nlink > 1 else None
            if alias:
                alias[2] += 1
            if metadata_only:
                return
            content = hashlib.sha256()
            with os.fdopen(os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent), 'rb') as source:
                demand(sig(os.fstat(source.fileno())) == sig(st), 'Data file changed before verification')
                for chunk in iter(lambda: source.read(1024 ** 2), b''):
                    content.update(chunk)
                demand(sig(os.fstat(source.fileno())) == sig(st), 'Data file changed while hashing')
            result.update(b'F\0' + path + b'\0' + str(st.st_size).encode() + b'\0' +
                          (os.fsencode(alias[0]) if alias else b'') + b'\0' + content.digest())
            files += 1
            size += st.st_size
        current = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
        demand(os.path.samestat(current, st) and (metadata_only or sig(current) == sig(st)), 'Volume entry was changed')

    def visit(directory, prefix, device):
        initial = os.fstat(directory)
        for leaf in sorted(os.listdir(directory), key=os.fsencode):
            try:
                inspect(directory, leaf, prefix + leaf, device)
            except FileNotFoundError:
                if not metadata_only:
                    raise
        demand(metadata_only or sig(os.fstat(directory)) == sig(initial), 'Directory inventory changed')

    root_fd = os.open(root, flags)
    try:
        root_stat = os.fstat(root_fd)
        visit(root_fd, '', root_stat.st_dev)
        demand(os.path.samestat(root_stat, root.lstat()), 'Volume root was replaced')
    finally:
        os.close(root_fd)
    demand(all(n == expected for _,expected,n in hardlinks.values()), 'A hard link crosses a reviewed volume')
    demand(links == set(wanted_links), 'Unmatched tablespace or external WAL volume')
    return {'sha256':result.hexdigest(), 'files':files, 'bytes':size}

if __name__ == '__main__':
    import sys
    validate_scope(json.load(sys.stdin))
