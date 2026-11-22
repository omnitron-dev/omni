"""Ask the official daemon to open a public chain inside an isolated Linux service."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request


def rpc(opener, method, params):
    data = json.dumps({'jsonrpc': '2.0', 'id': 'chain-check', 'method': method, 'params': params}).encode()
    request = urllib.request.Request('http://127.0.0.1:18081/json_rpc', data, {'Content-Type': 'application/json'})
    with opener.open(request, timeout=3) as response:
        value = json.loads(response.read(65536))
    if value.get('error') or not isinstance(value.get('result'), dict):
        raise ValueError('The offline daemon did not return the requested observation.')
    return value['result']


def check_chain(call, database):
    info = call('get_info', {})
    if (info.get('status') != 'OK' or info.get('nettype') != 'mainnet' or info.get('offline') is not True or
            info.get('height') != database['height'] or info.get('top_block_hash') != database['tip'] or
            any(info.get(k) != 0 for k in ('incoming_connections_count', 'outgoing_connections_count'))):
        raise ValueError('The offline chain, height, tip or peer count differs.')
    for height, expected in ((0, database['genesis']), (database['checkpointHeight'], database['checkpointHash']),
                             (database['height'] - 1, database['tip'])):
        reply = call('get_block_header_by_height', {'height': height})
        header = reply.get('block_header', {})
        if reply.get('status') != 'OK' or header.get('height') != height or header.get('hash') != expected:
            raise ValueError('A native block header differs from the sealed snapshot.')
    return {'height': info['height'], 'tip': info['top_block_hash'], 'genesis': database['genesis'],
            'checkpointHeight': database['checkpointHeight'], 'checkpointHash': database['checkpointHash'],
            'nettype': info['nettype'], 'offline': True, 'peers': 0}


def check_isolation(uid, gid):
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    # The service denies AF_NETLINK. procfs reports this process's own network namespace.
    interfaces = {line.partition(':')[0].strip()
                  for line in Path('/proc/self/net/dev').read_text().splitlines()[2:]}
    if (os.geteuid() != uid or uid == 0 or os.getegid() != gid or int(status['CapEff'].strip(), 16) != 0 or
            status['NoNewPrivs'].strip() != '1' or interfaces != {'lo'}):
        raise ValueError('The official daemon requires an unprivileged, loopback-only service.')


def probe(binary, directory, database, uid, gid):
    check_isolation(uid, gid)
    root = Path(directory)
    child = subprocess.Popen([binary, '--offline', '--non-interactive', '--no-zmq', '--no-igd',
                              '--disable-dns-checkpoints', '--check-updates', 'disabled', '--data-dir', directory,
                              '--rpc-bind-ip', '127.0.0.1', '--rpc-bind-port', '18081', '--p2p-bind-ip', '127.0.0.1',
                              '--log-file', str(root / 'daemon.log'), '--max-log-file-size', '1048576', '--max-log-files', '1'],
                             cwd=directory, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise ValueError('The official daemon exited before its RPC was ready.')
            try:
                if rpc(opener, 'get_info', {}).get('status') == 'OK':
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(1)
        else:
            raise ValueError('The offline native RPC did not become ready.')
        result = check_chain(lambda method, params: rpc(opener, method, params), database)
    finally:
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
            try:
                child.wait(timeout=75)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=10)
                raise ValueError('The isolated daemon did not shut down cleanly.') from None
    if child.returncode != 0:
        raise ValueError('The native daemon reported an unsuccessful shutdown.')
    return dict(result, cleanShutdown=True)


if __name__ == '__main__':
    try:
        print(json.dumps(probe(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))))
    except OSError as error:
        sys.exit('Native service OS error (errno ' + str(error.errno) + ').')
