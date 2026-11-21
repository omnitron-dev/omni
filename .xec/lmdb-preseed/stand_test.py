"""Exercise exported steps on two dedicated Linux/sshd fixtures on one internal Docker network."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
import time
import uuid


def run(*args, data=None, check=True, cwd=None, timeout=180):
    return subprocess.run([str(a) for a in args], input=data, capture_output=True, timeout=timeout, check=check, cwd=cwd)


def main():
    flags = argparse.ArgumentParser(description=__doc__)
    for name in ('work', 'cli-node', 'cli-js', 'source', 'receiver', 'helper', 'fixture'):
        flags.add_argument('--' + name, required=True)
    args = flags.parse_args()
    repo = Path(__file__).resolve().parents[2]
    work = Path(tempfile.mkdtemp(prefix='snapshot-stand-', dir=args.work))
    source, receiver = args.source, args.receiver
    sides = [json.loads(run('docker', 'inspect', name).stdout)[0] for name in (source, receiver)]
    nets = [side['NetworkSettings']['Networks'] for side in sides]
    assert sides[0]['Id'] != sides[1]['Id'] and len(nets[0]) == 1 and list(nets[0]) == list(nets[1])
    assert all(side['Config']['Labels'].get('org.omnitron.preseed-qa') and side['State']['Running'] for side in sides)
    assert json.loads(run('docker', 'network', 'inspect', next(iter(nets[0]))).stdout)[0]['Internal']

    def shell(container, script, check=True):
        result = run('docker', 'exec', '-i', container, '/bin/sh', '-se', data=script.encode(), check=False)
        if check and result.returncode:
            raise RuntimeError('Fixture endpoint failed: ' + result.stderr.decode(errors='replace')[-400:])
        return result

    def save(name, value):
        file = work / (name + '.json')
        file.write_text(json.dumps(value, indent=2) + '\n')
        return file

    def host_pin(container):
        return shell(container, 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub').stdout.decode().split()[1]

    op = str(uuid.uuid4())
    source_dir = '/srv/fixture-' + op + '/lmdb'
    stage_parent = '/srv/stage-' + op
    run('docker', 'cp', args.fixture, source + ':/run/test-fixture-' + op)
    fixture = '/run/test-fixture-' + op + ' ' + source_dir
    shell(source, 'mkdir -p ' + source_dir + '\n' + fixture + ' 0 48 0')
    shell(receiver, 'mkdir -m 755 ' + stage_parent)
    machine = shell(source, 'uname -m').stdout.decode().strip()
    spec = {'id': op, 'sourceNode': 'source-fixture', 'receiverNode': 'receiver-fixture', 'lmdb': source_dir,
            'sourceFingerprint': host_pin(source), 'receiverFingerprint': host_pin(receiver), 'receiverPort': 22,
            'sourceIp': next(iter(nets[0].values()))['IPAddress'], 'receiverIp': next(iter(nets[1].values()))['IPAddress'],
            'stageParent': stage_parent, 'rateKiB': 512, 'ttlMinutes': 30, 'payload': 'monero-lmdb-compact-v1',
            'nettype': 'mainnet', 'machine': machine, 'minimumHeight': 48, 'maxBytes': 32 << 20,
            'helperSha256': hashlib.sha256(Path(args.helper).read_bytes()).hexdigest()}
    spec_file = save('spec', spec)
    state_path = '/var/lib/omnitron-block-preseed/' + op
    native = '/var/lib/omnitron-lmdb-tools/' + spec['helperSha256']

    def graph(phase, offer=None):
        command = ['pnpm', 'exec', 'xec', 'lmdb-preseed', phase, spec_file]
        if phase != 'revoke':
            command += ['--helper', args.helper]
        if offer:
            command += ['--offer', save('offer-' + str(offer['issued']), offer)]
        file = work / (phase + '.json')
        file.write_bytes(run(*command, cwd=repo).stdout)
        checked = json.loads(run(args.cli_node, args.cli_js, '--json', 'pipeline', 'check', file).stdout)
        assert checked['ok']; save('checked-' + phase, checked)
        return {step['name']: step['run'] for step in json.loads(file.read_bytes())['steps']}

    def step(container, graph, name):
        return json.loads(shell(container, graph[name]).stdout)

    def install(container, graph):
        parts = [name for name in graph if name.startswith('helper-part-')]
        assert parts
        first = step(container, graph, parts[0])
        assert step(container, graph, parts[0]) == first
        if not first['alreadyInstalled']:
            assert shell(container, graph['checked-helper'], False).returncode
        for name in parts[1:]:
            step(container, graph, name)
        installed = step(container, graph, 'checked-helper')
        assert step(container, graph, 'checked-helper')['alreadyInstalled']
        return installed

    def wait_for_partial(stage, old_time=''):
        part = stage + '/.part'
        shell(receiver, 'for i in $(seq 1 150); do test "$(stat -c %y ' + part + ' 2>/dev/null || true)" != ' + shlex.quote(old_time) +
              ' && test "$(stat -c %s ' + part + ' 2>/dev/null || true)" -ge 262144 2>/dev/null && exit 0; sleep .15; done; exit 1')

    offering = graph('offer')
    if not shell(source, 'test -f ' + native, False).returncode:
        shell(source, 'mv ' + native + ' /run/previous-fixture-helper-' + op)
    install(source, offering)
    public = step(source, offering, 'offer')
    assert public == step(source, offering, 'offer') and public['anchor']['height'] == 48
    copy = graph('copy', public); revocation = graph('revoke')
    install(receiver, copy)
    grant = step(receiver, copy, 'grant')
    account, stage = grant['account'], grant['stage']
    assert account == 'obp' + op.replace('-', '')[:20] and stage == stage_parent + '/block-preseed-' + op
    shell(receiver, 'test "$(id -u ' + account + ')" -gt 0\n' +
          'test "$(stat -c %u ' + state_path + '/home/.ssh/authorized_keys)" = 0\n' +
          'grep -q ' + shlex.quote('restrict,from="' + spec['sourceIp'] + '",expiry-time=') + ' ' + state_path + '/home/.ssh/authorized_keys')
    with concurrent.futures.ThreadPoolExecutor(1) as background:
        first = background.submit(shell, source, copy['send'], False)
        wait_for_partial(stage)
        shell(receiver, 'pkill -TERM -u ' + account)
        assert first.result().returncode and shell(receiver, 'test ! -e ' + stage + '/data.mdb').returncode == 0
        assert step(receiver, revocation, 'revoke')['revoked'] and step(source, revocation, 'forget')['sourceKeyRemoved']
        partial_size = int(shell(receiver, 'stat -c %s ' + stage + '/.part').stdout)
        again = step(source, offering, 'offer')
        assert again['publicKey'] != public['publicKey'] and again['manifest'] == public['manifest']
        copy = graph('copy', again)
        step(receiver, copy, 'grant')
        old_time = shell(receiver, 'stat -c %y ' + stage + '/.part').stdout.decode().strip()
        final = background.submit(shell, source, copy['send'])
        wait_for_partial(stage, old_time)
        # The long-lived copy transaction remains open while another process commits new blocks.
        shell(source, fixture + ' 48 64 25')
        sent = json.loads(final.result().stdout)
    live = json.loads(shell(source, native + ' observe-live ' + source_dir + ' 47').stdout)
    assert live['height'] == 64
    # Revoke both credentials before acceptance, as on a lost final ACK or during delayed recovery.
    assert step(receiver, revocation, 'revoke')['revoked'] and step(source, revocation, 'forget')['sourceKeyRemoved']
    accept = graph('accept', again)
    install(receiver, accept)
    sealed = step(receiver, accept, 'seal')
    assert sealed['sealed'] and sent['bytes'] == sealed['bytes'] and sent['sha256'] == sealed['sha256']
    assert sealed['database']['height'] == 48 and sealed['database']['checkpointHash'] == public['anchor']['tip']
    assert step(source, accept, 'forget')['sourceKeyRemoved']
    assert step(receiver, copy, 'grant') == step(receiver, copy, 'seal') == sealed and step(source, copy, 'send') == sent
    assert shell(receiver, 'getent passwd ' + account, False).returncode != 0
    shell(receiver, 'test "$(ls -A ' + stage + ')" = data.mdb\n' +
          'test "$(stat -c %u:%g:%a ' + stage + ')" = 0:0:700\n' +
          'test "$(stat -c %u:%g:%a ' + stage + '/data.mdb)" = 0:0:400')
    shell(source, 'test ! -e ' + state_path + '/identity\ntest -z "$(find ' + state_path + ' -type f -size +128k -print -quit)"')
    print(save('transport-receipt', {'sourceToReceiverOpenSSH': True, 'closedNetwork': True, 'stockPipelineCheck': ['offer', 'copy', 'revoke', 'accept'],
                                    'helperSha256': spec['helperSha256'], 'interruptedBytes': partial_size, 'newLease': True,
                                    'liveHeightAfterConcurrentWriter': live['height'], 'sealed': sealed, 'sourceKeyRemoved': True,
                                    'receiverAccountRemoved': True, 'replayedReceipt': True, 'rootOnlyStage': True}))


if __name__ == '__main__':
    main()
