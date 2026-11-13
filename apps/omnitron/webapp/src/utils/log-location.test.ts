import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { legacyLogTargets, logCommand, logHref } from './log-location';
import { stackAppFixture, stackFixture } from '../../../test/helpers/stack-fixture';
import { terminalCommand } from './terminal-input';

describe('one app and node across Console and CLI', () => {
  it('requires an application and an unambiguous registry endpoint for older remote handles', () => {
    const handle = 'sample-import/deployed/mail';
    const stack = (name: string, host: string, port: number) => stackFixture(name, {
      type: 'remote', runtimeScope: { project: 'sample-import', stack: name },
      nodes: [{ host, port, role: 'app', label: null, daemonRole: 'slave', connected: true, lastSeen: null, syncStatus: null }],
      apps: [stackAppFixture('mail', { handleKey: handle })],
    });
    const test = stack('test', 'worker', 9700);
    const prod = stack('prod', 'worker', 9800);
    const registry = [{ id: 't', host: 'worker', daemonPort: 9700 }, { id: 'p', host: 'worker', daemonPort: 9800 }];
    const read = (stacks = [test, prod], nodeId = 't', nodes = registry) =>
      legacyLogTargets('sample', 'test', stacks, nodes, nodeId);
    expect(read()).toEqual({ observed: true, available: new Set([handle]) });
    expect(read([test, prod], 'p').available.size).toBe(0);
    expect(read([test, prod], '').available.size).toBe(0);
    expect(read([test, stack('ambiguous', 'worker', 9700)]).available.size).toBe(0);
    expect(read([test], 't', [...registry, { ...registry[0]!, id: 'duplicate' }]).available.size).toBe(0);
  });
  it('round-trips an exact remote handle in a link', () => {
    const url = new URL(logHref('sample/production/mail', 'node-a'), 'http://localhost');
    expect(url.pathname).toBe('/logs');
    expect(url.searchParams.get('app')).toBe('sample/production/mail');
    expect(url.searchParams.get('node')).toBe('node-a');
  });

  it('quotes shell metacharacters without executing or splitting them', () => {
    const app = "sample/prod/a'$(false); mail";
    const command = logCommand(app, 'node-a');
    const actual = execFileSync('/bin/sh', ['-c', `omnitron() { printf '%s\\n' "$@"; }; ${command}`], {
      encoding: 'utf8',
    });
    expect(actual.trim().split('\n')).toEqual(['logs', app, '--node', 'node-a', '-n', '100']);
  });
});


it('copies a terminal node ID as one shell argument and stops option parsing', () => {
  const nodeId = "--node; '$(false)";
  const actual = execFileSync('/bin/sh', ['-c', `omnitron() { printf '%s\\n' "$@"; }; ${terminalCommand(nodeId)}`], { encoding: 'utf8' });
  expect(actual.trim().split('\n')).toEqual(['node', 'ssh', '--', nodeId]);
});
