"""Read only the public Core RPCs and the live process identity used to review a cold window."""

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def capture(command):
    p = subprocess.run(
        command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20
    )
    if p.returncode:
        raise ValueError('The requested native public observation is unavailable.')
    return p.stdout.decode()


def main(s):
    alg, key = Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[:2]
    pin = 'SHA256:' + base64.b64encode(
        hashlib.sha256(base64.b64decode(key, validate=True)).digest()
    ).decode().rstrip('=')
    if alg != 'ssh-ed25519' or pin != s['sourceFingerprint']:
        raise ValueError('Registered donor identity changed.')
    unit, data, conf, raw = s['sourceUnit'], Path(s['dataDir']), s['sourceConfig'], Path(s['blocks'])

    def service():
        return dict(
            line.split('=', 1)
            for line in capture(
                [
                    '/usr/bin/systemctl',
                    'show',
                    '--no-pager',
                    '--property=Id,LoadState,ActiveState,MainPID,ExecMainStartTimestampMonotonic',
                    '--',
                    unit,
                ]
            ).splitlines()
        )

    before = service()
    pid = int(before['MainPID'])
    if (
        before['Id'] != unit
        or before['LoadState'] != 'loaded'
        or before['ActiveState'] != 'active'
        or pid <= 1
    ):
        raise ValueError('The reviewed source unit must be running.')
    proc = Path('/proc') / str(pid)
    argv = (proc / 'cmdline').read_bytes().split(b'\0')
    if not argv or Path(os.fsdecode(argv[0])).name not in ('bitcoind', 'bitcoin-node'):
        raise ValueError('Unexpected systemd process.')

    def paths(key):
        prefix = ('-' + key + '=').encode()
        return [Path(os.fsdecode(a[len(prefix) :])) for a in argv if a.startswith(prefix)]

    if paths('datadir') != [data] or paths('conf') != [Path(conf)]:
        raise ValueError('The running source has different data or config paths.')

    def holds(line, file):
        c = line.split()
        if len(c) < 6 or c[1] != 'POSIX' or c[3] != 'WRITE' or not c[4].isdigit() or int(c[4]) != pid:
            return False
        d = c[5].split(':')
        return len(d) == 3 and (int(d[0], 16), int(d[1], 16), int(d[2])) == (
            os.major(file.st_dev),
            os.minor(file.st_dev),
            file.st_ino,
        )

    locks = Path('/proc/locks').read_text().splitlines()
    for folder in (data, raw):
        file = (folder / '.lock').stat()
        if not any(holds(line, file) for line in locks):
            raise ValueError(
                'The service does not own both the declared Bitcoin data and raw block directory locks.'
            )

    def rpc(method):
        return json.loads(capture([s['sourceCli'], '-conf=' + conf, '-datadir=' + str(data), method]))

    chain = rpc('getblockchaininfo')
    states = rpc('getchainstates')['chainstates']
    indexes = rpc('getindexinfo')
    version = rpc('getnetworkinfo')['version']
    opened = False
    for fd in (proc / 'fd').iterdir():
        try:
            path = Path(os.readlink(fd))
        except FileNotFoundError:
            continue
        if path.parent == raw and re.fullmatch(r'(blk|rev)[0-9]{5}\.dat|xor\.dat', path.name):
            opened = True
    if before != service():
        raise ValueError('The source invocation changed during the observation.')
    return {
        'sourceUnit': unit,
        'sourceBootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        'sourceStartUsec': before['ExecMainStartTimestampMonotonic'],
        'dataDir': str(data),
        'blocks': str(raw),
        'blocksdirArgument': [str(p) for p in paths('blocksdir')],
        'observedOpenRawFile': opened,
        'dataAndRawLocksOwned': True,
        'version': version,
        'chain': chain['chain'],
        'anchorHeight': chain['blocks'],
        'anchorHash': chain['bestblockhash'],
        'pruned': chain['pruned'],
        'pruneHeight': chain.get('pruneheight'),
        'pruneTargetBytes': chain.get('prune_target_size'),
        'chainstates': [
            {
                k: v
                for k, v in item.items()
                if k in ('blocks', 'bestblockhash', 'validated', 'snapshot_blockhash')
            }
            for item in states
        ],
        'indexes': {
            name: {k: v for k, v in detail.items() if k in ('synced', 'best_block_height')}
            for name, detail in indexes.items()
        },
    }


if __name__ == '__main__':
    try:
        print(
            json.dumps(main(json.loads(base64.b64decode(sys.argv[1], validate=True))), separators=(',', ':')),
            flush=True,
        )
    except Exception as error:
        sys.exit('Native public chain observation failed (' + type(error).__name__ + ').')
