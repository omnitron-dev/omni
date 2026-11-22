"""Run as root only inside a disposable container with a new tmpfs at /opt/omnitron."""
import base64
import fcntl
import gzip
import json
import os
import pathlib
import pwd
import shutil
import stat
import subprocess
import sys
import time

from entry import inspect_locks, prepare_parents, prepare_prefix

prefix = pathlib.Path('/opt/omnitron')
assert sys.platform == 'linux' and os.getuid() == 0 and (pathlib.Path('/') / '.dockerenv').exists()
assert subprocess.check_output(['stat', '-f', '-c', '%T', prefix], text=True).strip() == 'tmpfs'
assert list(prefix.iterdir()) == []
os.chmod(prefix, 0o755)
uid = 19951
subprocess.run(['useradd', '--uid', str(uid), '--create-home', '--home-dir', '/tmp/fixture-account', 'passive-fixture'], check=True)
user = pwd.getpwuid(uid)
home = pathlib.Path(user.pw_dir)
node = shutil.which('node')
assert node
spec = {'uid': uid, 'user': user.pw_name, 'backend': 'b' * 64}
runtime = home / '.omnitron' / 'runtime' / 'releases' / spec['backend']
subprocess.run(['mkdir', '-p', runtime], user=uid, group=user.pw_gid, check=True)
subprocess.run(['ln', '-s', node, runtime / 'node'], user=uid, group=user.pw_gid, check=True)
worker = """
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
assert.equal(process.getuid(),19951);
if(process.argv[2]==='stage'){
  for(const name of ['artifacts','projects'])assert.equal(fs.statSync('/opt/omnitron/'+name).uid,process.getuid());
  assert.throws(()=>fs.openSync('/opt/omnitron/locks/deploy.guard','w'),{code:'EACCES'});
  fs.writeFileSync(path.join(os.homedir(),'entered'),String(process.getuid()));
  const end=Date.now()+25000;
  while(!fs.existsSync(path.join(os.homedir(),'complete'))){if(Date.now()>end)throw Error('Fixture timed out');await new Promise(r=>setTimeout(r,80));}
}"""
here = pathlib.Path(__file__).parent
bundle = {'entry': (here / 'entry.py').read_text(), 'worker': worker, 'lease': json.loads(pathlib.Path(sys.argv[1]).read_text())}
wire = base64.urlsafe_b64encode(json.dumps(spec).encode()).decode().rstrip('=')
args = ['/usr/bin/python3', '-I', str(here / 'entry.py'), wire, base64.b64encode(gzip.compress(json.dumps(bundle).encode())).decode()]
first = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    until = time.monotonic() + 20
    while not (home / 'entered').is_file():
        assert first.poll() is None, first.communicate()
        assert time.monotonic() < until
        time.sleep(.05)
    locks = prefix / 'locks'
    guard = locks / 'deploy.execution.guard'
    identity = guard.stat().st_dev, guard.stat().st_ino
    with guard.open('rb') as held:
        try:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            raise AssertionError('Native guard was released before the child returned')
        except BlockingIOError:
            pass
    second = subprocess.run(args, capture_output=True, timeout=15)
    assert second.returncode and b'lease is held' in second.stderr, second.stderr
    subprocess.run(['touch', home / 'complete'], user=uid, group=user.pw_gid, check=True)
    _, err = first.communicate(timeout=20)
    assert first.returncode == 0, err
    assert (guard.stat().st_dev, guard.stat().st_ino) == identity
    assert not (locks / 'deploy.lease').exists() and not (locks / 'deploy.execution.json').exists()
    assert stat.S_IMODE(locks.stat().st_mode) == 0o700 and locks.stat().st_uid == 0
    for name in ['artifacts', 'projects']:
        s = (prefix / name).stat()
        assert (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) == (uid, user.pw_gid, 0o700)
    def refused(call):
        try:
            call()
            raise AssertionError('Foreign state was accepted')
        except SystemExit:
            pass
    os.chown(prefix / 'projects', uid, 0)
    refused(lambda: prepare_parents(prefix, user)); assert (prefix / 'projects').stat().st_gid == 0
    os.chown(prefix / 'projects', 0, 0)
    refused(lambda: prepare_parents(prefix, user)); assert (prefix / 'projects').stat().st_uid == 0
    (locks / 'unsafe').symlink_to(home / 'entered')
    refused(lambda: inspect_locks(locks)); assert (locks / 'unsafe').is_symlink()
    (locks / 'unsafe').unlink()
    os.chmod(locks, 0o500)
    refused(lambda: inspect_locks(locks)); assert stat.S_IMODE(locks.stat().st_mode) == 0o500
    os.chmod(locks, 0o700)
    os.chown(locks, uid, user.pw_gid)
    refused(lambda: prepare_prefix(prefix)); assert locks.stat().st_uid == uid
    print(json.dumps({'guardDeviceAndInode': identity, 'leaseUid': 0, 'payloadUid': uid,
                      'secondAdministrativeWriterRefused': True, 'directServiceLeaseRefused': True,
                      'foreignParentsAndLinksPreserved': True}))
finally:
    if first.poll() is None:
        first.terminate()
