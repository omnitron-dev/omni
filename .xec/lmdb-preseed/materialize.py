"""Materialize one sealed mainnet database in the layout consumed by monerod."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

import omnitron_preseed_channel as ch


def private_dir(path):
    ch.physical(path, True)
    ch.require(stat.S_IMODE(path.stat().st_mode) == 0o700, 'Candidate directory must be private.')
    return path


def file_identity(path, sizes):
    st = path.lstat()
    ch.require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and
               stat.S_IMODE(st.st_mode) in (0o400, 0o600) and st.st_size in sizes,
               'Unexpected snapshot file identity or length.')
    return [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns]


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for data in iter(lambda: source.read(4 * 1024 ** 2), b''):
            digest.update(data)
    return digest.hexdigest()


def check_tree(tree, seal):
    private_dir(tree)
    lmdb = private_dir(tree / 'lmdb')
    ch.require({p.name for p in tree.iterdir()} == {'lmdb'} and
               {p.name for p in lmdb.iterdir()} == {'data.mdb'}, 'Unexpected candidate contents.')
    return file_identity(lmdb / 'data.mdb', [seal['bytes']])


def materialize(state, stage, op, seal, reserve):
    source = private_dir(stage) / 'data.mdb'
    ch.require({p.name for p in stage.iterdir()} == {'data.mdb'}, 'Only the sealed database can be prepared.')
    size = seal['bytes']
    original = file_identity(source, [size])
    parent = stage.parent
    destination = parent / ('monero-data-' + op)
    scratch = parent / ('.preparing-monero-data-' + op)
    request = {'stage': str(stage), 'source': original, 'seal': ch.digest(ch.canonical(seal)),
               'destination': str(destination), 'reserveBytes': reserve}
    intent = state / 'prepare-data-intent.json'
    ready = state / 'prepare-data-ready.json'
    if intent.exists():
        ch.require(ch.record(intent) == request, 'The recorded data preparation differs.')
    else:
        ch.require(not any(os.path.lexists(p) for p in (destination, scratch, ready)), 'Candidate path is occupied.')
        ch.write_record(intent, request)

    if ready.exists():
        result = ch.record(ready)
        tree = destination if os.path.lexists(destination) else scratch
        ch.require(check_tree(tree, seal) == result['fileIdentity'] and
                   [tree.stat().st_dev, tree.stat().st_ino] == result['directoryIdentity'],
                   'The prepared candidate changed or was adopted. Inspect its existing receipt.')
        if tree == scratch:
            os.rename(scratch, destination)
            ch.sync_directory(parent)
        return result

    ch.require(not os.path.lexists(destination), 'A candidate appeared before publication.')
    scratch.mkdir(mode=0o700, exist_ok=True)
    private_dir(scratch)
    lmdb = scratch / 'lmdb'
    lmdb.mkdir(mode=0o700, exist_ok=True)
    private_dir(lmdb)
    ch.require({p.name for p in scratch.iterdir()} == {'lmdb'} and
               {p.name for p in lmdb.iterdir()} <= {'data.mdb'}, 'Unexpected preparation contents.')
    output = lmdb / 'data.mdb'
    reusable = False
    if os.path.lexists(output):
        identity = file_identity(output, range(size + 1))
        ch.require(identity[:2] != original[:2], 'The candidate shares the source inode.')
        reusable = identity[2] == size and file_hash(output) == seal['sha256']
        if not reusable:
            output.unlink()
    if not reusable:
        ch.require(shutil.disk_usage(parent).free >= size + reserve, 'Insufficient space for an independent candidate.')
        subprocess.run(['/usr/bin/cp', '--reflink=auto', '--sparse=always', '--', str(source), str(output)], check=True)
        ch.require(file_identity(output, [size])[:2] != original[:2] and file_hash(output) == seal['sha256'],
                   'The independent candidate differs from the sealed data.')
    ch.require(file_identity(source, [size]) == original, 'The sealed source changed during preparation.')
    ch.require(shutil.disk_usage(parent).free >= reserve, 'The disk has fallen below the reviewed free-space reserve.')
    os.chmod(output, 0o600)
    with output.open('rb') as item:
        os.fsync(item.fileno())
    ch.sync_directory(lmdb)
    ch.sync_directory(scratch)
    result = {'sourceStage': str(stage), 'dataDir': str(destination), 'bytes': size, 'sha256': seal['sha256'],
              'database': seal['database'], 'directoryIdentity': [scratch.stat().st_dev, scratch.stat().st_ino],
              'fileIdentity': check_tree(scratch, seal)}
    ch.write_record(ready, result)
    os.rename(scratch, destination)
    ch.sync_directory(parent)
    return result


def main(spec, offer, seal, reserve):
    os.umask(0o077)
    ch.require(sys.platform == 'linux' and os.geteuid() == 0 and ch.ID.fullmatch(spec['id']) and
               spec['receiverFingerprint'] == ch.fingerprint(ch.key_text(ch.HOST_KEY)) and
               spec['payload'] == 'monero-lmdb-compact-v1' and spec['nettype'] == 'mainnet' and
               isinstance(reserve, int) and 0 <= reserve <= 16 * 1024 ** 4, 'Unexpected recipient or specification.')
    state = ch.physical(ch.ROOT / spec['id'], True)
    with ch.lock(state / 'admin.lock', True):
        stage = ch.stage_path(spec)
        ch.same_stage(stage, ch.record(state / 'stage.json'))
        ch.require(ch.record(state / 'spec.json') == spec and seal == ch.record(state / 'sealed.json') and
                   offer['spec'] == ch.digest(ch.canonical(spec)) and seal['offer'] == ch.digest(ch.canonical(offer)) and
                   seal['sealed'] is True and seal['manifest'] == offer['manifest'] and seal['stage'] == str(stage) and
                   seal['format'] == spec['payload'] and 0 < seal['bytes'] <= spec['maxBytes'] and
                   re.fullmatch('[0-9a-f]{64}', seal['sha256']), 'The confirmed receiver seal differs.')
        return materialize(state, stage, spec['id'], seal, reserve)


if __name__ == '__main__':
    try:
        print(json.dumps(main(*(json.loads(base64.b64decode(x, validate=True)) for x in sys.argv[1:])), sort_keys=True))
    except ch.Refusal as error:
        sys.exit(str(error))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        sys.exit('Preparing the sealed mainnet database failed (' + type(error).__name__ + ').')
