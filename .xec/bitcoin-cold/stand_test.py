"""Qualify normal Xec exports on two disposable Linux sshd hosts and real 31.1/32.1 regtest."""

import argparse
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
import time
import uuid


def run(args, data=None, timeout=240, cwd=None, check=True):
    p = subprocess.run(
        [str(x) for x in args],
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        cwd=cwd,
    )
    if check and p.returncode:
        # The fixture builds no private user data. Never print stdin or an entire reviewed command.
        raise RuntimeError(
            'Fixture failed (' + str(args[:2]) + '): ' + p.stderr.decode(errors='replace')[-450:]
        )
    return p


def main():
    flags = argparse.ArgumentParser(description=__doc__)
    for key in ('work', 'source', 'receiver', 'core31', 'archive32', 'cli-node', 'cli-js'):
        flags.add_argument('--' + key, required=True)
    flags.add_argument(
        '--with-txindex', action='store_true', help='Cover the unpruned txindex and absent-target variant'
    )
    a = flags.parse_args()
    repo = Path(__file__).resolve().parents[2]
    work = Path(tempfile.mkdtemp(dir=a.work, prefix='stand-'))
    print('Fixture receipt directory ' + str(work), flush=True)
    sides = [json.loads(run(['docker', 'inspect', n]).stdout)[0] for n in (a.source, a.receiver)]
    assert all(
        c['Config']['Labels'].get('org.omnitron.preseed-qa')
        and c['State']['Running']
        and not c['Mounts']
        and not c['HostConfig']['Privileged']
        for c in sides
    )
    nets = [c['NetworkSettings']['Networks'] for c in sides]
    assert len(nets[0]) == 1 and list(nets[0]) == list(nets[1]) and sides[0]['Id'] != sides[1]['Id']
    network = next(iter(nets[0]))
    assert json.loads(run(['docker', 'network', 'inspect', network]).stdout)[0]['Internal']

    def sh(side, cmd, check=True):
        return run(['docker', 'exec', '-i', side, 'sh', '-se'], cmd.encode(), check=check)

    def text(side, cmd):
        return sh(side, cmd).stdout.decode().strip()

    def save(name, value):
        p = work / (name + '.json')
        p.write_text(json.dumps(value, indent=2))
        return p

    def export(cmd, phase, spec, offer=None, release=None, installation=None):
        args = ['pnpm', 'exec', 'xec', cmd, phase, save(cmd + '-spec', spec)]
        if offer:
            args += ['--offer', save(cmd + '-public-offer', offer)]
        if release:
            args += ['--release', save(cmd + '-release', release)]
        if installation:
            args += ['--installation', save(cmd + '-installation', installation)]
        p = work / (cmd + '-' + phase + '-definition.json')
        p.write_bytes(run(args, cwd=repo).stdout)
        native = json.loads(run([a.cli_node, a.cli_js, '--json', 'pipeline', 'check', p]).stdout)
        assert native['ok']
        graph = json.loads(p.read_bytes())
        budget = max(len(st['run'].encode()) for st in graph['steps'])
        assert budget <= (22 * 1024 if cmd == 'bitcoin-cold' else 32768)
        return graph

    node_map = {'source-fixture': a.source, 'receiver-fixture': a.receiver}

    def step(graph, name, check=True):
        st = next(st for st in graph['steps'] if st['name'] == name)
        p = sh(node_map[st['nodeId']], st['run'], check)
        return json.loads(p.stdout) if check else p

    def install(graph):
        for st in graph['steps']:
            if 'helper-part-' in st['name']:
                step(graph, st['name'])

    def pin(side):
        return text(side, 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub').split()[1]

    op = str(uuid.uuid4())
    source = '/srv/fixture-' + op
    base = source + '/regtest'
    raw = base + '/blocks'
    stage = '/srv/stage-' + op
    parent = '/srv/candidates-' + op
    cli = '/opt/core31/bin/bitcoin-cli -chain=regtest -datadir=' + source
    prune = 0 if a.with_txindex else 550
    indexes = ['txindex'] if a.with_txindex else []
    daemon = (
        '/opt/core31/bin/bitcoind -chain=regtest -datadir='
        + source
        + ' -disablewallet -server -listen=0 -networkactive=0 -dnsseed=0 -fixedseeds=0 -fastprune=1 -daemonwait -prune='
        + str(prune)
        + (' -txindex=1' if a.with_txindex else '')
    )
    sh(a.source, 'mkdir -p ' + source + ' /opt/core31')
    for sub in ['bin', 'libexec']:
        run(['docker', 'cp', str(Path(a.core31) / sub), a.source + ':/opt/core31/'])
    sh(
        a.receiver,
        'mkdir -m 755 -p '
        + stage
        + ' '
        + parent
        + ' /srv/bitcoin-releases\ngetent passwd bitcoin >/dev/null || useradd --system --user-group --no-create-home bitcoin',
    )
    archive = '/srv/bitcoin-releases/bitcoin-32.1.tar.gz'
    run(['docker', 'cp', a.archive32, a.receiver + ':' + archive])
    sh(a.receiver, 'chown 0:0 ' + archive + '\nchmod 0444 ' + archive)
    sh(a.source, daemon)
    # No wallet, private key or external network is needed for protocol-valid test blocks.
    sh(a.source, cli + " generatetodescriptor 900 'raw(51)' >/dev/null")
    idx = int(text(a.source, 'ls ' + raw + "/blk*.dat | tail -1 | sed -E 's/.*blk0*([0-9]+)\\.dat/\\1/'"))
    assert idx >= 2
    common = dict(
        sourceNode='source-fixture',
        receiverNode='receiver-fixture',
        sourceIp=next(iter(nets[0].values()))['IPAddress'],
        receiverIp=next(iter(nets[1].values()))['IPAddress'],
        sourceFingerprint=pin(a.source),
        receiverFingerprint=pin(a.receiver),
        receiverPort=22,
        stageParent=stage,
        rateKiB=4096,
        ttlMinutes=60,
    )
    hot = dict(common, id=str(uuid.uuid4()), blocks=raw, firstActive=idx)
    hot_offer = step(export('block-preseed', 'offer', hot), 'offer')
    graph = export('block-preseed', 'copy', hot, hot_offer)
    for phase in ['grant', 'send', 'seal', 'forget']:
        step(graph, phase)
    print('Hot closed segments sealed ' + str(hot_offer['files']), flush=True)
    tip = json.loads(text(a.source, cli + ' getblockchaininfo'))
    assert tip['blocks'] == 900 and tip['pruned'] == bool(prune)
    if a.with_txindex:
        for _ in range(100):
            detail = json.loads(text(a.source, cli + ' getindexinfo'))['txindex']
            if detail['synced'] and detail['best_block_height'] == tip['blocks']:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('The old native txindex never reached its block tip.')
    # Synthetic systemd metadata fronts a real PID, real POSIX locks, official native binaries
    # and real clean Core exit. There is no init system in these dedicated sshd containers.
    stamp = '12345'
    boot = text(a.source, 'cat /proc/sys/kernel/random/boot_id')
    mode = '/run/fixture-bitcoin-stop'
    systemctl = """#!/bin/sh
test "$1" = show || exit 8
cat <<EOF
Id=fixture-bitcoin.service
LoadState=loaded
ActiveState=inactive
SubState=dead
MainPID=0
Result=success
ExecMainCode=1
ExecMainStatus=$(cat /run/fixture-bitcoin-stop)
ExecMainStartTimestampMonotonic=12345
ExecMainExitTimestampMonotonic=12346
EOF
"""
    sh(
        a.source,
        "cat > /usr/bin/systemctl <<'MOCK'\n"
        + systemctl
        + 'MOCK\nchmod 755 /usr/bin/systemctl\necho 0 > '
        + mode,
    )
    uid = int(text(a.receiver, 'id -u bitcoin'))
    gid = int(text(a.receiver, 'id -g bitcoin'))
    spec = dict(
        common,
        id=op,
        dataDir=base,
        blocks=raw,
        sourceUnit='fixture-bitcoin.service',
        sourceBootId=boot,
        sourceStartUsec=stamp,
        hotId=hot['id'],
        hotManifest=hot_offer['manifest'],
        chain='regtest',
        indexes=indexes,
        pruneMiB=prune,
        anchorHeight=900,
        anchorHash=tip['bestblockhash'],
        targetUser='bitcoin',
        targetUid=uid,
        targetGid=gid,
        candidateParent=parent,
    )
    cold = export('bitcoin-cold', 'offer', spec)
    install(cold)
    assert step(cold, 'check-hot-seal')['manifest'] == hot_offer['manifest']
    assert step(cold, 'offer', False).returncode  # live Core actually holds the data and LevelDB locks
    # Core removes its RPC cookie before all database flushes and lock releases complete.
    # Record the actual process and wait through exit before declaring a successful systemd stop.
    pid = int(text(a.source, 'cat ' + base + '/bitcoind.pid'))
    marker = text(a.source, 'cut -d " " -f22 /proc/' + str(pid) + '/stat')
    sh(a.source, cli + ' stop')
    wait = """import sys,time
from pathlib import Path
p=Path('/proc')/sys.argv[1]/'stat'
for _ in range(300):
    try: fields=p.read_text().split()
    except FileNotFoundError: break
    if fields[2]=='Z' or fields[21]!=sys.argv[2]: break
    time.sleep(.1)
else: raise SystemExit('The isolated old Core process did not exit cleanly.')
"""
    sh(a.source, 'python3 -I -c ' + shlex.quote(wait) + ' ' + str(pid) + ' ' + marker)
    sh(a.source, 'echo 9 > ' + mode)
    assert step(cold, 'offer', False).returncode
    sh(
        a.source,
        'echo 0 > '
        + mode
        + '\nmkdir -p '
        + base
        + '/wallets\nprintf sentinel > '
        + base
        + '/wallets/private-fixture\nprintf transient > '
        + base
        + '/.cookie',
    )
    offered = step(cold, 'offer')
    assert (
        offered['reuseFiles'] == hot_offer['files']
        and offered['reuseBytes'] == hot_offer['bytes']
        and offered['files'] > offered['reuseFiles']
    )
    print('Cold offer ' + str(offered['files']) + ' files', flush=True)
    graph = export('bitcoin-cold', 'copy', spec, offered)
    install(graph)
    assert step(graph, 'check-hot-seal')['manifest'] == hot_offer['manifest']
    step(graph, 'grant')
    # Deliberately interrupt a genuine authenticated stream after one complete cold object.
    # The original operation certifies this object; the new account must independently rehash it.
    run(['docker', 'cp', repo / '.xec/block-preseed/endpoint.py', a.source + ':/run/fixture-channel.py'])
    partial = """import json,runpy,struct,subprocess,sys
from pathlib import Path
ch=runpy.run_path('/run/fixture-channel.py')
state=Path('/var/lib/omnitron-block-preseed')/sys.argv[1]; spec=json.loads((state/'spec.json').read_bytes())
raw=(state/'manifest.json').read_bytes(); row=next(row for row in json.loads(raw) if not row[3])
child=subprocess.Popen(ch['ssh_command'](spec,state),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
ch['reply'](child.stdin,struct.pack('!I',len(raw))+raw); assert child.stdout.read(1)==b'S'
file=Path(spec['blocks'])/row[0][7:] if row[0].startswith('blocks/') and not row[0].startswith('blocks/index/') else Path(spec['dataDir'])/row[0]
ch['reply'](child.stdin,file.read_bytes()); assert child.stdout.read(1)==b'K'
child.stdin.close(); child.stdout.close(); assert child.wait(timeout=30)!=0
"""
    sh(a.source, 'python3 -I -c ' + shlex.quote(partial) + ' ' + op)
    revoke = export('bitcoin-cold', 'revoke', spec)
    install(revoke)
    step(revoke, 'revoke')
    step(revoke, 'forget')
    new_offer = step(cold, 'offer')
    assert new_offer['manifest'] == offered['manifest'] and new_offer['publicKey'] != offered['publicKey']
    offered = new_offer
    graph = export('bitcoin-cold', 'copy', spec, offered)
    install(graph)
    assert step(graph, 'check-hot-seal')['manifest'] == hot_offer['manifest']
    step(graph, 'grant')
    sent = step(graph, 'send')
    seal = step(graph, 'seal')
    key = step(graph, 'forget')
    assert sent['previouslyTransferred'] == 1
    assert (
        sent['reusedHotFiles'] == hot_offer['files']
        and seal['manifest'] == offered['manifest']
        and key['sourceKeyRemoved']
    )
    assert step(graph, 'seal') == seal
    graph = export('bitcoin-cold', 'adopt', spec, offered)
    install(graph)
    adopted = step(graph, 'adopt')
    assert step(graph, 'adopt') == adopted
    data = adopted['candidate']
    dat = data + '/regtest'
    assert text(
        a.receiver,
        'test ! -e '
        + dat
        + '/wallets && test ! -e '
        + dat
        + '/.cookie && stat -c %u '
        + dat
        + '/chainstate/CURRENT',
    ) == str(uid)
    hot_file = stage + '/block-preseed-' + hot['id'] + '/blk00000.dat'
    assert text(a.receiver, 'stat -c %i ' + hot_file) != text(
        a.receiver, 'stat -c %i ' + dat + '/blocks/blk00000.dat'
    )
    original_digest = text(a.receiver, 'sha256sum ' + hot_file).split()[0]
    artifact = '/opt/stand-installed-32.1'
    sh(
        a.receiver,
        'mkdir -p -m 755 '
        + artifact
        + '\nchmod 0755 '
        + artifact
        + '\ntar -xzf '
        + archive
        + ' -C '
        + artifact
        + ' --strip-components=2 bitcoin-32.1/bin/bitcoind bitcoin-32.1/bin/bitcoin-cli\nchown 0:0 '
        + artifact
        + '/bitcoin*',
    )
    graph = export('bitcoin-cold', 'qualify', spec, offered, dict(binDir=artifact, machine='x86_64'))
    # No external management interface remains on this disposable receiver while Core runs.
    run(['docker', 'network', 'disconnect', network, a.receiver])
    try:
        sh(a.receiver, 'mv ' + data + ' ' + data + '.kept\nmkdir -m 700 ' + data)
        assert step(graph, 'qualify', False).returncode
        sh(a.receiver, 'rmdir ' + data + '\nmv ' + data + '.kept ' + data)
        verified = step(graph, 'qualify')
    finally:
        run(['docker', 'network', 'connect', network, a.receiver])
    assert (
        verified['height'] == 900
        and verified['tip'] == tip['bestblockhash']
        and verified['version'] == 320100
    )
    assert (
        verified['pruned'] == bool(prune)
        and verified['indexes'] == indexes
        and verified['cleanStop']
        and verified['networkInterfaces'] == ['lo']
        and verified['releaseMode'] == 'installed'
    )
    # Exercise canonical adoption only on an empty, physically identified disposable target.
    target = '/srv/live-' + op
    sh(
        a.receiver,
        'mkdir -m 700 '
        + target
        + "\ncat > /usr/bin/systemctl <<'MOCK'\n#!/bin/sh\ncat <<EOF\nId=fixture-bitcoin.service\nLoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nEOF\nMOCK\nchmod 755 /usr/bin/systemctl",
    )
    dev, ino = text(a.receiver, 'stat -c "%d %i" ' + target).split()
    install_spec = {
        'dataDir': target,
        'unit': 'fixture-bitcoin.service',
        'previous': {'kind': 'empty', 'device': dev, 'inode': ino},
    }
    if a.with_txindex:
        install_spec['previous'] = {'kind': 'absent'}
    publish = export('bitcoin-cold', 'publish', spec, offered, installation=install_spec)
    install(publish)
    sh(a.receiver, 'touch ' + target + '/outside-scope')
    assert step(publish, 'publish', False).returncode
    sh(a.receiver, 'unlink ' + target + '/outside-scope')
    if a.with_txindex:
        sh(a.receiver, 'rmdir ' + target)
    installed = step(publish, 'publish')
    assert step(graph, 'qualify', False).returncode
    ch_state = '/var/lib/omnitron-block-preseed/' + op
    sh(
        a.receiver, 'unlink ' + ch_state + '/published.json'
    )  # Lost ack after atomic rename, before the terminal receipt.
    assert installed['installed'] and step(publish, 'publish') == installed
    if a.with_txindex:
        sh(a.receiver, 'test ! -e ' + data)
    else:
        assert text(a.receiver, 'stat -c %i ' + data) == ino
    undo = export('bitcoin-cold', 'restore', spec, offered, installation=install_spec)
    install(undo)
    reversed_ = step(undo, 'restore')
    sh(a.receiver, 'unlink ' + ch_state + '/restored.json')
    assert not reversed_['installed'] and step(undo, 'restore') == reversed_
    if a.with_txindex:
        sh(a.receiver, 'test ! -e ' + target)
    else:
        assert text(a.receiver, 'stat -c %i ' + target) == ino
    sh(a.receiver, 'test -f ' + dat + '/chainstate/CURRENT')
    assert step(publish, 'publish', False).returncode
    assert original_digest == text(a.receiver, 'sha256sum ' + hot_file).split()[0]
    sh(a.source, daemon)
    old = json.loads(text(a.source, cli + ' getblockchaininfo'))
    assert old['bestblockhash'] == tip['bestblockhash'] and old['blocks'] == 900
    assert sorted(json.loads(text(a.source, cli + ' getindexinfo'))) == indexes
    sh(a.source, cli + ' stop')
    print(
        save(
            'qualification-receipt',
            {
                'standardXecExports': True,
                'nativePipelineChecks': True,
                'directRestrictedSsh': True,
                'systemdProperties': 'fixture',
                'actualCoreLockRefused': True,
                'failedStopRefused': True,
                'sourceVersion': 310100,
                'previousTarget': install_spec['previous']['kind'],
                'lostHandoffAcknowledgementReconciled': True,
                'replacedOrPublishedQualificationRefused': True,
                'rollbackSourceHeight': old['blocks'],
                'sourceAndTargetIndependent': True,
                'liveClosed': hot_offer['files'],
                'coldFiles': offered['files'],
                'transferredFiles': sent['transferredFiles'],
                'reusedBytes': offered['reuseBytes'],
                'recoveredColdFiles': sent['previouslyTransferred'],
                'adopted': adopted,
                'qualified': verified,
                'published': installed,
                'restored': reversed_,
            },
        ),
        flush=True,
    )


if __name__ == '__main__':
    main()
