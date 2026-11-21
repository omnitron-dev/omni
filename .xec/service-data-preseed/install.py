"""Install only the content-addressed Python reviewed in the private-preseed Pipeline."""
import base64
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

ROOT = Path('/var/lib/omnitron-service-data-tools')
DIGEST = re.compile('[a-f0-9]{64}\\Z')


def demand(value):
    if not value:
        raise ValueError('Invalid local helper or reviewed host')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(path, mode, limit):
    with os.fdopen(os.open(path, os.O_NOFOLLOW | os.O_RDONLY | os.O_NONBLOCK), 'rb') as stream:
        st = os.fstat(stream.fileno())
        demand(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_uid == 0 and
               stat.S_IMODE(st.st_mode) == mode and 0 < st.st_size <= limit)
        data = stream.read(limit + 1)
        demand(len(data) == st.st_size)
        return data


def publish(path, data, mode):
    fd, name = tempfile.mkstemp(dir=ROOT)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), mode)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(ROOT, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(name).unlink(missing_ok=True)


def main(pin, digest, index, total, part_digest, payload):
    os.umask(0o077)
    demand(sys.platform == 'linux' and os.geteuid() == 0 and DIGEST.fullmatch(digest) and DIGEST.fullmatch(part_digest))
    alg, key = Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[:2]
    public = base64.b64decode(key, validate=True)
    demand(alg == 'ssh-ed25519' and public.startswith(b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20') and len(public) == 51 and
           'SHA256:'+base64.b64encode(hashlib.sha256(public).digest()).decode().rstrip('=') == pin)
    index, total = int(index), int(total)
    demand(0 <= index < total <= 24)
    part = base64.b64decode(payload, validate=True)
    demand(0 < len(part) <= 6144 and sha(part) == part_digest)
    ROOT.mkdir(mode=0o700,exist_ok=True)
    for directory in (ROOT,*ROOT.parents):
        st = directory.lstat()
        demand(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022)
    dest = ROOT / digest
    with os.fdopen(os.open(ROOT/'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),'r+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if os.path.lexists(dest):
            demand(sha(checked(dest,0o500,160*1024)) == digest)
        else:
            parts = [ROOT/(digest+'.part-'+str(n)) for n in range(total)]
            publish(parts[index],part,0o600)
            if index == total-1:
                packed = b''.join(checked(path,0o600,6144) for path in parts)
                import io
                with gzip.GzipFile(fileobj=io.BytesIO(packed)) as archived:
                    raw = archived.read(160*1024+1)
                demand(len(raw) <= 160*1024 and sha(raw) == digest)
                compile(raw,'service-data','exec')
                publish(dest,raw,0o500)
                for path in parts:
                    path.unlink(missing_ok=True)
        print(json.dumps({'helperSha256':digest,'part':index+1,'total':total}))

if __name__ == '__main__':
    main(*sys.argv[1:])
