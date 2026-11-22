"""Run in a fresh networkless Linux container. Arguments are the native CLI and infrastructure RPC JavaScript entries."""
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tempfile


PROFILES = {
    'bitcoin': ('bitcoin', 'bitcoind', '/etc/bitcoin/bitcoin.conf'),
    'monero-daemon': ('monero', 'monerod', '/etc/monero/monerod.conf'),
    'monero-wallet-rpc': ('monero-wallet', 'monero-wallet-rpc', '/etc/monero/monero-wallet-rpc.conf'),
}
PROOFS = Path('/var/lib/omnitron-host-config-proofs')
MARKER = '# managed-by: omnitron\n'
TEMPLATE = 'setting=synthetic-fixture\n'
probe = """
import {pathToFileURL} from 'node:url';
const {InfrastructureRpcService} = await import(pathToFileURL(process.argv[2]));
const {name, unit, user, path, expected} = JSON.parse(process.env.FIXTURE_SERVICE);
const containers = { resumeStack() {}, provision: async () => ({services: {}, ready:true}), getDesiredServices: () => [] };
const service = new InfrastructureRpcService(() => null, () => containers);
const services = { [name]: {ports:{}, env:{}, bareMetal:{user, systemdUnit:unit, configFile:path, configTemplate:expected}} };
const overrides = { [name]: {provisioning:'bareMetal'} };
const inspection = await service.inspectHostServices({services, overrides, configKeys:[{path, keys:['setting']}]});
const observed = inspection.services[0].onHost;
const result = await service.provisionStack({config:{}, services, overrides});
console.log(JSON.stringify({config:observed.config, actions:observed.actions.length, ready:result.ready,
  status:result.failed[0]?.status, settled:result.running.includes(name), privateKeyState:inspection.configKeys[0].exists}));
"""


