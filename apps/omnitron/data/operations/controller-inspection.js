import { quoteForShell } from '@xec-sh/core';

/** The executor's CLI checks the reviewed ID and both keys through its registered controller. */
export function registeredPinArgs(nodeId, fingerprint) {
  return ['node', 'ssh-key', '--expect', fingerprint, '--', nodeId];
}

export function registeredPinCommand(nodeId, fingerprint) {
  return ['omnitron', ...registeredPinArgs(nodeId, fingerprint)].map(arg => quoteForShell(arg, 'posix')).join(' ');
}

export function registeredPinsStep(spec) {
  const source = registeredPinCommand(spec.sourceNode, spec.sourceFingerprint);
  const receiver = registeredPinCommand(spec.receiverNode, spec.receiverFingerprint);
  return { name: 'registered-pins', run: source + ' && ' + receiver, timeout: 90000 };
}

export function fullStopArgs({ project, stack, sourceNode, sourceIp }, stop) {
  return ['stack', 'confirm-stop', '--operation', stop, '--source-node', sourceNode, '--source-host', sourceIp, '--', project, stack];
}

export function fullStopCommand(scope, stop) {
  return ['omnitron', ...fullStopArgs(scope, stop)].map(arg => quoteForShell(arg, 'posix')).join(' ');
}
