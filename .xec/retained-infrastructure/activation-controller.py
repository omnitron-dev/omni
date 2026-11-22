"""Re-read separately admitted native runs and the current selected placement on the controller."""
import base64
from datetime import datetime
import hashlib
import json
import subprocess
import sys
import time


def require(condition):
    if not condition:
        raise ValueError('unconfirmed return authority')


def native(args, supplied=None):
    result = subprocess.run(['omnitron', '--json', *args], input=supplied, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=55, check=True)
    reply = json.loads(result.stdout)
    require(reply.get('ok') is True)
    return reply['data']


def witness(ref, read):
    run = read(['pipeline', 'status', ref['run'], '--output'])
    require(run['id'] == ref['run'] and run['pipelineId'] == ref['pipeline'] and run['status'] == 'success'
            and run['review']['digest'] == ref['review'] and run['review']['definitionRevision'] == ref['revision'])
    return run


def step(run, name, node, selected=None):
    found = [item for item in run['steps'] if item.get('name') == name]
    require(len(found) == 1)
    item = found[0]
    require(item['kind'] == 'shell' and item['nodeId'] == node and item['status'] == 'success'
            and item['exitCode'] == 0 and item['outputTruncated'] is False)
    if selected is not None:
        require(item['sourceHash'] == selected['sourceHash'] and
                hashlib.sha256(item['output'].encode()).hexdigest() == selected['outputSha256'])
    return json.loads(item['output'])


def verify(s, read=native, clock=time.time):
    require(clock() < s['expires'] <= clock() + 901)
    old, new = s['sourceNode'], s['receiverNode']
    for node, key in [(old, 'sourceFingerprint'), (new, 'receiverFingerprint')]:
        pin = read(['node', 'ssh-key', node])
        require(pin['nodeId'] == node and pin['trusted'] == pin['observed'] == s[key])
    fleet = read(['node', 'list'])['nodes']
    entries = [[n for n in fleet if n['id'] == key] for key in (old, new)]
    require(all(len(items) == 1 for items in entries))
    address = lambda n: (n['host'], n.get('daemonPort') or 9700)
    require(address(entries[0][0]) != address(entries[1][0]))
    route = read(['stack', 'status', s['project'], s['stack']])['config']
    nodes = route.get('nodes') or []
    require(route['type'] == 'remote' and len(nodes) == 1 and nodes[0].get('nodeId', old) == old
            and (nodes[0]['host'], nodes[0].get('port') or 9700) == address(entries[0][0]))

    ref = s['passive']
    passive = step(witness(ref,read), ref['step'], old, ref)
    require(passive == {'protocol': 1, 'project': s['project'], 'stack': s['stack'], 'declarationSha256': s['declarationSha256'],
                        'created': s['created'], 'running': 0})
    h, ref = s['handback'], s['custody']
    custody_run = witness(ref,read)
    received = datetime.fromisoformat(custody_run['completedAt'].replace('Z', '+00:00')).timestamp()
    custody = step(custody_run, ref['step'], 'local', ref)
    require(clock() - 900 <= received <= clock() + 5 and type(custody.get('expires')) is int and custody['expires'] <= received + 900)
    require(custody.get('protocol') == 1 and all(custody.get(k) == s[k] for k in ('project','stack','sourceNode','receiverNode','nodeStop'))
            and custody.get('returnDataReview') == h['params']['returnDataReview'] and custody.get('beforeFirstNewWriter') is True
            and custody.get('receiverWriterFenced') is True and custody.get('exclusiveSigners') is True and custody.get('exclusivePublisher') is True
            and isinstance(custody.get('roles'),list) and s['role'] in custody['roles'] and set(custody['roles']) <= set(s['order'])
            and len(set(custody['roles'])) == len(custody['roles']) and clock() < s['expires'] <= custody['expires'])

    ref = h['record']
    returned = witness(ref,read)
    # A status receipt redacts parameter values. Preparing the same *completed* run under its original actor rechecks the
    # stored HMAC without dispatch. First require the authentic successful row so no new run is prepared here.
    replay = read(['pipeline','run',ref['pipeline'],'--expected-revision',ref['revision'],'--run-id',ref['run'],
                   '--prepare','--params-file','/dev/stdin'], json.dumps(h['params']).encode())
    require(replay['id'] == ref['run'] and replay['status'] == 'success' and replay['review']['digest'] == ref['review'])
    selection = step(returned, ref['step'], 'local', ref)
    unchanged = h['mode'] == 'unchanged'
    require(selection.get('placementDigest') == h['params']['placementReview'] and selection.get('fullStop') == h['params']['stopId']
            and selection.get('selected') is (not unchanged) and (selection['from'],selection['to']) == ((old,new) if unchanged else (new,old)))
    closed = step(returned, 'recheck-recipient-closed', new)
    released = step(returned, 'release-original-holds' if unchanged else 'release-signer-holds', old)
    require(closed.get('recipient') == 'inactive' and closed.get('portalConsumers') == 0 and released.get('oldRulesRestored') is True
            and released.get('processesStarted') == 0 and released.get('publisherCreated') is False
            and closed.get('operationId') and closed['operationId'] == released.get('operationId'))
    require(clock() < s['expires'])
    return {'project':s['project'],'stack':s['stack'],'source':old,'role':s['role'],'passiveRun':s['passive']['run'],
            'handbackRun':ref['run'],'custodyRun':s['custody']['run']}


if __name__ == '__main__':
    try:
        print(json.dumps(verify(json.loads(base64.urlsafe_b64decode(sys.argv[1]+'==='))),separators=(',',':')))
    except Exception:
        sys.exit('The registered source, return parameters, data custody or passive receipt is unconfirmed.')
