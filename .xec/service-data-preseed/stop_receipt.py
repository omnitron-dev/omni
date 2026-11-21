"""Read the controller's current stop receipt and bind its source to the node registry."""
import base64
import json
import subprocess
import sys


def read(*command):
    result = subprocess.run(['omnitron', '--json', *command], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=40, check=True)
    reply = json.loads(result.stdout)
    if reply.get('ok') is not True:
        raise ValueError('Controller did not return a receipt')
    return reply['data']


def confirms(spec, stop, stack, registry):
    operation = stack.get('stopOperation') or {}
    nodes = operation.get('nodes') or []
    if (stack.get('status') != 'stopped' or operation.get('phase') != 'stopped'
            or operation.get('id') != stop or operation.get('supersededAt')
            or operation.get('keepInfrastructure') or not nodes
            or any(n.get('outcome') != 'stopped' for n in nodes)):
        return False

    source_id = spec['sourceNode']
    registrations = [r for r in registry if r.get('id') == source_id]
    if len(registrations) != 1 or registrations[0].get('host') != spec['sourceIp']:
        return False
    port = registrations[0].get('daemonPort')
    if type(port) is not int or not 1 <= port <= 65535:
        return False
    if sum(r.get('host') == spec['sourceIp'] and r.get('daemonPort') == port for r in registry) != 1:
        return False

    endpoint = f"{spec['sourceIp']}:{port}"
    matched = 0
    for node in nodes:
        address = node.get('node')
        bindings = [node['nodeId']] if 'nodeId' in node else []
        if 'authority' in node:
            bindings.append((node.get('authority') or {}).get('nodeId'))
        if source_id in bindings or address in (source_id, endpoint):
            if any(value != source_id for value in bindings):
                return False
            if address not in (source_id, endpoint, 'local'):
                return False
            if address == 'local' and (node.get('authority') or {}).get('nodeId') != source_id:
                return False
            if not node.get('operationId') or not node.get('observedAt'):
                return False
            matched += 1
    return matched == 1


if __name__ == '__main__':
    scope, stop_id = json.loads(base64.b64decode(sys.argv[1]))
    status = read('stack', 'status', scope['project'], scope['stack'])
    if not confirms(scope, stop_id, status, read('node', 'list')['nodes']):
        sys.exit('The approved full stack stop and registered source could not be confirmed')
    print('The controller confirms the exact full stack stop.')
