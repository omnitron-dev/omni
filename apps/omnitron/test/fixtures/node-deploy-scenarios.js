import path from 'node:path';

const scenario = (dir, { acquireScript, guardScript, releaseScript, renewScript }) => {
  const timing = { dir, leaseSec: 2, renewEveryMs: 500 };
  const record = token => ({ token, holder: token, stack: 'audit', startedAt: '2026-10-25T00:00:00Z' });
  const install = guardScript(timing, 'A', `touch '${dir}/started'; while [ ! -e '${dir}/publish' ]; do sleep 0.1; done; echo sealed >> '${dir}/result'`, 30_000, 'a'.repeat(64));
  const proof = install.match(/\{"schema":2,[^}]+\}/)[0];
  return {
    dir, acquireA: acquireScript(timing, record('A')), acquireB: acquireScript(timing, record('B')),
    releaseA: releaseScript(timing, 'A'), renewA: renewScript(timing, 'A'),
    long: guardScript(timing, 'A', `touch '${dir}/started'; sleep 1; printf A > '${dir}/result'`, 5000),
    stale: guardScript(timing, 'A', `printf stale > '${dir}/result'`),
    current: guardScript(timing, 'B', `printf B > '${dir}/result'`),
    failure: guardScript(timing, 'A', 'exit 23'),
    timeout: guardScript(timing, 'A', `sleep 30; touch '${dir}/late'`, 1000),
    background: guardScript(timing, 'A', `(n=0; while [ ! -e '${dir}/finish' ] && [ "$n" -lt 300 ]; do sleep 0.2; n=$((n+1)); done; touch '${dir}/finished') >/dev/null 2>&1 & echo $! > '${dir}/child.pid'`),
    install, probe: acquireScript(timing, record('B'), true),
    accept: acquireScript(timing, record('B'), { record: proof, token: 'A' }),
    replaced: acquireScript(timing, record('B'), { record: proof.replace('a'.repeat(64), 'b'.repeat(64)), token: 'A' }),
  };
};

export function executionFenceScenarios(root, protocol) {
  const names = ['raw', 'race', 'failure', 'killedLock', 'killedWorker', 'killedTimeout', 'background', 'kernel'];
  return Object.fromEntries(names.map(name => [name, scenario(path.join(root, name), protocol)]));
}
