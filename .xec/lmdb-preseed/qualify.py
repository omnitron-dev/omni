"""Qualify one prepared public chain with a pinned monerod and a private systemd network."""
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import tempfile

import omnitron_preseed_channel as ch


def checked_binary(release):
    path = Path(release['binary'])
    ch.require(re.fullmatch(r'/opt/omnitron/binaries/monero/[0-9]+(?:\.[0-9]+){2,3}/monerod', str(path)) and
               re.fullmatch('[a-f0-9]{64}', release['sha256']), 'Use the pinned, installed monerod release.')
    ch.physical(path.parent, True)
    st = path.lstat()
    ch.require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022 and
               0 < st.st_size < 256 * 1024 ** 2, 'Unsafe daemon executable.')
    digest = hashlib.sha256()
    with path.open('rb') as binary:
        for chunk in iter(lambda: binary.read(1024 ** 2), b''):
            digest.update(chunk)
    ch.require(digest.hexdigest() == release['sha256'], 'The official executable digest differs.')


def unit_state(unit):
    result = subprocess.run(['systemctl', 'show', unit, '-p', 'ActiveState', '--value'],
                            text=True, capture_output=True, timeout=10)
    ch.require(result.returncode == 0 and result.stdout.strip() in ('inactive', 'failed'),
               'The previous isolated unit might still own the candidate.')


def isolated(op, release, data, database):
    unit = 'omnitron-monero-check-' + op + '.service'
    with tempfile.TemporaryDirectory(dir='/run', prefix='omnitron-monero-check-') as tmp:
        parent = Path(tmp)
        work = parent / 'data'
        lmdb = work / 'lmdb'
        mounted = lmdb / 'data.mdb'
        work.mkdir(mode=0o700)
        lmdb.mkdir(mode=0o700)
        mounted.touch(mode=0o600)
        os.chown(work, release['uid'], release['gid'])
        os.chown(lmdb, release['uid'], release['gid'])
        os.chmod(parent, 0o711)
        properties = ['PrivateNetwork=yes', 'PrivateTmp=yes', 'PrivateDevices=yes', 'ProtectSystem=strict',
                      'ProtectHome=yes', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'ProtectKernelTunables=yes',
                      'ProtectControlGroups=yes', 'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX', 'UMask=0077',
                      'LimitCORE=0', 'RuntimeMaxSec=350', 'TimeoutStopSec=90', 'ReadWritePaths=' + str(work),
                      'BindPaths=' + str(data) + ':' + str(mounted)]
        command = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--unit=' + unit,
                   '--uid=' + str(release['uid']), '--gid=' + str(release['gid']), '--setenv=HOME=' + str(work)]
        command += ['--property=' + p for p in properties]
        command += ['/usr/bin/python3', '-I', '-c', OFFLINE_PROBE, release['binary'], str(work),
                    json.dumps(database, separators=(',', ':')), str(release['uid']), str(release['gid'])]
        result = subprocess.run(command, capture_output=True, text=True, stdin=subprocess.DEVNULL)
        if result.returncode:
            # Preserve the useful controlled diagnostic without printing raw daemon logs.
            detail = next((line[12:] for line in reversed(result.stderr.splitlines())
                           if line.startswith('ValueError: ') and len(line) < 145), '')
            raise ch.Refusal('Isolated monerod qualification failed.' + (' ' + detail if detail else ''))
        observed = json.loads(result.stdout)
        ch.require(observed.get('cleanShutdown') is True and observed.get('tip') == database['tip'] and
                   observed.get('height') == database['height'] and observed.get('offline') is True,
                   'The isolated service did not attest its native startup and shutdown.')
        return observed


def verify(spec, release):
    os.umask(0o077)
    ch.require(sys.platform == 'linux' and os.geteuid() == 0 and ch.ID.fullmatch(spec['id']) and
               spec['receiverFingerprint'] == ch.fingerprint(ch.key_text(ch.HOST_KEY)) and
               spec['payload'] == 'monero-lmdb-compact-v1' and spec['nettype'] == 'mainnet',
               'Unexpected receiver or chain.')
    checked_binary(release)
    user = pwd.getpwnam(release['user'])
    ch.require((user.pw_uid, user.pw_gid) == (release['uid'], release['gid']) and min(user.pw_uid, user.pw_gid) > 0 and
               Path(user.pw_shell).name in ('false', 'nologin'), 'Use the declared non-login service account.')
    state = ch.physical(ch.ROOT / spec['id'], True)
    with ch.lock(state / 'admin.lock', True):
        seal = ch.record(state / 'sealed.json')
        prepared = ch.record(state / 'prepare-data-ready.json')
        stage = ch.stage_path(spec)
        tree = stage.parent / ('monero-data-' + spec['id'])
        ch.same_stage(stage, ch.record(state / 'stage.json'))
        lmdb = ch.physical(tree / 'lmdb', True)
        ch.require(ch.record(state / 'spec.json') == spec and seal['sealed'] is True and seal['stage'] == str(stage) and
                   prepared['sha256'] == seal['sha256'] and prepared['dataDir'] == str(tree) and
                   prepared['database'] == seal['database'] and prepared['directoryIdentity'] == [tree.stat().st_dev, tree.stat().st_ino] and
                   {p.name for p in tree.iterdir()} == {'lmdb'} and {p.name for p in lmdb.iterdir()} == {'data.mdb'},
                   'The independent data directory no longer matches its receipt.')
        database = lmdb / 'data.mdb'
        request = {'release': release, 'prepared': ch.digest(ch.canonical(prepared))}
        intent, receipt = state / 'daemon-check-intent.json', state / 'daemon-checked.json'
        fd = os.open(database, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            st = os.fstat(fd)
            ch.require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and [st.st_dev, st.st_ino] == prepared['fileIdentity'][:2] and
                       st.st_uid in (0, user.pw_uid), 'The working database identity changed.')
            if intent.exists():
                ch.require(ch.record(intent) == request, 'A different daemon qualification already owns this candidate.')
            else:
                ch.require(list(ch.signature(st)) == prepared['fileIdentity'] and st.st_uid == 0,
                           'The working database changed before its first native startup.')
                ch.write_record(intent, request)
            if receipt.exists():
                past = ch.record(receipt)
                ch.require(st.st_uid == 0 and list(ch.signature(st)) == past['fileIdentity'], 'The verified candidate changed.')
                return past
            unit_state('omnitron-monero-check-' + spec['id'] + '.service')
            # Only this separate inode is visible inside the transient unit. Its lockfile,
            # logs and peer state are written to the private scratch directory in /run.
            os.fchown(fd, user.pw_uid, user.pw_gid)
            try:
                observed = isolated(spec['id'], release, database, seal['database'])
            finally:
                os.fchown(fd, 0, 0)
                os.fchmod(fd, 0o600)
                os.fsync(fd)
            evidence = {'dataDir': str(tree), 'sealedSha256': seal['sha256'], 'binarySha256': release['sha256'],
                        'fileIdentity': list(ch.signature(os.fstat(fd))), 'native': observed}
            ch.write_record(receipt, evidence)
            return evidence
        finally:
            os.close(fd)


if __name__ == '__main__':
    try:
        print(json.dumps(verify(*(json.loads(base64.b64decode(x, validate=True)) for x in sys.argv[1:])), sort_keys=True))
    except ch.Refusal as error:
        sys.exit(str(error))
    except (OSError, KeyError, ValueError, TypeError, subprocess.SubprocessError) as error:
        sys.exit('Offline Monero qualification failed (' + type(error).__name__ + ').')