def main(cli, rpc):
    if os.geteuid() != 0 or not Path('/.dockerenv').is_file() or os.getenv('OMNITRON_DISPOSABLE_HOST_CONFIG_TEST') != '1':
        raise SystemExit('requires a fresh explicitly selected Docker fixture')
    if any(p.exists() or p.is_symlink() for p in [Path('/etc/bitcoin'), Path('/etc/monero'), PROOFS]):
        raise SystemExit('private service paths already exist')
    mountpoints = {line.split()[4] for line in Path('/proc/self/mountinfo').read_text().splitlines()}
    if mountpoints.intersection({'/etc', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/var', '/var/lib'}):
        raise SystemExit('requires disposable account and evidence filesystems')
    if not all(Path(p).is_file() for p in [cli, rpc]) or list(Path('/sys/class/net').iterdir()) != [Path('/sys/class/net/lo')]:
        raise SystemExit('requires both entry points in a networkless container')

    checks = []
    def check(label, ok):
        if not ok:
            raise AssertionError(label)
        checks.append(label)

    node = shutil.which('node')
    ids = {}
    for index, user in enumerate(['omnitron', 'bitcoin', 'monero', 'monero-wallet']):
        uid, gid = 995 - index, 995 - index
        subprocess.run(['groupadd', '-g', str(gid), user], check=True)
        subprocess.run(['useradd', '-r', '-u', str(uid), '-g', str(gid), '-M', '-l', '-s', '/usr/sbin/nologin', user], check=True)
        ids[user] = uid, gid
    daemon = ids['omnitron']
    testroot = Path(tempfile.mkdtemp(prefix='private-config-test-'))
    testroot.chmod(0o755)
    systemctl = testroot / 'systemctl'
    calls = testroot / 'calls'
    calls.touch(0o600)
    os.chown(calls, *daemon)
    systemctl.write_text('#!/bin/sh\ncase "$1" in\nshow) echo LoadState=loaded; echo "ActiveState=$FIXTURE_ACTIVE"; '
                         'echo "UnitFileState=$FIXTURE_ENABLED";;\n*) echo "$1" >> "$FIXTURE_CALLS";;\nesac\n')
    systemctl.chmod(0o755)
    env = {**os.environ, 'PATH': f"{testroot}:{os.environ['PATH']}", 'FIXTURE_CALLS': str(calls)}

    def run(argv, user, data=None, extra=None):
        uid, gid = user
        return subprocess.run(argv, user=uid, group=gid, extra_groups=[], env={**env, **(extra or {})},
                              input=data, capture_output=True, text=True, timeout=25)

    def install(profile, args=None, user=(0, 0), success=True):
        result = run([node, cli, '--json', 'host-config', 'attest', profile, *(args or [])], user)
        if (result.returncode == 0) != success:
            raise AssertionError(f'installer expected success={success} exit={result.returncode}')
        if success:
            envelope = json.loads(result.stdout)
            assert envelope['ok'] is True
            output = envelope['data']
            assert set(output) == {'protocol', 'path', 'profile', 'receipt'} and len(output['receipt']) == 64
            return output['receipt']
        assert 'synthetic-fixture' not in result.stderr + result.stdout

    def observe(profile, expected='unreadable', content=TEMPLATE, active=False, spec_user=None, activating=False):
        user, unit, config = PROFILES[profile]
        calls.write_text('')
        result = run([node, '--input-type=module', '-', rpc], daemon, probe, {
            'FIXTURE_ACTIVE': 'activating' if activating else ('active' if active else 'inactive'),
            'FIXTURE_ENABLED': 'enabled' if active or activating else 'disabled',
            'FIXTURE_SERVICE': json.dumps({'name': profile, 'path': config, 'expected': content, 'unit': unit, 'user': spec_user or user}),
        })
        if result.returncode:
            raise AssertionError(f'ordinary native RPC exit {result.returncode}: {result.stderr[:1200]}')
        result = json.loads(result.stdout)
        assert result['config'] == expected, (profile, result)
        if expected == 'unreadable':
            assert result['actions'] == 0 and not result['ready'] and result['status'] == 'refused' and not calls.read_text(), result
        else:
            assert result['ready'] == active and result['settled'] and result['actions'] == (0 if active or activating else 2), result
            assert calls.read_text().splitlines() == ([] if active or activating else ['enable', 'start'])
        return result

    def place(path, user, content=MARKER + TEMPLATE):
        path.write_text(content)
        os.chown(path, 0, ids[user][1])
        path.chmod(0o640)

    for profile, (user, unit, config) in PROFILES.items():
        path = Path(config)
        path.parent.mkdir(mode=0o711, exist_ok=True)
        place(path, user)
        check(f'{profile}: daemon cannot open config', run(['test', '-r', config], daemon).returncode == 1)
        check(f'{profile}: service can open config', run(['test', '-r', config], ids[user]).returncode == 0)
        check(f'{profile}: no evidence refuses inactive lifecycle', observe(profile)['privateKeyState'] is None)
        receipt = install(profile)
        proof = PROOFS / f'{profile}.json'
        original = proof.stat()
        check(f'{profile}: retry preserves exact evidence file', receipt == install(profile) and
              (proof.stat().st_ino, proof.stat().st_ctime_ns) == (original.st_ino, original.st_ctime_ns))
        s = proof.stat()
        check(f'{profile}: protected evidence', (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode), s.st_nlink) == (0, daemon[1], 0o440, 1)
              and run(['test', '-r', str(proof)], ids[user]).returncode == 1 and stat.S_IMODE(PROOFS.stat().st_mode) == 0o711)
        check(f'{profile}: fresh daemon accepts exact installed bytes', observe(profile, 'verified-private', active=True)['privateKeyState'] is None)
        observe(profile, 'verified-private')
        observe(profile, 'verified-private', activating=True)
        check(f'{profile}: exact config permits one ordinary start; activating remains unready', True)
        observe(profile, content=TEMPLATE + ' ')
        check(f'{profile}: byte mismatch refuses lifecycle', True)

    profile = 'bitcoin'
    user, unit, config = PROFILES[profile]
    path = Path(config)
    receipt = install(profile)
    install('../../other', success=False)
    install(profile, args=['/etc/other'], success=False)
    install(profile, user=daemon, success=False)
    observe(profile, spec_user='monero')
    check('fixed installer subject, privileged issuer and declared service identity', True)
    replacement = path.with_suffix('.replacement')
    place(replacement, user)
    replacement.replace(path)
    observe(profile)
    check('identical replacement inode needs its own receipt', install(profile) != receipt)
    observe(profile, 'verified-private', active=True)
    before = path.stat()
    path.write_text((MARKER + TEMPLATE).replace('fixture', 'changed'))
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    observe(profile)
    check('same length and restored mtime cannot preserve previous evidence', path.stat().st_size == before.st_size)
    install(profile)
    observe(profile)
    check('fresh receipt covers actual changed bytes independently', True)
    proof = PROOFS / f'{profile}.json'
    proof.chmod(0o644)
    observe(profile)
    install(profile, success=False)
    proof.chmod(0o440)
    saved_proof = proof.with_suffix('.saved')
    proof.rename(saved_proof)
    proof.symlink_to(saved_proof)
    observe(profile)
    install(profile, success=False)
    proof.unlink()
    saved_proof.rename(proof)
    check('public or linked evidence cannot authorize the plan or be followed by root', True)
    path.chmod(0o644)
    observe(profile)
    install(profile, success=False)
    place(path, user)
    os.chown(path, ids[user][0], ids[user][1])
    install(profile, success=False)
    os.chown(path, 0, ids['monero'][1])
    install(profile, success=False)
    place(path, user)
    hardlink = path.with_suffix('.copy')
    os.link(path, hardlink)
    install(profile, success=False)
    hardlink.unlink()
    os.rename(path, hardlink)
    path.symlink_to(hardlink)
    install(profile, success=False)
    observe(profile)
    path.unlink()
    hardlink.rename(path)
    acl = b''.join(struct.pack('<HHI', tag, perms, ident) for tag, perms, ident in
                   [(1, 6, 0xffffffff), (2, 4, ids['monero'][0]), (4, 4, 0xffffffff), (16, 4, 0xffffffff), (32, 0, 0xffffffff)])
    os.setxattr(path, 'system.posix_acl_access', struct.pack('<I', 2) + acl)
    install(profile, success=False)
    os.removexattr(path, 'system.posix_acl_access')
    install(profile)
    subprocess.run(['usermod', '-aG', 'bitcoin', 'omnitron'], check=True)
    install(profile, success=False)
    observe(profile)
    check('mode, owner, group, symlinks, hard links, ACL, overlapping groups are refused', True)
    subprocess.run(['gpasswd', '-d', 'omnitron', 'bitcoin'], check=True, capture_output=True)
    path.unlink()
    observe(profile)
    check('previously attested file disappearing refuses creation and start', True)
    print(json.dumps({'profiles': list(PROFILES), 'uid': daemon[0], 'cli': 'host-config attest',
                      'rpc': ['inspectHostServices', 'provisionStack'], 'systemd': 'synthetic', 'checks': checks}, indent=2))


if __name__ == '__main__':
    main(*sys.argv[1:])
