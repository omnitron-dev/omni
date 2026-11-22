"""Disposable Linux-only acceptance of the local installer through a real private SSH streamlocal forward."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time
from uuid import uuid4


def main(dist, client):
    if os.geteuid() != 0 or os.getenv('OMNITRON_DISPOSABLE_HOST_CONFIG_TEST') != '1':
        raise SystemExit('requires the dedicated disposable Linux fixture')
    mount_types = {line.split()[4]: line.split(' - ', 1)[1].split()[0]
                   for line in Path('/proc/self/mountinfo').read_text().splitlines()}
    namespace = (mount_types.get('/') == 'tmpfs' and mount_types.get('/usr') == 'overlay' and
                 Path('/run/omnitron-disposable-host-config-namespace').is_file())
    if not (namespace or Path('/.dockerenv').exists()):
        raise SystemExit('requires a disposable container or an isolated RAM-backed namespace')
    scratch = ['/etc/bitcoin', '/etc/monero', '/var/lib/omnitron-host-config-install', '/var/lib/omnitron-host-config-proofs']
    if list(Path('/sys/class/net').iterdir()) != [Path('/sys/class/net/lo')] or any(
            Path(p).exists() and (mount_types.get(p) != 'tmpfs' or any(Path(p).iterdir())) for p in scratch):
        raise SystemExit('requires untouched destinations and the isolated loopback namespace')
    unsafe = {'/etc', '/etc/passwd', '/etc/group', '/usr/bin', '/var/lib'}
    if not namespace: unsafe.add('/usr')
    if set(mount_types).intersection(unsafe) or Path('/proc/1/comm').read_text().strip() == 'systemd':
        raise SystemExit('requires disposable system files and a synthetic service manager')
    cli = str(Path(dist) / 'cli/omnitron.js')
    for i, user in enumerate(['omnitron', 'bitcoin', 'monero', 'monero-wallet']):
        gid = str(995-i)
        subprocess.run(['groupadd', '-g', gid, user], check=True)
        subprocess.run(['useradd', '-r', '-l', '-M', '-u', gid, '-g', gid, '-s', '/usr/sbin/nologin', user], check=True)
    Path('/etc/ssh').mkdir(mode=0o755, exist_ok=True)
    Path('/etc/ssh').chmod(0o755)
    shutil.copy('/fixture-public/host.pub', '/etc/ssh/ssh_host_ed25519_key.pub')
    keys = Path('/tmp/host-config-qa-ssh')
    keys.mkdir(mode=0o700)
    subprocess.run(['node', client, dist, 'fixture-ssh-keys'], check=True)
    authorized = []
    for name, options in [('allowed', 'restrict,port-forwarding'), ('restricted', 'restrict'),
                          ('tcp-only', 'restrict,port-forwarding,permitopen="127.0.0.1:27433"')]:
        key = keys / name
        authorized.append('from="127.0.0.1",' + options + ' ' + Path(str(key) + '.pub').read_text().strip())
    Path('/fixture-public/authorized_keys').write_text('\n'.join(authorized) + '\n')
    Path('/fixture-public/authorized_keys').chmod(0o600)
    Path('/run/omnitron-host-config').chmod(0o700)
    control = Path('/usr/bin/systemctl')
    if control.exists() or control.is_symlink():
        control.unlink()
    control.write_text('#!/bin/sh\n[ "$1" = show ] || { touch /tmp/unexpected-systemd-action; exit 1; }\n'
        'if [ "$2" = monerod.service ] && [ -f /tmp/pause-after-first ] && [ -f /var/lib/omnitron-host-config-proofs/bitcoin.json ] && [ ! -e /etc/monero/monerod.conf ]; then touch /tmp/paused; sleep 4; fi\n'
        'echo LoadState=not-found; echo ActiveState=inactive; echo MainPID=0; echo Job=\n')
    control.chmod(0o755)
    checks = []
    def check(label, ok):
        if not ok: raise AssertionError(label)
        checks.append(label)
    def result(p, seconds=90):
        out, err = p.communicate(timeout=seconds)
        assert 'fixture-only-value' not in out + err and 'PRIVATE KEY' not in out + err
        return json.loads(out)
    def start(args):
        return subprocess.Popen(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def send(action, ticket):
        return start(['node', client, dist, action, ticket])
    ticket = str(uuid4())
    reviewed = result(send('review', ticket))
    def receive(ticket):
        deadline = (datetime.now(timezone.utc) + timedelta(minutes=8)).isoformat()
        path = Path('/run/omnitron-host-config') / (ticket + '.sock')
        previous = path.stat().st_ctime_ns if path.is_socket() else None
        proc = start(['node', cli, '--json', 'host-config', 'receive', ticket, '--node-id', reviewed['nodeId'],
                      '--review', reviewed['review'], '--expires', deadline])
        for _ in range(200):
            if path.is_socket() and path.stat().st_ctime_ns != previous: return proc
            if proc.poll() is not None: break
            time.sleep(.05)
        raise AssertionError('the public CLI did not open its scoped listener')
    path = Path('/etc/bitcoin/bitcoin.conf')
    monero = Path('/etc/monero/monerod.conf')
    Path('/etc/ssh').chmod(0o777)
    receiver = receive(ticket)
    untrusted = result(send('send', ticket)); receiver.communicate(timeout=25)
    check('writable SSH host key directory prevents service vault access',
          not untrusted['ok'] and untrusted['vaultReads'] == 0 and untrusted['checks'] > 0)
    Path('/etc/ssh').chmod(0o755)
    # Unrelated occupant with the target pathname must prevent every vault read.
    path.parent.mkdir(mode=0o711, exist_ok=True); path.write_text('independent synthetic owner')
    receiver = receive(ticket)
    foreign = result(send('send', ticket))
    if foreign['checks'] == 0:
        receiver.kill(); receiver.communicate(timeout=10)
        raise AssertionError('production Xec SSH did not establish its scoped Unix forward: ' + foreign['reason'])
    receiver.communicate(timeout=25)
    check('occupied target refused before resolving any vault entry', not foreign['ok'] and foreign['vaultReads'] == 0 and path.read_text() == 'independent synthetic owner')
    path.unlink()
    path.parent.chmod(0o700)
    receiver = receive(ticket); blocked = result(send('send', ticket)); receiver.communicate(timeout=25)
    check('inaccessible config parent refuses before service vault access', not blocked['ok'] and blocked['vaultReads'] == 0)
    path.parent.chmod(0o711)
    subprocess.run(['gpasswd', '-a', 'nobody', 'bitcoin'], check=True, stdout=subprocess.DEVNULL)
    receiver = receive(ticket)
    shared = result(send('send', ticket)); receiver.communicate(timeout=25)
    check('a second service group reader prevents vault resolution', not shared['ok'] and shared['vaultReads'] == 0 and not path.exists())
    subprocess.run(['gpasswd', '-d', 'nobody', 'bitcoin'], check=True, stdout=subprocess.DEVNULL)
    receiver = receive(ticket)
    pin = result(send('wrong-pin', ticket))
    check('wrong SSH host key refuses before vault access', not pin['ok'] and pin['vaultReads'] == 0)
    for name in ['restricted', 'tcp-only', 'tcp-disabled']:
        denied = result(send(name, ticket))
        check(name + ' SSH policy refuses the Unix forward before service vault access',
              not denied['ok'] and denied['reason'] == 'Unix forwarding' and denied['vaultReads'] == 0)
    Path('/tmp/pause-after-first').touch()
    sender = send('send', ticket)
    for _ in range(2600):
        if Path('/tmp/paused').exists(): break
        if sender.poll() is not None: break
        time.sleep(.05)
    if not Path('/tmp/paused').exists():
        observation = result(sender) if sender.poll() is not None else {'pending': True}
        if receiver.poll() is None: receiver.terminate()
        receiver.communicate(timeout=15)
        raise AssertionError('initial publication missing checkpoint ' + json.dumps({
            'source': {k: observation.get(k) for k in ('ok', 'reason', 'checks', 'vaultReads', 'pending')},
            'destination': [path.is_file(), monero.is_file()]}))
    check('first file installed and independently attested before interruption', Path('/tmp/paused').exists() and path.is_file() and not monero.exists())
    receiver.kill(); receiver.communicate(timeout=12)
    interrupted = result(sender)
    check('dropped installation acknowledgement remains unknown', not interrupted['ok'] and interrupted['vaultReads'] == 7)
    first = path.stat(); Path('/tmp/pause-after-first').unlink()
    # A different inode at a partially completed destination can never be adopted on retry.
    monero.write_text('foreign during retry'); receiver = receive(ticket)
    blocked = result(send('send', ticket)); receiver.communicate(timeout=25)
    check('partial retry preserves alien successor', not blocked['ok'] and blocked['vaultReads'] == 0 and monero.read_text() == 'foreign during retry')
    monero.unlink()
    proof = Path('/var/lib/omnitron-host-config-proofs/monero-daemon.json')
    proof.write_text('unrelated synthetic evidence')
    receiver = receive(ticket); blocked = result(send('send', ticket)); receiver.communicate(timeout=25)
    check('partial retry preserves foreign evidence before resolving any vault entry',
          not blocked['ok'] and blocked['vaultReads'] == 0 and proof.read_text() == 'unrelated synthetic evidence')
    proof.unlink()
    receiver = receive(ticket); finished = result(send('send', ticket)); local = result(receiver)
    check('same reviewed ticket resumes all three native publications', finished['ok'] and finished['vaultReads'] == 7 and
        local['ok'] and local['data'] == finished['receipt'] and path.stat().st_ino == first.st_ino and len(local['data']['files']) == 3)
    for config, gid in [(path, 994), (monero, 993), (Path('/etc/monero/monero-wallet-rpc.conf'), 992)]:
        s = config.stat()
        check(config.name + ' sealed under the service group', (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode), s.st_nlink) == (0, gid, 0o640, 1))
        assert subprocess.run(['test', '-r', str(config)], user=995, group=995, extra_groups=[]).returncode == 1
        assert subprocess.run(['test', '-r', str(config)], user=gid, group=gid, extra_groups=[]).returncode == 0
    receiver = receive(ticket); done = result(send('send', ticket)); result(receiver)
    check('completed receipt retry uses no vault and no file replacement', done['vaultReads'] == 0 and done['receipt'] == finished['receipt'] and
          path.stat().st_ctime_ns == first.st_ctime_ns)
    path.chmod(0o600)
    receiver = receive(ticket); drift = result(send('send', ticket)); receiver.communicate(timeout=25)
    check('changed private installation is preserved and refused before vault access', not drift['ok'] and drift['vaultReads'] == 0 and stat.S_IMODE(path.stat().st_mode) == 0o600)
    check('service manager received no mutation', not Path('/tmp/unexpected-systemd-action').exists())
    effective = {name: dict(line.split(' ', 1) for line in Path('/fixture-public/effective-' + name).read_text().splitlines())
                 for name in ['config', 'blocked']}
    check('effective OpenSSH policy recorded for both listeners', effective['config']['maxsessions'] == '0' and
        effective['config']['allowstreamlocalforwarding'] == 'local' and effective['config']['allowtcpforwarding'] == 'local' and
        effective['config']['authenticationmethods'] == 'publickey' and effective['blocked']['allowtcpforwarding'] == 'no')
    print(json.dumps({'transport': 'pinned Xec SSH direct-streamlocal through loopback OpenSSH', 'systemd': 'synthetic',
        'destinationFilesystems': {p: mount_types.get(p, mount_types.get('/', 'root filesystem')) for p in scratch},
        'sshd': effective, 'authorizedKeys': [line.split(' ', 1)[0] for line in authorized],
        'controllerAuth': 'public dispatch and authenticated mesh policy covered by unit fixtures', 'checks': checks}, indent=2))


if __name__ == '__main__':
    main(*sys.argv[1:])
