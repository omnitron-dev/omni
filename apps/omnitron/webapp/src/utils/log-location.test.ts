import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { logCommand, logHref } from './log-location';
import { terminalCommand } from './terminal-input';

describe('one app and node across Console and CLI', () => {
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
