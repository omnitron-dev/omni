"""Run with the fixed production probe and a real monero-wallet-rpc inside an isolated Linux user and network.

python3 -I monero-wallet-membership.py <monero-wallet-rpc> <probe.py> [<compiled-controller-digest.mjs> <node>]
The controller module reads a synthetic [challenge, user, password] JSON array on stdin and answers on its private pipe.
The caller supplies a private /tmp, a writable private /run, a non-root account and a network namespace with loopback alone.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(value):
    return hashlib.sha256(value.encode('ascii')).hexdigest()

def authorization(challenge, user, password):
    kind, values = challenge.split(' ', 1)
    require(kind.lower() == 'digest', 'Expected Digest on the fixture')
    fields = urllib.request.parse_keqv_list(urllib.request.parse_http_list(values))
    alg = fields.get('algorithm', 'MD5'); realm = fields['realm']; nonce = fields['nonce']
    require(alg.upper() in ('MD5','MD5-SESS') and 'auth' in fields['qop'].split(','), 'Unsupported test Digest')
    md5 = lambda value: hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()
    cnonce = secrets.token_hex(16); nc = '00000001'; ha1 = md5(':'.join((user, realm, password)))
    if alg.upper() == 'MD5-SESS':
        ha1 = md5(':'.join((ha1, nonce, cnonce)))
    result = md5(':'.join((ha1, nonce, nc, cnonce, 'auth', md5('POST:/json_rpc'))))
    answer = ('Digest username="%s", realm="%s", nonce="%s", uri="/json_rpc", algorithm=%s, '
              'qop=auth, nc=%s, cnonce="%s", response="%s"') % (user,realm,nonce,alg,nc,cnonce,result)
    return answer+(', opaque="%s"' % fields['opaque'] if 'opaque' in fields else '')


def run_fixture(binary, probe, controller=None, node=None):
    require(sys.platform == 'linux' and os.geteuid() != 0, 'A non-root Linux test account is required')
    require({v[1] for v in socket.if_nameindex()} == {'lo'}, 'An isolated loopback-only network is required')
    binary = Path(binary).resolve(strict=True)
    require(binary.name == 'monero-wallet-rpc', 'Expected the Monero wallet RPC binary')
    with binary.open('rb') as executable:
        binary_sha = hashlib.file_digest(executable, 'sha256').hexdigest()
    python = sys.executable
    ss = shutil.which('ss')
    require(ss and Path(ss).is_absolute(), 'A native Linux socket inventory is required')
    with tempfile.TemporaryDirectory(prefix='wallet-membership-fixture-') as raw:
        work = Path(raw)
        work.chmod(0o700)
        user, password = 'fixture-reader', secrets.token_hex(24)
        nonce = secrets.token_hex(32)
        port = 38761
        env = dict(PATH='/usr/sbin:/usr/bin:/sbin:/bin', HOME=raw, LANG='C')
        algorithm_profiles = set()
        if controller:
            require(node and Path(node).is_file(), 'Missing isolated controller runtime')
            controller_file = work/'controller.mjs'
            controller_file.write_text(controller)
        def answer(challenge, login):
            if controller is None:
                return authorization(challenge, user, login)
            result = subprocess.run([node, str(controller_file)], env=env, cwd=work, capture_output=True,
                                    input=json.dumps([challenge,user,login]), text=True, timeout=8)
            require(result.returncode == 0, 'Controller refused the isolated Digest challenge')
            return result.stdout

        def fixture_rpc(method, params):
            require(method in ('get_version', 'create_wallet', 'close_wallet', 'create_account', 'create_address', 'get_address'), 'Unknown fixture method')
            body = json.dumps(dict(jsonrpc='2.0', id='fixture', method=method, params=params)).encode()
            client = http.client.HTTPConnection('127.0.0.1', port, timeout=12)
            try:
                headers = {'Content-Type': 'application/json', 'Connection': 'keep-alive'}
                client.request('POST', '/json_rpc', body, headers)
                sock = client.sock
                first = client.getresponse()
                offered = [v for k,v in first.getheaders() if k.lower() == 'www-authenticate']
                require(first.status == 401 and not first.will_close, 'Fixture requires a persistent Digest handshake')
                require(offered, 'Missing native authentication challenge')
                profile = (len(offered), tuple(a for v in offered for a in re.findall(r'\balgorithm="?([\w-]+)', v, re.I)))
                if profile not in algorithm_profiles:
                    algorithm_profiles.add(profile)
                    print(json.dumps({'challengeHeaders':profile[0], 'algorithms':profile[1]}), flush=True)
                first.read(4096)
                headers['Authorization'] = answer(offered[0], password)
                require(sock and client.sock is sock, 'Fixture Digest socket changed')
                client.request('POST', '/json_rpc', body, headers)
                response = client.getresponse()
                require(response.status == 200, 'Native fixture Digest refused on a persistent connection (%d)' % response.status)
                reply = json.loads(response.read(1024*1024))
            finally:
                client.close()
            require('result' in reply and 'error' not in reply, 'Synthetic wallet setup failed')
            return reply['result']

        # This synthetic login is generated inside a loopback-only namespace and expires with the empty fixture.
        daemon = subprocess.Popen([str(binary), '--offline', '--wallet-dir', raw, '--rpc-bind-ip', '127.0.0.1',
                                   '--rpc-bind-port', str(port), '--rpc-login', user+':'+password,
                                   '--log-file', str(work/'fixture.log')], env=env, cwd=work,
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        probe_file = work/'fixed-probe.py'
        probe_file.write_text(probe)
        probe_file.chmod(0o600)
        try:
            until = time.monotonic()+35
            while True:
                require(daemon.poll() is None, 'Synthetic RPC exited before opening its listener')
                try:
                    fixture_rpc('get_version', {})
                    break
                except (ConnectionError, http.client.HTTPException) as exc:
                    require(time.monotonic() < until, 'Synthetic RPC startup timed out (%s, status %s)' %
                            (type(exc).__name__, getattr(exc, 'code', None)))
                    time.sleep(.2)
            fixture_rpc('create_wallet', {'filename': 'foreign-fixture', 'password': secrets.token_hex(24), 'language': 'English'})
            foreign = fixture_rpc('create_address', {'account_index': 0})['address']
            fixture_rpc('close_wallet', {})
            fixture_rpc('create_wallet', {'filename': 'empty-fixture', 'password': secrets.token_hex(24), 'language': 'English'})
            fixture_rpc('create_address', {'account_index': 0, 'count': 241})
            addresses = fixture_rpc('get_address', {'account_index': 0})
            primary = addresses['address']
            history = sorted(sha(nonce+':'+v['address']) for v in addresses['addresses'] if v['address_index'] != 0)
            require(len(history) == len(set(history)) == 241, 'Incomplete synthetic history')
            primary_sha = sha(json.dumps(['xmr-mainnet-primary-v1', primary], separators=(',', ':')))
            unit = 'monero-wallet-rpc.service'
            fake_pid = str(os.getpid())
            real_pid = str(daemon.pid)
            # The test unit's MainPID is the child we spawned. Native /proc and ss are always read by the probe.
            # The two socket-negative scenarios use a free port and an explicitly ambiguous captured socket record.
            control = work/'systemctl'
            control.write_text('#!/bin/sh\n[ "$*" = "show monero-wallet-rpc.service -p MainPID --value" ] || exit 1\nprintf "%s\\n" "$QA_UNIT_PID"\n')
            control.chmod(0o700)
            shim = work/'ss'
            shim.write_text('#!/bin/sh\nset -eu\nrow=$('+ss+' "$@")\n'
                            'if [ "$QA_SOCKET_MODE" = shared ] && [ -n "$row" ]; then printf "%s users:((fixture,pid=%s,fd=9))\\n" "$row" "$QA_OTHER_PID";\n'
                            'else printf "%s\\n" "$row"; fi\n')
            shim.chmod(0o700)

            def inspect(members, mode='ordinary'):
                candidate_port = port+1 if mode == 'wrong-port' else port
                qa_env = {**env, 'PATH': raw+':'+env['PATH'], 'QA_UNIT_PID': fake_pid if mode == 'wrong-pid' else real_pid,
                          'QA_OTHER_PID': fake_pid, 'QA_SOCKET_MODE': mode}
                with subprocess.Popen([python, '-I', str(probe_file)], env=qa_env, cwd=work, stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1) as proc:
                    try:
                        request = dict(unit=unit, port=candidate_port, nonce=nonce, members=members)
                        if mode in ('indexed','invalid-ledger'):
                            request['lookup'] = 'node-ledger'
                        proc.stdin.write(json.dumps(request)+'\n')
                        proc.stdin.flush()
                        require(select.select([proc.stdout], [], [], 8)[0], 'Timed out awaiting probe admission')
                        frame = proc.stdout.readline()
                        if mode in ('wrong-pid', 'wrong-port', 'shared','invalid-ledger'):
                            require(not frame and proc.wait(timeout=6) != 0, 'Unverified OS identity reached the challenge')
                            return None
                        require(frame and set(json.loads(frame)) == {'challenge'}, 'Native Digest challenge missing')
                        calls = 0
                        while frame and set(json.loads(frame)) == {'challenge'}:
                            calls += 1
                            require(calls <= 2+2*len(members), 'Unexpected number of challenge frames')
                            auth = answer(json.loads(frame)['challenge'], password if mode != 'wrong-digest' else secrets.token_hex(24))
                            proc.stdin.write(json.dumps(auth)+'\n')
                            proc.stdin.flush()
                            require(select.select([proc.stdout], [], [], 9)[0], 'Timed out awaiting next probe frame')
                            frame = proc.stdout.readline()
                        proc.stdin.close()
                        result = frame
                        require(not proc.stdout.read(1), 'Extra wallet probe frame')
                        code = proc.wait(timeout=9)
                        if mode == 'wrong-digest':
                            require(code != 0 and not result, 'Wrong Digest returned membership')
                            return None
                        require(code == 0 and len(result) < 1000, 'Native probe failed after Digest')
                        payload = json.loads(result)
                        fields = {'primarySha256','checked','matched'} | ({'indexed'} if mode=='indexed' else set())
                        require(set(payload) == fields and payload['primarySha256'] == primary_sha,
                                'Unexpected public projection or primary')
                        return payload
                    finally:
                        if proc.poll() is None:
                            proc.kill()
                            proc.wait()

            exact = inspect(history)
            require((exact['checked'], exact['matched']) == (241,241), 'History did not match')
            changed = inspect([*history[:-1], sha('absent synthetic address')])
            require((changed['checked'], changed['matched']) == (241,240), 'Foreign member was counted as present')
            for mode in ('wrong-pid', 'wrong-port', 'shared', 'wrong-digest'):
                inspect(history, mode)
            second = fixture_rpc('create_account', {})
            sub = fixture_rpc('create_address', {'account_index':second['account_index']})
            values = [addresses['addresses'][1]['address'], second['address'], sub['address'], foreign]
            members = [sha(nonce+':'+v) for v in values]
            ledger = Path('/run')/('omnitron-wallet-members-'+nonce)
            with os.fdopen(os.open(ledger,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:
                stream.write('\n'.join(values)+'\n')
            try:
                indexed = inspect(members,'indexed')
                expected = sha(json.dumps([nonce,sorted(members[:-1])],separators=(',',':')))
                require(indexed['matched']==3 and indexed['indexed']=={'otherAccountMatches':2,'indexOnly':0,'matchedSetSha256':expected},
                        'Wallet index did not reproduce the exact cross-account membership')
                inspect([*members[:-1],sha('another ledger')],'invalid-ledger')
                ledger.chmod(0o644)
                inspect(members,'invalid-ledger')
            finally:
                ledger.unlink()
            version = subprocess.check_output([str(binary), '--version'], env=env, cwd=work, text=True, timeout=5)
            parsed = re.search(r'v(\d+\.\d+\.\d+(?:\.\d+)?)', version)
            require(parsed, 'Missing native Monero version')
            return {'monero': parsed[1], 'binarySha256': binary_sha, 'privateLoopback': True,
                    'isolatedUid': os.geteuid(), 'observedMethods': ['get_address','get_address_index','get_accounts'],
                    'indexedChecked':indexed['checked'], 'indexedMatches':indexed['matched'],'matchesOutsideAccountZero':indexed['indexed']['otherAccountMatches'],
                    'checked': exact['checked'], 'matched': exact['matched'], 'changedMatched': changed['matched'],
                    'negativeDigest': True, 'wrongMainPid': True, 'missingListener': True, 'sharedListener': True,
                    'probeSha256': sha(probe), 'productionDigest': controller is not None}
        finally:
            if daemon.poll() is None:
                daemon.terminate()
                try:
                    daemon.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    daemon.kill()
                    daemon.wait()


if __name__ == '__main__':
    require(len(sys.argv) in (3, 5), 'Supply the binary, fixed probe and optional controller pair')
    controller, node = (Path(sys.argv[3]).read_text(), sys.argv[4]) if len(sys.argv) == 5 else (None, None)
    print(json.dumps(run_fixture(sys.argv[1], Path(sys.argv[2]).read_text(), controller, node), separators=(',', ':')))
